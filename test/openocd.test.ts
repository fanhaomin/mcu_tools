/**
 * DAP-Link（CMSIS-DAP）OpenOCD 烧录后端测试：target cfg 推导、命令参数、
 * 探测/烧录输出解析（凭据判定与诚实降级）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openOcdTargetCfg,
  openOcdDetectArgs,
  openOcdFlashArgs,
  parseOpenOcdDetect,
  parseOpenOcdFlash,
} from '../src/flash/openocd';

test('openOcdTargetCfg：主流家族映射', () => {
  assert.equal(openOcdTargetCfg('STM32H723VGTX'), 'target/stm32h7x.cfg');
  assert.equal(openOcdTargetCfg('STM32F103C8'), 'target/stm32f1x.cfg');
  assert.equal(openOcdTargetCfg('stm32g431rbt6'), 'target/stm32g4x.cfg');
  assert.equal(openOcdTargetCfg('STM32U575'), 'target/stm32u5x.cfg');
  assert.equal(openOcdTargetCfg('GD32F303'), undefined, '非 ST 型号不猜 cfg');
  assert.equal(openOcdTargetCfg(''), undefined);
});

test('openOcdDetectArgs / openOcdFlashArgs：参数形态', () => {
  const det = openOcdDetectArgs('target/stm32h7x.cfg', 4000);
  assert.ok(det.includes('interface/cmsis-dap.cfg'));
  assert.ok(det.some((a) => a.includes('adapter speed 4000')));
  assert.ok(det.some((a) => a.includes('init; targets; shutdown')));

  const elf = openOcdFlashArgs('build/app.elf', undefined, 'hardware', 'target/stm32h7x.cfg', 4000);
  assert.ok(elf.some((a) => a.includes('program "build/app.elf" verify reset exit')));
  const bin = openOcdFlashArgs('app.bin', '0x08000000', 'none', 'target/stm32f1x.cfg', 1000);
  assert.ok(bin.some((a) => a.includes('program "app.bin" 0x08000000 verify exit')), 'BIN 带地址；none 不复位');
});

test('parseOpenOcdDetect：探头缺失与在线', () => {
  const missing = parseOpenOcdDetect({
    exitCode: 1, stdout: '', stderr: 'Error: unable to find CMSIS-DAP device', spawnError: undefined,
  } as never);
  assert.equal(missing.connected, false);
  assert.equal(missing.noProbe, true);

  const online = parseOpenOcdDetect({
    exitCode: 0, stdout: 'TargetName: stm32h7x.cpu\ntarget halted', stderr: '', spawnError: undefined,
  } as never);
  assert.equal(online.connected, true);
  assert.equal(online.noProbe, false);
});

test('parseOpenOcdFlash：成功凭据 / 校验失败 / 未确认', () => {
  const ok = parseOpenOcdFlash({
    exitCode: 0,
    stdout: '** Programming Finished **\n** Verify Started **\nverified 1234 bytes in 10ms\n** Resetting Target **',
    stderr: '', spawnError: undefined,
  } as never);
  assert.equal(ok.downloaded, true);
  assert.equal(ok.verify, 'passed');

  const bad = parseOpenOcdFlash({
    exitCode: 1, stdout: '', stderr: 'Error: failed to erase flash', spawnError: undefined,
  } as never);
  assert.equal(bad.downloaded, false);
  assert.equal(bad.verify, 'failed');

  const unsure = parseOpenOcdFlash({
    exitCode: 0, stdout: '** Programming Finished **', stderr: '', spawnError: undefined,
  } as never);
  assert.equal(unsure.downloaded, true);
  assert.equal(unsure.verify, 'unconfirmed', '无 verified 凭据时如实降级');
});
