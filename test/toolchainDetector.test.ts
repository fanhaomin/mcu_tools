/**
 * 工具链检测测试：注入 DetectionEnv 模拟 PATH 与版本命令，
 * 覆盖工具链缺失 / 版本命令失败 / 用户覆盖优先级 / 路径含空格。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DetectionEnv,
  VersionProbeResult,
  detectToolchain,
  defaultDetectionEnv,
  resolveArmToolchainSetting,
} from '../src/detection/toolchainDetector';
import { execFileSafe } from '../src/util/process';
import { makeTempDir, cleanup } from './helpers/fixtures';

/** 构造可编程的假检测环境 */
function fakeEnv(opts: {
  /** 每个工具的 PATH 查找结果 */
  pathResults?: Record<string, string[]>;
  /** 额外视为存在的路径集合 */
  existing?: string[];
  /** 版本命令脚本：路径 -> 版本号；未列出的路径视为版本命令失败 */
  versions?: Record<string, string>;
  /** CubeCLT 安装根目录（如 C:\ST\STM32CubeCLT_1.16.0） */
  cltRoots?: string[];
}): DetectionEnv & { searchedCandidates: string[] } {
  const searchedCandidates: string[] = [];
  const existing = new Set(opts.existing ?? []);
  for (const [name, paths] of Object.entries(opts.pathResults ?? {})) {
    void name;
    for (const p of paths) {
      existing.add(p);
    }
  }
  const cltRoots = opts.cltRoots ?? [];
  for (const r of cltRoots) {
    existing.add(r);
    existing.add(path.dirname(r));
  }
  return {
    searchedCandidates,
    async pathLookup(name: string) {
      return opts.pathResults?.[name] ?? [];
    },
    async exists(p: string) {
      return existing.has(p);
    },
    async listDirs(dir: string) {
      const names: string[] = [];
      for (const r of cltRoots) {
        if (path.dirname(r) === dir) {
          names.push(path.basename(r));
        }
      }
      return names;
    },
    async runVersion(file: string, _args: string[], regex: RegExp): Promise<VersionProbeResult> {
      searchedCandidates.push(file);
      const output = opts.versions?.[file];
      if (output) {
        const m = regex.exec(output);
        if (m) {
          return { ok: true, version: m[1] };
        }
        return { ok: false, error: '版本命令输出与预期正则不匹配' };
      }
      return { ok: false, error: '版本命令执行失败 (退出码 1)' };
    },
  };
}

test('工具链完整：全部找到且版本确认', async () => {
  const env = fakeEnv({
    pathResults: {
      'cmake.exe': ['C:\\Tools\\cmake.exe'],
      'ninja.exe': ['C:\\Tools\\ninja.exe'],
      'arm-none-eabi-gcc.exe': ['C:\\ARM\\bin\\arm-none-eabi-gcc.exe'],
      'arm-none-eabi-g++.exe': ['C:\\ARM\\bin\\arm-none-eabi-g++.exe'],
      'arm-none-eabi-objcopy.exe': ['C:\\ARM\\bin\\arm-none-eabi-objcopy.exe'],
      'arm-none-eabi-size.exe': ['C:\\ARM\\bin\\arm-none-eabi-size.exe'],
      'STM32_Programmer_CLI.exe': ['C:\\CubeProg\\STM32_Programmer_CLI.exe'],
    },
    versions: {
      'C:\\Tools\\cmake.exe': 'cmake version 3.28.1',
      'C:\\Tools\\ninja.exe': '1.11.1',
      'C:\\ARM\\bin\\arm-none-eabi-gcc.exe': 'arm-none-eabi-gcc (GNU Arm Embedded) 13.2.0',
      'C:\\ARM\\bin\\arm-none-eabi-g++.exe': 'arm-none-eabi-g++ (GNU Arm Embedded) 13.2.0',
      'C:\\ARM\\bin\\arm-none-eabi-objcopy.exe': 'GNU objcopy 2.41.0',
      'C:\\ARM\\bin\\arm-none-eabi-size.exe': 'GNU size 2.41.0',
      'C:\\CubeProg\\STM32_Programmer_CLI.exe': 'STM32CubeProgrammer v2.17.0',
    },
  });
  const tc = await detectToolchain(env);
  assert.equal(tc.complete, true);
  assert.equal(tc.missing.length, 0);
  assert.equal(tc.tools.cmake.found, true);
  assert.equal(tc.tools.cmake.version, '3.28.1');
  assert.equal(tc.tools.cmake.versionConfirmed, true);
  assert.equal(tc.tools.armGcc.version, '13.2.0');
  assert.equal(tc.tools.programmerCli.version, '2.17.0');
  assert.equal(tc.tools.ninja.path, 'C:\\Tools\\ninja.exe');
});

