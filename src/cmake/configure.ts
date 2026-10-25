/**
 * CMake 配置。
 *
 * 安全策略：
 * - 只在插件专用构建目录（默认 cmake-build-<小写buildType>，CLion 风格）中生成文件；
 * - 不覆盖用户已有的 CMakeLists.txt；
 * - 目录非空且不是插件创建的 → 必须用户确认后才能继续；
 * - 工程已自带工具链配置（如 CubeMX CMake 工程）→ 不注入 CMAKE_TOOLCHAIN_FILE。
 */

import * as path from 'path';
import { CancelToken, NULL_CANCEL_TOKEN, ProcResult, execFileSafe } from '../util/process';
import { readTextFile, splitArgs } from '../util/path';
import { BUILD_STATE_FILE, readPersistedState, writePersistedState } from './artifacts';

export interface ConfigureInput {
  root: string;
  buildDir: string;
  generator: string;
  buildType: string;
  cmakePath: string;
  /** Ninja 是否可用（生成器为 Ninja 时必须） */
  ninjaAvailable: boolean;
  /** 工程是否已自带工具链配置（此时不注入 CMAKE_TOOLCHAIN_FILE） */
  hasExistingToolchain: boolean;
  /** 用户显式指定的工具链文件（设置 autoCmakeFlash.cmakeToolchainFile） */
  toolchainFile?: string;
  /** 插件生成的工具链文件路径（当工程没有工具链配置时） */
  generatedToolchainFile?: string;
  /** 追加的 CMake 参数（已拆分为数组） */
  extraArgs: string[];
  /** 构建目录非空且非插件创建时，向用户确认（返回 true 才继续） */
  confirmReuseForeignBuildDir(dir: string): Promise<boolean>;
  log(msg: string): void;
  token?: CancelToken;
  timeoutMs?: number;
}

export interface ConfigureOutcome {
  ok: boolean;
  result?: ProcResult;
  /** 失败且未执行命令时的原因 */
  reason?: string;
  args?: string[];
}

