/**
 * 编译执行：cmake --build + 编译器诊断解析 + 构建记录持久化。
 *
 * - 不阻塞 VS Code 主线程（子进程 + 事件）；
 * - 支持取消（终止整个进程树）与超时；
 * - 每次构建生成独立 BuildRecord 并持久化，供烧录流程做新鲜度校验；
 * - 失败时解析编译器错误（文件:行:列），交由 UI 层写入问题面板。
 */

import * as path from 'path';
import {
  BuildRecord,
  ParsedDiagnostic,
} from '../types';
import { CancelToken, NULL_CANCEL_TOKEN, ProcResult, execFileSafe } from '../util/process';
import { existsSync, readTextFile } from '../util/path';
import { findArtifacts, readPersistedState, writePersistedState } from './artifacts';

export interface BuildInput {
  root: string;
  buildDir: string;
  cmakePath: string;
  buildType: string;
  generator?: string;
  /** 用户指定的 CMake 目标（状态栏目标选择）：只构建该目标 */
  target?: string;
  token?: CancelToken;
  timeoutMs?: number;
  log(msg: string): void;
  /** 实时输出回调（用于追加到输出通道） */
  onOutput?: (chunk: string) => void;
}

export interface BuildOutcome {
  ok: boolean;
  record: BuildRecord;
  result: ProcResult;
  diagnostics: ParsedDiagnostic[];
  elfPath?: string;
}

/** gcc/clang 风格诊断行：file:line:col: severity: message */
const GCC_DIAG_RE = /^(.+?):(\d+):(\d+):\s*(?:fatal\s+)?(error|warning):\s*(.+)$/;

