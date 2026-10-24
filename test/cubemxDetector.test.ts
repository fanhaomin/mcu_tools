/**
 * STM32CubeMX 探测测试：设置覆盖 → 标准目录 → 版本化目录（取最新）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CubeMxDetectionEnv, findCubeMx } from '../src/detection/cubemxDetector';

function fakeEnv(existing: Set<string>, dirs: Record<string, string[]>): CubeMxDetectionEnv {
  return {
    async exists(p: string) {
      return existing.has(p);
    },
    async listDirs(dir: string) {
      return dirs[dir] ?? [];
    },
  };
}

test('设置覆盖优先于一切候选', async () => {
  const env = fakeEnv(new Set(['D:\\my\\STM32CubeMX.exe']), {});
  const r = await findCubeMx(env, 'D:\\my\\STM32CubeMX.exe');
  assert.equal(r, 'D:\\my\\STM32CubeMX.exe');
});

test('标准安装目录命中', async () => {
  const std = 'C:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeMX\\STM32CubeMX.exe';
  const env = fakeEnv(new Set([std]), {});
  assert.equal(await findCubeMx(env, undefined), std);
});

test('版本化目录取最新版本', async () => {
  const old = 'C:\\ST\\STM32CubeMX_6.9.0\\STM32CubeMX.exe';
  const cur = 'C:\\ST\\STM32CubeMX_6.12.1\\STM32CubeMX.exe';
  const env = fakeEnv(new Set([old, cur]), {
    'C:\\ST': ['STM32CubeMX_6.9.0', 'STM32CubeMX_6.12.1'],
  });
  assert.equal(await findCubeMx(env, undefined), cur);
});

test('什么都不存在时返回 undefined', async () => {
  const env = fakeEnv(new Set(), {});
  assert.equal(await findCubeMx(env, undefined), undefined);
});
