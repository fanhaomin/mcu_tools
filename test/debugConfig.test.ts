/**
 * 调试功能测试：cortex-debug launch 配置字段 / CMakeCache 构建类型解析 /
 * 可调试构建类型判定 / 调试工具为可选组件（不参与 complete 判定）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import {
  CORTEX_DEBUG_EXTENSION_ID,
  buildCortexDebugLaunch,
  isDebuggableBuildType,
  parseBuildTypeFromCMakeCache,
} from '../src/debug/debugConfig';
import {
  DetectionEnv,
  VersionProbeResult,
  detectToolchain,
  resolveArmToolchainSetting,
} from '../src/detection/toolchainDetector';

// ---------- cortex-debug 配置生成 ----------

const baseSpec = {
  root: 'D:\\work\\proj',
  elfPath: 'D:\\work\\proj\\build-auto\\fw.elf',
  device: 'STM32F103C8',
  interface: 'SWD' as const,
  gdbPath: 'C:\\ST\\CLT\\GNU-tools-for-STM32\\bin\\arm-none-eabi-gdb.exe',
  gdbServerPath: 'C:\\ST\\CLT\\STM32CubeProgrammer\\bin\\ST-LINK_gdbserver.exe',
};

test('launch 配置：cortex-debug + stlink，字段完整并停在 main', () => {
  const c = buildCortexDebugLaunch({ ...baseSpec, request: 'launch' });
  assert.equal(c.type, 'cortex-debug');
  assert.equal(c.servertype, 'stlink');
  assert.equal(c.request, 'launch');
  assert.equal(c.cwd, baseSpec.root);
  assert.equal(c.executable, baseSpec.elfPath);
  assert.equal(c.device, 'STM32F103C8');
  assert.equal(c.interface, 'swd', 'interface 应转为小写');
  assert.equal(c.gdbPath, baseSpec.gdbPath);
  assert.equal(c.serverpath, baseSpec.gdbServerPath);
  assert.equal(c.runToEntryPoint, 'main');
  assert.equal(!('svdFile' in c), true, '未提供 SVD 时不应出现该字段');
});

test('launch 配置：提供 SVD 时包含 svdFile；JTAG 转小写；CubeProgrammer 路径钉死版本', () => {
  const c = buildCortexDebugLaunch({
    ...baseSpec,
    interface: 'JTAG',
    svdFile: 'D:\\svd\\STM32F103.svd',
    cubeProgrammerPath: 'C:\\ST\\CLT\\STM32CubeProgrammer\\bin',
    request: 'launch',
  });
  assert.equal(c.svdFile, 'D:\\svd\\STM32F103.svd');
  assert.equal(c.interface, 'jtag');
  assert.equal(c.stm32cubeprogrammer, 'C:\\ST\\CLT\\STM32CubeProgrammer\\bin');
});

test('attach 配置：不写 runToEntryPoint（不下载固件）', () => {
  const c = buildCortexDebugLaunch({ ...baseSpec, request: 'attach' });
  assert.equal(c.request, 'attach');
  assert.equal(!('runToEntryPoint' in c), true);
});

test('cortex-debug 扩展 ID 正确', () => {
  assert.equal(CORTEX_DEBUG_EXTENSION_ID, 'marus25.cortex-debug');
});

// ---------- 构建类型检查 ----------

test('解析 CMakeCache 中的 CMAKE_BUILD_TYPE', () => {
  const cache = [
    '# This is the CMakeCache file.',
    '//: 5',
    'CMAKE_GENERATOR:INTERNAL=Ninja',
    'CMAKE_BUILD_TYPE:STRING=Debug',
    'CMAKE_PROJECT_NAME:STATIC=blink',
  ].join('\n');
  assert.equal(parseBuildTypeFromCMakeCache(cache), 'Debug');

  const cacheRel = 'CMAKE_BUILD_TYPE:STRING=Release';
  assert.equal(parseBuildTypeFromCMakeCache(cacheRel), 'Release');

  // 多配置生成器：值为空
  assert.equal(parseBuildTypeFromCMakeCache('CMAKE_BUILD_TYPE:STRING='), '');
  // 不存在该行
  assert.equal(parseBuildTypeFromCMakeCache('CMAKE_GENERATOR:INTERNAL=Ninja'), undefined);
});

test('可调试构建类型判定：Debug/RelWithDebInfo 可调试，Release/MinSizeRel 不可', () => {
  assert.equal(isDebuggableBuildType('Debug'), true);
  assert.equal(isDebuggableBuildType('RelWithDebInfo'), true);
  assert.equal(isDebuggableBuildType('Release'), false);
  assert.equal(isDebuggableBuildType('MinSizeRel'), false);
  // 未知/多配置（空）不阻止调试
  assert.equal(isDebuggableBuildType(undefined), true);
  assert.equal(isDebuggableBuildType(''), true);
});

// ---------- 调试工具检测：可选组件 ----------

/** 与 toolchainDetector.test 相同结构的可编程假检测环境 */
function fakeEnv(opts: {
  pathResults?: Record<string, string[]>;
  existing?: string[];
  versions?: Record<string, string>;
  cltRoots?: string[];
}): DetectionEnv {
  const existing = new Set(opts.existing ?? []);
  for (const paths of Object.values(opts.pathResults ?? {})) {
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

const CLT = 'C:\\ST\\STM32CubeCLT_1.16.0';
const GDB = path.join(CLT, 'GNU-tools-for-STM32', 'bin', 'arm-none-eabi-gdb.exe');
const GDBSVR = path.join(CLT, 'STM32CubeProgrammer', 'bin', 'ST-LINK_gdbserver.exe');
const GCC = path.join(CLT, 'GNU-tools-for-STM32', 'bin', 'arm-none-eabi-gcc.exe');
const GPP = path.join(CLT, 'GNU-tools-for-STM32', 'bin', 'arm-none-eabi-g++.exe');
const OBJCOPY = path.join(CLT, 'GNU-tools-for-STM32', 'bin', 'arm-none-eabi-objcopy.exe');
const SIZE = path.join(CLT, 'GNU-tools-for-STM32', 'bin', 'arm-none-eabi-size.exe');
const CMAKE = path.join(CLT, 'CMake', 'bin', 'cmake.exe');
const NINJA = path.join(CLT, 'Ninja', 'bin', 'ninja.exe');
const CLI = path.join(CLT, 'STM32CubeProgrammer', 'bin', 'STM32_Programmer_CLI.exe');

const FULL_VERSIONS: Record<string, string> = {
  [CMAKE]: 'cmake version 3.28.1',
  [NINJA]: '1.11.1',
  [GCC]: 'arm-none-eabi-gcc (GNU Arm Embedded) 13.2.0',
  [GPP]: 'arm-none-eabi-g++ (GNU Arm Embedded) 13.2.0',
  [OBJCOPY]: 'GNU objcopy 2.41.0',
  [SIZE]: 'GNU size 2.41.0',
  [CLI]: 'STM32CubeProgrammer v2.17.0',
  [GDB]: 'GNU gdb (GNU Arm Embedded Toolchain 13.3.Rel1) 13.3.1 20240705-git',
  [GDBSVR]: 'ST-LINK GDB Server version 2.1.0',
};

test('调试工具找到：gdb 与 GDB Server 从 CubeCLT 目录识别并确认版本', async () => {
  const env = fakeEnv({
    cltRoots: [CLT],
    existing: [GDB, GDBSVR, GCC, GPP, OBJCOPY, SIZE, CMAKE, NINJA, CLI],
    versions: FULL_VERSIONS,
  });
  const tc = await detectToolchain(env);
  assert.equal(tc.tools.armGdb.found, true);
  assert.equal(tc.tools.armGdb.version, '13.3.1');
  assert.equal(tc.tools.stlinkGdbServer.found, true);
  assert.equal(tc.tools.stlinkGdbServer.version, '2.1.0');
  assert.equal(tc.tools.stlinkGdbServer.path, GDBSVR);
});

test('调试工具缺失不影响环境完整性：complete=true 且不出现在 missing', async () => {
  const env = fakeEnv({
    cltRoots: [CLT],
    existing: [GCC, GPP, OBJCOPY, SIZE, CMAKE, NINJA, CLI],
    versions: FULL_VERSIONS,
  });
  const tc = await detectToolchain(env);
  assert.equal(tc.complete, true);
  assert.deepEqual(tc.missing, []);
  assert.equal(tc.tools.armGdb.found, false, '调试工具缺失只影响调试功能');
});

test('armToolchainPath 目录形式同时推导 gdb 路径', () => {
  const s = resolveArmToolchainSetting('C:\\ARM\\bin');
  assert.equal(s.armGdb, 'C:\\ARM\\bin\\arm-none-eabi-gdb.exe');
  const s2 = resolveArmToolchainSetting('C:\\ARM\\bin\\arm-none-eabi-gcc.exe');
  assert.equal(s2.armGdb, 'C:\\ARM\\bin\\arm-none-eabi-gdb.exe');
});