/** 链接器错误：file:line: undefined reference to `symbol' */
const LD_UNDEF_RE = /^(.+?):(\d+):\s*undefined reference to [`']([^']+)'/;

export function parseCompilerDiagnostics(text: string, root: string): ParsedDiagnostic[] {
  const out: ParsedDiagnostic[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const m = GCC_DIAG_RE.exec(line);
    if (m) {
      const file = resolveDiagFile(m[1], root);
      out.push({
        file,
        line: parseInt(m[2], 10) || 1,
        column: parseInt(m[3], 10) || 1,
        severity: m[4] === 'error' ? 'error' : 'warning',
        message: m[5].trim(),
      });
      continue;
    }
    const lm = LD_UNDEF_RE.exec(line);
    if (lm) {
      out.push({
        file: resolveDiagFile(lm[1], root),
        line: parseInt(lm[2], 10) || 1,
        column: 1,
        severity: 'error',
        message: `undefined reference to '${lm[3]}'`,
      });
    }
  }
  // 限制数量，避免极端情况下问题面板被刷爆
  return out.slice(0, 500);
}

function resolveDiagFile(f: string, root: string): string {
  const trimmed = f.trim();
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.resolve(root, trimmed);
}

/**
 * 读取 CMakeCache.txt 中的生成器与构建类型（用于判断是否多配置生成器）。
 */
export async function readCMakeCacheInfo(
  buildDir: string,
): Promise<{ generator?: string; buildType?: string }> {
  const cache = await readTextFile(path.join(buildDir, 'CMakeCache.txt'), 1024 * 1024);
  if (!cache) {
    return {};
  }
  const genM = /^CMAKE_GENERATOR(?::\w+)?\s*=\s*(.+)$/m.exec(cache);
  const typeM = /^CMAKE_BUILD_TYPE(?::\w+)?\s*=\s*(.+)$/m.exec(cache);
  return {
    generator: genM?.[1].trim(),
    buildType: typeM?.[1].trim(),
  };
}

/**
 * 构建目录是否已完成配置。
 * 注意：失败的 cmake 配置也会留下 CMakeCache.txt（含 CMAKE_GENERATOR），
 * 但不会生成 build.ninja / Makefile —— 因此必须同时检查生成器对应的
 * 实际构建文件，否则会跳过配置直接编译并报 "build.ninja not found"。
 */
export async function isConfigured(buildDir: string): Promise<boolean> {
  const info = await readCMakeCacheInfo(buildDir);
  if (!info.generator) {
    return false;
  }
  if (/Ninja/i.test(info.generator)) {
    return existsSync(path.join(buildDir, 'build.ninja'));
  }
  if (/Makefiles/i.test(info.generator)) {
    return existsSync(path.join(buildDir, 'Makefile'));
  }
  // Visual Studio 等 IDE 生成器：CMakeCache 存在即视为已配置
  return true;
}

export async function buildProject(input: BuildInput): Promise<BuildOutcome> {
  const { log } = input;
  const startedAt = Date.now();

  const cacheInfo = await readCMakeCacheInfo(input.buildDir);
  const multiConfig = /Visual Studio|Xcode|Ninja Multi-Config/i.test(cacheInfo.generator ?? '');

  const args = ['--build', input.buildDir, '--parallel'];
  if (multiConfig) {
    args.push('--config', input.buildType);
  }
  if (input.target) {
    // 用户指定了 CMake 目标（状态栏目标选择）：只构建该目标
    args.push('--target', input.target);
  }

  log(`开始编译${input.target ? ` 目标 ${input.target}` : ''} (模式 ${input.buildType}${cacheInfo.generator ? `, 生成器 ${cacheInfo.generator}` : ''})...`);
  const result = await execFileSafe(input.cmakePath, args, {
    cwd: input.root,
    timeoutMs: input.timeoutMs ?? 600_000,
    token: input.token ?? NULL_CANCEL_TOKEN,
    onOutput: input.onOutput,
  });

  const success = result.exitCode === 0 && !result.timedOut && !result.cancelled;
  const diagnostics = success ? [] : parseCompilerDiagnostics(`${result.stdout}\n${result.stderr}`, input.root);

  let elfPath: string | undefined;
  let elfMtimeMs: number | undefined;
  if (success) {
    const artifacts = await findArtifacts(input.buildDir);
    // 选了目标时优先锁定 <目标名>.elf，防止多目标工程误认到"最新链接"的另一个 ELF
    const want = input.target ? `${input.target.toLowerCase()}.elf` : undefined;
    const elf =
      (want ? artifacts.find((a) => a.path.toLowerCase().endsWith(want)) : undefined) ??
      artifacts.find((a) => a.format === 'elf');
    elfPath = elf?.path;
    elfMtimeMs = elf?.mtimeMs;
  }

  const record: BuildRecord = {
    id: `b-${startedAt}`,
    root: input.root,
    buildDir: input.buildDir,
    buildType: input.buildType,
    generator: cacheInfo.generator,
    success,
    exitCode: result.exitCode,
    startedAt,
    endedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    elfPath,
    elfMtimeMs,
    cancelled: result.cancelled || undefined,
    timedOut: result.timedOut || undefined,
  };

  // 持久化构建记录（烧录流程以此为门禁）+ 完整编译日志落盘（失败也保留）
  const state = await readPersistedState(input.buildDir);
  await writePersistedState(input.buildDir, {
    version: 1,
    createdByAutoCmakeFlash: true,
    lastBuild: record,
  });
  await saveBuildLog(input.buildDir, record, `${result.stdout}\n${result.stderr}`);

  log(
    success
      ? `编译成功，耗时 ${(record.durationMs / 1000).toFixed(1)}s${elfPath ? `，ELF: ${elfPath}` : ''}`
      : `编译失败，退出码 ${result.exitCode}${result.timedOut ? '（超时）' : ''}${result.cancelled ? '（用户取消）' : ''}，共解析出 ${diagnostics.filter((d) => d.severity === 'error').length} 个错误`,
  );

  return { ok: success, record, result, diagnostics, elfPath };
}

/** 保存完整编译日志到构建目录（即使失败也保留） */
export async function saveBuildLog(
  buildDir: string,
  record: BuildRecord,
  output: string,
): Promise<void> {
  try {
    const fs = await import('fs');
    const text = [
      `# build ${record.id}`,
      `# success=${record.success} exit=${record.exitCode} started=${new Date(record.startedAt).toISOString()}`,
      '',
      output.slice(0, 1024 * 1024),
    ].join('\n');
    await fs.promises.writeFile(path.join(buildDir, 'last-build.log'), text, 'utf8');
  } catch {
    /* 日志写失败不影响主流程 */
  }
}