export function generateToolchainFileContent(
  cCompiler: string,
  cppCompiler: string,
  opts: { cpuFlags?: string; includeOriginalToolchain?: string } = {},
): string {
  const lines: string[] = [
    '# 由 Embedded Debug 自动生成（位于 .auto-cmake-flash/ 目录，可随时删除）。',
  ];
  if (opts.includeOriginalToolchain) {
    lines.push(
      '# 先加载工程原有工具链设置（如 CubeMX 的 gcc-arm-none-eabi.cmake），',
      '# 再由下方完整路径设置覆盖编译器，确保不依赖 PATH。',
      `include("${opts.includeOriginalToolchain.replace(/\\/g, '/')}")`,
      '',
    );
  }
  lines.push(
    'set(CMAKE_SYSTEM_NAME Generic)',
    'set(CMAKE_SYSTEM_PROCESSOR arm)',
    'set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)',
    `set(CMAKE_C_COMPILER "${cCompiler.replace(/\\/g, '/')}")`,
    `set(CMAKE_CXX_COMPILER "${cppCompiler.replace(/\\/g, '/')}")`,
  );
  if (opts.cpuFlags) {
    // *_FLAGS_INIT 仅在首次配置时生效，不会覆盖工程自己追加的选项；
    // 用于补齐未提供 -mcpu/-mthumb 的工程（缺省时 GCC 按 ARM 模式汇编导致
    // "selected processor does not support `wfe' in ARM mode" 等错误）。
    lines.push(
      `set(CMAKE_C_FLAGS_INIT "\${CMAKE_C_FLAGS_INIT} ${opts.cpuFlags}")`,
      `set(CMAKE_CXX_FLAGS_INIT "\${CMAKE_CXX_FLAGS_INIT} ${opts.cpuFlags}")`,
      `set(CMAKE_ASM_FLAGS_INIT "\${CMAKE_ASM_FLAGS_INIT} ${opts.cpuFlags}")`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** 组装 cmake 配置参数（纯函数，便于测试） */
export function buildConfigureArgs(input: {
  root: string;
  buildDir: string;
  generator: string;
  buildType: string;
  toolchainFile?: string;
  extraArgs: string[];
}): string[] {
  const args = [
    '-S', input.root,
    '-B', input.buildDir,
    '-G', input.generator,
    `-DCMAKE_BUILD_TYPE=${input.buildType}`,
    '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
  ];
  if (input.toolchainFile) {
    args.push(`-DCMAKE_TOOLCHAIN_FILE=${input.toolchainFile}`);
  }
  args.push(...input.extraArgs);
  return args;
}

/** 检测工程 CMakeLists 是否设置了 CMAKE_TOOLCHAIN_FILE（内容级判断） */
export async function cmakeListsDeclaresToolchain(cmakeListsPath: string): Promise<boolean> {
  const content = await readTextFile(cmakeListsPath);
  if (!content) {
    return false;
  }
  return /CMAKE_TOOLCHAIN_FILE/i.test(content);
}

/**
 * 清理失败的 configure 留下的缓存残留（CMakeCache.txt / CMakeFiles）。
 * 仅应在插件专用构建目录中使用；重试注入工具链前调用，
 * 避免 NOTFOUND 编译器条目残留在缓存中导致重试继续失败。
 */
export async function clearCMakeConfigureResidue(buildDir: string): Promise<string | undefined> {
  const fs = await import('fs');
  const errors: string[] = [];
  for (const target of ['CMakeCache.txt', 'CMakeFiles']) {
    const full = path.join(buildDir, target);
    try {
      await fs.promises.rm(full, { recursive: true, force: true });
    } catch (e) {
      errors.push(`${target}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return errors.length > 0 ? errors.join('; ') : undefined;
}

export async function configureProject(input: ConfigureInput): Promise<ConfigureOutcome> {
  const { log } = input;

  // 1. 前置检查：cmake 可用性
  if (!input.cmakePath) {
    return { ok: false, reason: '未找到 CMake。请安装 STM32CubeCLT 或在设置中指定 cmake 路径。' };
  }

  // 2. 生成器检查：Ninja 不可用时明确提示（调用方 UI 负责提供切换选项）
  if (/^ninja$/i.test(input.generator) && !input.ninjaAvailable) {
    return {
      ok: false,
      reason:
        '生成器 Ninja 未检测到。请安装 STM32CubeCLT（含 Ninja），' +
        '或将设置 autoCmakeFlash.generator 改为已安装的生成器（如 "MinGW Makefiles"）。',
    };
  }

  // 3. 构建目录策略：不覆盖用户目录
  const buildDir = input.buildDir;
  let fsmod: typeof import('fs');
  try {
    fsmod = await import('fs');
  } catch {
    return { ok: false, reason: '无法加载文件系统模块' };
  }
  const stat = await fsmod.promises.stat(buildDir).catch(() => undefined);
  if (stat?.isDirectory()) {
    const marker = await readPersistedState(buildDir);
    const cacheExists = await fsmod.promises
      .stat(path.join(buildDir, 'CMakeCache.txt'))
      .then(() => true)
      .catch(() => false);
    const entries = await fsmod.promises.readdir(buildDir).catch(() => [] as string[]);
    if (entries.length > 0 && !marker && !cacheExists && !entries.includes(BUILD_STATE_FILE)) {
      const okToUse = await input.confirmReuseForeignBuildDir(buildDir);
      if (!okToUse) {
        return {
          ok: false,
          reason: `目录 ${buildDir} 已存在且不是 Embedded Debug 创建的，用户取消了操作。` +
            '可修改设置 autoCmakeFlash.buildDir 换一个目录。',
        };
      }
      log(`用户确认使用已存在的目录 ${buildDir}`);
      await writePersistedState(buildDir, {
        version: 1,
        createdByAutoCmakeFlash: true,
      });
    }
  }

  // 4. 工具链文件决策
  let toolchainFile: string | undefined;
  if (input.toolchainFile) {
    toolchainFile = input.toolchainFile;
    log(`使用用户设置中的工具链文件: ${toolchainFile}`);
  } else if (input.hasExistingToolchain) {
    log('工程已自带工具链配置，不再注入 CMAKE_TOOLCHAIN_FILE（避免冲突）。');
  } else if (input.generatedToolchainFile) {
    toolchainFile = input.generatedToolchainFile;
    log(`使用插件生成的工具链文件: ${toolchainFile}`);
  } else {
    log('警告: 没有任何工具链配置。若 CMakeLists 未设置编译器，configure 可能失败。');
  }

  // 5. 组装并执行
  const args = buildConfigureArgs({
    root: input.root,
    buildDir,
    generator: input.generator,
    buildType: input.buildType,
    toolchainFile,
    extraArgs: input.extraArgs,
  });

  const result = await execFileSafe(input.cmakePath, args, {
    cwd: input.root,
    timeoutMs: input.timeoutMs ?? 300_000,
    token: input.token ?? NULL_CANCEL_TOKEN,
  });

  log(`cmake 配置退出码: ${result.exitCode}${result.timedOut ? '（超时）' : ''}${result.cancelled ? '（已取消）' : ''}`);
  if (result.exitCode === 0) {
    // 写入/刷新插件标记
    const state = await readPersistedState(buildDir);
    await writePersistedState(buildDir, {
      version: 1,
      createdByAutoCmakeFlash: true,
      lastBuild: state?.lastBuild,
    });
    return { ok: true, result, args };
  }
  return { ok: false, result, args };
}