test('工具链缺失：programmerCli 未找到时应给出原因与搜索记录', async () => {
  const env = fakeEnv({
    pathResults: {
      'cmake.exe': ['C:\\Tools\\cmake.exe'],
      'ninja.exe': ['C:\\Tools\\ninja.exe'],
      'arm-none-eabi-gcc.exe': ['C:\\ARM\\bin\\arm-none-eabi-gcc.exe'],
      'arm-none-eabi-g++.exe': ['C:\\ARM\\bin\\arm-none-eabi-g++.exe'],
      'arm-none-eabi-objcopy.exe': ['C:\\ARM\\bin\\arm-none-eabi-objcopy.exe'],
      'arm-none-eabi-size.exe': ['C:\\ARM\\bin\\arm-none-eabi-size.exe'],
    },
    versions: {
      'C:\\Tools\\cmake.exe': 'cmake version 3.28.1',
      'C:\\Tools\\ninja.exe': '1.11.1',
      'C:\\ARM\\bin\\arm-none-eabi-gcc.exe': 'gcc 13.2.0',
      'C:\\ARM\\bin\\arm-none-eabi-g++.exe': 'g++ 13.2.0',
      'C:\\ARM\\bin\\arm-none-eabi-objcopy.exe': 'objcopy 2.41.0',
      'C:\\ARM\\bin\\arm-none-eabi-size.exe': 'size 2.41.0',
    },
  });
  const tc = await detectToolchain(env);
  assert.equal(tc.complete, false);
  assert.deepEqual(tc.missing, ['programmerCli']);
  assert.equal(tc.tools.programmerCli.found, false);
  assert.ok(tc.tools.programmerCli.error!.includes('未找到'));
  assert.ok(tc.tools.programmerCli.error!.includes('STM32CubeCLT'), '失败原因应包含解决建议');
});

test('文件存在但版本命令失败：found=true 且 versionConfirmed=false', async () => {
  const env = fakeEnv({
    pathResults: {
      'ninja.exe': ['C:\\Broken\\ninja.exe'],
    },
    existing: ['C:\\Broken\\ninja.exe'],
    // versions 不包含该路径 → 版本命令失败
  });
  const tc = await detectToolchain(env);
  assert.equal(tc.tools.ninja.found, true, '文件存在即视为找到');
  assert.equal(tc.tools.ninja.versionConfirmed, false, '但版本未确认');
  assert.ok(tc.tools.ninja.error!.includes('版本命令确认失败'));
});

test('文件存在但版本命令失败时，应继续尝试后续候选并选用可用的', async () => {
  const env = fakeEnv({
    pathResults: {},
    cltRoots: ['C:\\ST\\STM32CubeCLT_1.16.0'],
    existing: ['C:\\Broken\\ninja.exe', 'C:\\ST\\STM32CubeCLT_1.16.0\\Ninja\\ninja.exe'],
    versions: {
      'C:\\ST\\STM32CubeCLT_1.16.0\\Ninja\\ninja.exe': '1.11.1',
    },
  });
  const tc = await detectToolchain(env);
  assert.equal(tc.tools.ninja.found, true);
  assert.equal(tc.tools.ninja.path, 'C:\\ST\\STM32CubeCLT_1.16.0\\Ninja\\ninja.exe');
  assert.equal(tc.tools.ninja.version, '1.11.1');
  assert.equal(tc.tools.ninja.versionConfirmed, true);
});

