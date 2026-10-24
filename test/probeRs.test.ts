/**
 * probe-rs 引擎测试：芯片名推导 / launch 配置字段（基于扩展 0.32 真实 schema）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROBE_RS_EXTENSION_ID,
  buildProbeRsLaunch,
  deriveProbeRsChip,
} from '../src/debug/debugConfig';

test('芯片名推导：去封装后缀，家族名返回 undefined', () => {
  assert.equal(deriveProbeRsChip('STM32F103C8T6'), 'STM32F103C8');
  assert.equal(deriveProbeRsChip('STM32G431RBTx'), 'STM32G431RB');
  assert.equal(deriveProbeRsChip('STM32F103'), undefined, '家族级无法定位唯一芯片');
  assert.equal(deriveProbeRsChip(''), undefined);
});

test('launch 配置：flash + 复位停机 + SVD 下发到 coreConfigs', () => {
  const c = buildProbeRsLaunch({
    root: 'D:\\work\\proj',
    elfPath: 'D:\\work\\proj\\build-auto\\cs_test.elf',
    chip: 'STM32F103C8',
    interface: 'SWD',
    speedKhz: 4000,
    svdFile: 'D:\\svd\\STM32F103.svd',
    request: 'launch',
  });
  assert.equal(c.type, 'probe-rs-debug');
  assert.equal(c.request, 'launch');
  assert.equal(c.chip, 'STM32F103C8');
  assert.equal(c.speed, 4000);
  assert.equal(c.wireProtocol, 'Swd');
  const cj = buildProbeRsLaunch({
    root: 'D:\\work\\proj',
    elfPath: 'D:\\work\\proj\\build-auto\\cs_test.elf',
    chip: 'STM32F103C8',
    interface: 'JTAG',
    speedKhz: 4000,
    request: 'launch',
  });
  assert.equal(cj.wireProtocol, 'Jtag', 'JTAG 应映射为枚举变体 Jtag');
  assert.equal(!('probe' in c), true, '未指定探针时应省略字段（0.32 不接受 "auto"）');
  const cores = c.coreConfigs as Array<Record<string, unknown>>;
  assert.equal(cores.length, 1);
  assert.equal(cores[0].coreIndex, 0);
  assert.equal(cores[0].programBinary, 'D:\\work\\proj\\build-auto\\cs_test.elf');
  assert.equal(cores[0].svdFile, 'D:\\svd\\STM32F103.svd');
  const flash = c.flashingConfig as Record<string, unknown>;
  assert.equal(flash.flashingEnabled, true, 'launch 应由调试会话烧写固件');
  assert.equal(flash.haltAfterReset, true, '复位后停机等价于停在入口');
  assert.equal(flash.verifyAfterFlashing, true);
});

test('attach 配置：不烧写、不复位', () => {
  const c = buildProbeRsLaunch({
    root: 'D:\\work\\proj',
    elfPath: 'D:\\work\\proj\\build-auto\\cs_test.elf',
    chip: 'STM32F103C8',
    interface: 'SWD',
    speedKhz: 4000,
    request: 'attach',
  });
  assert.equal(c.request, 'attach');
  assert.equal(c.flashingConfig, undefined, 'attach 不应携带烧写配置');
});

test('probe-rs 扩展 ID 正确', () => {
  assert.equal(PROBE_RS_EXTENSION_ID, 'probe-rs.probe-rs-debugger');
});
