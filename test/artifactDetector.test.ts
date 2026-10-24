/**
 * 构建产物与烧录门禁测试：
 * ELF/HEX/BIN 识别与选择、新鲜度判定、BIN 地址校验、
 * 编译失败阻止烧录、型号不确定阻止烧录。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import {
  BUILD_STATE_FILE,
  checkFlashPreconditions,
  findArtifacts,
  isValidHexAddress,
  readPersistedState,
  selectFirmware,
  writePersistedState,
} from '../src/cmake/artifacts';
import { BuildRecord, FirmwareArtifact, unknownMcu } from '../src/types';
import { makeTempDir, write, cleanup, utime } from './helpers/fixtures';

const NOW = Date.now();

function freshRecord(success: boolean, startedAt = NOW - 10_000): BuildRecord {
  return {
    id: 'b-test',
    root: 'C:\\proj',
    buildDir: 'C:\\proj\\cmake-build-debug',
    buildType: 'Debug',
    success,
    exitCode: success ? 0 : 1,
    startedAt,
    endedAt: NOW - 5_000,
    durationMs: 5_000,
  };
}

function artifact(
  fmt: FirmwareArtifact['format'],
  mtimeMs: number,
  name = `firmware.${fmt}`,
): FirmwareArtifact {
  return { path: `C:\\proj\\cmake-build-debug\\${name}`, format: fmt, mtimeMs, sizeBytes: 1024 };
}

test('ELF/HEX/BIN 文件识别：从构建目录真实扫描', async () => {
  const tmp = makeTempDir();
  try {
    write(tmp, 'CMakeFiles/scratch/main.elf', 'x');
    const elf = write(tmp, 'project.elf', 'elf');
    const hex = write(tmp, 'project.hex', 'hex');
    const bin = write(tmp, 'out/project.bin', 'bin');
    utime(elf, NOW - 60_000);
    utime(hex, NOW - 30_000);
    utime(bin, NOW);

    const found = await findArtifacts(tmp);
    assert.equal(found.length, 3, 'CMakeFiles 内的文件不应计入');
    const formats = new Set(found.map((f) => f.format));
    assert.deepEqual([...formats].sort(), ['bin', 'elf', 'hex']);

    // 默认按 mtime 降序
    assert.equal(found[0].path.toLowerCase(), bin.toLowerCase());
  } finally {
    cleanup(tmp);
  }
});

test('产物选择：优先 ELF > HEX > BIN', () => {
  const elf = artifact('elf', NOW);
  const hex = artifact('hex', NOW);
  const bin = artifact('bin', NOW);
  assert.equal(selectFirmware([bin, hex, elf]), elf);
  assert.equal(selectFirmware([bin, hex]), hex);
  assert.equal(selectFirmware([bin]), bin);
  assert.equal(selectFirmware([]), undefined);
});

test('HEX 地址校验函数', () => {
  assert.equal(isValidHexAddress('0x08000000'), true);
  assert.equal(isValidHexAddress('0x8000000'), true);
  assert.equal(isValidHexAddress('0X0800FF00'), true);
  assert.equal(isValidHexAddress('08000000'), false, '缺少 0x 前缀');
  assert.equal(isValidHexAddress('0xZZZZ'), false);
  assert.equal(isValidHexAddress(''), false);
  assert.equal(isValidHexAddress(undefined), false);
});

test('烧录门禁：编译失败时阻止烧录（防误烧旧固件）', () => {
  const pre = checkFlashPreconditions({
    lastBuild: freshRecord(false),
    artifacts: [artifact('elf', NOW)],
    mcu: { ...unknownMcu(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' },
  });
  assert.equal(pre.ok, false);
  assert.ok(pre.blockers.some((b) => b.includes('编译失败')));
  assert.ok(pre.blockers.some((b) => b.includes('旧固件')));
});

test('烧录门禁：从未编译过时阻止烧录', () => {
  const pre = checkFlashPreconditions({
    artifacts: [artifact('elf', NOW)],
    mcu: { ...unknownMcu(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' },
  });
  assert.equal(pre.ok, false);
  assert.ok(pre.blockers.some((b) => b.includes('尚未执行过编译')));
});

test('烧录门禁：产物早于构建开始时间视为旧产物并阻止', () => {
  const rec = freshRecord(true);
  const stale = artifact('elf', rec.startedAt - 60_000);
  const pre = checkFlashPreconditions({
    lastBuild: rec,
    artifacts: [stale],
    mcu: { ...unknownMcu(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' },
  });
  assert.equal(pre.ok, false);
  assert.equal(pre.stale, true);
  assert.ok(pre.blockers.some((b) => b.includes('旧产物')));

  // 构建期间生成的新产物应通过
  const fresh = artifact('elf', rec.startedAt + 1_000);
  const pre2 = checkFlashPreconditions({
    lastBuild: rec,
    artifacts: [fresh],
    mcu: { ...unknownMcu(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' },
  });
  assert.equal(pre2.ok, true);
  assert.equal(pre2.stale, false);

  // Ninja "无需重做" 场景：ELF 未被重写（mtime 仍为旧值），
  // 但构建记录本身指向该 ELF —— 视为本次构建的产物
  const unchangedElf = artifact('elf', rec.startedAt - 60_000, 'firmware.elf');
  const recPointingAtIt: BuildRecord = { ...rec, elfPath: unchangedElf.path, elfMtimeMs: unchangedElf.mtimeMs };
  const pre3 = checkFlashPreconditions({
    lastBuild: recPointingAtIt,
    artifacts: [unchangedElf],
    mcu: { ...unknownMcu(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' },
  });
  assert.equal(pre3.ok, true, '构建记录指向的 ELF 应视为本次构建产物');
  assert.equal(pre3.stale, false);
});

test('烧录门禁：芯片型号待确认时阻止烧录', () => {
  const rec = freshRecord(true);
  const pre = checkFlashPreconditions({
    lastBuild: rec,
    artifacts: [artifact('elf', NOW)],
    mcu: { ...unknownMcu(), family: 'STM32L4' }, // 只有家族级证据
  });
  assert.equal(pre.ok, false);
  assert.ok(pre.blockers.some((b) => b.includes('芯片型号待确认')));

  // 用户确认家族级型号后允许（确认窗口仍会展示）
  const pre2 = checkFlashPreconditions({
    lastBuild: rec,
    artifacts: [artifact('elf', NOW)],
    mcu: { ...unknownMcu(), family: 'STM32L4', confirmedByUser: true, base: 'STM32L431', model: 'STM32L431xx', macro: 'STM32L431xx' },
  });
  assert.equal(pre2.ok, true);
});

test('烧录门禁：BIN 文件必须确认地址', () => {
  const mcu = { ...unknownMcu(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' };
  const rec = freshRecord(true);

  const noAddr = checkFlashPreconditions({
    lastBuild: rec,
    artifacts: [artifact('bin', NOW)],
    mcu,
  });
  assert.equal(noAddr.ok, false);
  assert.ok(noAddr.blockers.some((b) => b.includes('BIN')));

  const badAddr = checkFlashPreconditions({
    lastBuild: rec,
    artifacts: [artifact('bin', NOW)],
    mcu,
    binAddress: 'not-an-address',
  });
  assert.equal(badAddr.ok, false);

  const okAddr = checkFlashPreconditions({
    lastBuild: rec,
    artifacts: [artifact('bin', NOW)],
    mcu,
    binAddress: '0x08000000',
  });
  assert.equal(okAddr.ok, true);
  assert.equal(okAddr.binAddress, '0x08000000');

  // ELF 不需要地址
  const elfPre = checkFlashPreconditions({
    lastBuild: rec,
    artifacts: [artifact('elf', NOW)],
    mcu,
  });
  assert.equal(elfPre.ok, true);
  assert.equal(elfPre.binAddress, undefined);
});

test('烧录现有固件模式（requireFreshBuild=false）：产物可用但标记 stale', () => {
  const mcu = { ...unknownMcu(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' };
  const old = artifact('hex', NOW - 3_600_000, 'release.hex');
  const pre = checkFlashPreconditions({
    artifacts: [old],
    mcu,
    requireFreshBuild: false,
  });
  assert.equal(pre.ok, true, '显式烧录现有固件不要求构建记录');
  assert.equal(pre.stale, true, '但必须标记为非本次构建产物');
  assert.ok(pre.warnings.some((w) => w.includes('不是最近一次成功构建的产物')));
});

test('构建状态持久化：写入后可读回（含上次构建记录）', async () => {
  const tmp = makeTempDir();
  try {
    const before = await readPersistedState(tmp);
    assert.equal(before, undefined, '尚无状态文件');

    const rec = freshRecord(true);
    await writePersistedState(tmp, { version: 1, createdByAutoCmakeFlash: true, lastBuild: rec });
    const after = await readPersistedState(tmp);
    assert.ok(after);
    assert.equal(after!.createdByAutoCmakeFlash, true);
    assert.equal(after!.lastBuild!.id, 'b-test');
    assert.equal(path.basename(after?.lastBuild!.buildDir ?? ''), 'cmake-build-debug');
  } finally {
    cleanup(tmp);
  }
});

test('BUILD_STATE_FILE 位于构建目录根部', () => {
  assert.equal(BUILD_STATE_FILE, 'buildstate.json');
});

test('配置判定：只有 CMakeCache 而无 build.ninja 时不得视为已配置（防跳过配置直接编译）', async () => {
  const { isConfigured, readCMakeCacheInfo } = await import('../src/cmake/build');
  const tmp = makeTempDir();
  try {
    // 尚未配置
    assert.equal(await isConfigured(tmp), false);

    // 失败的 configure：残留 CMakeCache.txt（含生成器）但没有 build.ninja
    write(tmp, 'CMakeCache.txt', 'CMAKE_GENERATOR:INTERNAL=Ninja\nCMAKE_BUILD_TYPE:STRING=Debug');
    const info = await readCMakeCacheInfo(tmp);
    assert.equal(info.generator, 'Ninja');
    assert.equal(await isConfigured(tmp), false, '缺少 build.ninja 必须重新配置');

    // 完成配置后
    write(tmp, 'build.ninja', '# generated');
    assert.equal(await isConfigured(tmp), true);

    // Makefile 生成器同理
    const tmp2 = makeTempDir();
    try {
      write(tmp2, 'CMakeCache.txt', 'CMAKE_GENERATOR:INTERNAL=MinGW Makefiles');
      assert.equal(await isConfigured(tmp2), false);
      write(tmp2, 'Makefile', '# generated');
      assert.equal(await isConfigured(tmp2), true);
    } finally {
      cleanup(tmp2);
    }
  } finally {
    cleanup(tmp);
  }
});
