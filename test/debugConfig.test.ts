/**
 * 调试功能测试：CMakeCache 构建类型解析 / 可调试构建类型判定 /
 * 调试工具为可选组件（不参与 complete 判定）。
 * （probe-rs launch 配置生成的测试见 flashFlow.test.ts；cortex-debug 引擎已移除）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import {
  isDebuggableBuildType,
  parseBuildTypeFromCMakeCache,
} from '../src/debug/debugConfig';
import {
  DetectionEnv,
  VersionProbeResult,
  detectToolchain,
  resolveArmToolchainSetting,
} from '../src/detection/toolchainDetector';

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
};

test('核心工具从 CubeCLT 目录识别并确认版本（GDB/GDBServer 已随 cortex-debug 移除，不再探测）', async () => {
  const env = fakeEnv({
    cltRoots: [CLT],
    existing: [GCC, GPP, OBJCOPY, SIZE, CMAKE, NINJA, CLI],
    versions: FULL_VERSIONS,
  });
  const tc = await detectToolchain(env);
  assert.equal(tc.complete, true);
  assert.deepEqual(tc.missing, []);
  assert.equal(tc.tools.armGcc.version, '13.2.0');
  assert.equal(tc.tools.programmerCli.version, '2.17.0');
});