test('用户设置覆盖优先于 PATH 与 CubeCLT 目录', async () => {
  const env = fakeEnv({
    cltRoots: ['C:\\ST\\STM32CubeCLT_1.16.0'],
    existing: [
      'D:\\my-tools\\cmake.exe',
      'C:\\ST\\STM32CubeCLT_1.16.0\\CMake\\bin\\cmake.exe',
    ],
    versions: {
      'D:\\my-tools\\cmake.exe': 'cmake version 3.30.0',
      'C:\\ST\\STM32CubeCLT_1.16.0\\CMake\\bin\\cmake.exe': 'cmake version 3.27.0',
    },
  });
  const tc = await detectToolchain(env, {
    overrides: { cmake: 'D:\\my-tools\\cmake.exe' },
  });
  assert.equal(tc.tools.cmake.path, 'D:\\my-tools\\cmake.exe');
  assert.equal(tc.tools.cmake.version, '3.30.0');
});

test('armToolchainPath 目录形式：自动推导 g++/objcopy/size', async () => {
  const setting = resolveArmToolchainSetting('C:\\ARM\\bin');
  assert.equal(setting.armGcc, 'C:\\ARM\\bin\\arm-none-eabi-gcc.exe');
  assert.equal(setting.armGpp, 'C:\\ARM\\bin\\arm-none-eabi-g++.exe');
  assert.equal(setting.objcopy, 'C:\\ARM\\bin\\arm-none-eabi-objcopy.exe');
  assert.equal(setting.size, 'C:\\ARM\\bin\\arm-none-eabi-size.exe');

  const setting2 = resolveArmToolchainSetting('C:\\ARM\\bin\\arm-none-eabi-gcc.exe');
  assert.equal(setting2.armGcc, 'C:\\ARM\\bin\\arm-none-eabi-gcc.exe');
  assert.equal(setting2.objcopy, 'C:\\ARM\\bin\\arm-none-eabi-objcopy.exe');

  assert.deepEqual(resolveArmToolchainSetting(''), {});
  assert.deepEqual(resolveArmToolchainSetting(undefined), {});
});

test('路径包含空格：execFileSafe 以参数数组传递，路径不需转义（真实进程集成测试）', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('仅 Windows 平台执行');
    return;
  }
  const tmp = makeTempDir('acf space test-');
  try {
    const spacedDir = path.join(tmp, 'My Tools Dir');
    fs.mkdirSync(spacedDir, { recursive: true });
    const fakeTool = path.join(spacedDir, 'fake tool.exe');
    try {
      fs.copyFileSync('C:\\Windows\\System32\\cmd.exe', fakeTool);
    } catch {
      t.skip('无法复制 cmd.exe，跳过该集成测试');
      return;
    }
    const r = await execFileSafe(fakeTool, ['/c', 'echo', 'ACF-SPACE-OK'], { timeoutMs: 10_000 });
    assert.equal(r.exitCode, 0, `退出码应为 0，stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('ACF-SPACE-OK'), '含空格路径应可正常执行');
    assert.ok(r.commandLine.includes('"'), '展示用命令行应对空格路径加引号');
  } finally {
    cleanup(tmp);
  }
});

test('默认检测环境：runVersion 使用真实进程（对不存在的工具返回失败而非抛异常）', async () => {
  const env = defaultDetectionEnv();
  const r = await env.runVersion(
    path.join(os.tmpdir(), 'acf-not-exist-tool.exe'),
    ['--version'],
    /(\d+\.\d+)/,
    5_000,
  );
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('真实环境探测（如本机安装了工具则验证版本确认，否则全部 graceful 缺失）', async () => {
  const tc = await detectToolchain(defaultDetectionEnv(), { timeoutMs: 20_000 });
  assert.ok(tc.tools.cmake);
  // 无论是否安装，found=false 时必须有 error 原因
  for (const t of Object.values(tc.tools)) {
    if (!t.found) {
      assert.ok(t.error && t.error.length > 0, `${t.name} 未找到时必须记录原因`);
    }
    if (t.found) {
      assert.ok(t.path, `${t.name} 找到时必须记录路径`);
    }
  }
});
