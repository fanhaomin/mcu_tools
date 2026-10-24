/**
 * 烧录流程测试：通过注入假 Runner 模拟 STM32CubeProgrammer CLI 输出，
 * 覆盖：构建失败阻止 / 型号不确定阻止 / BIN 无地址阻止 / 无 ST-LINK /
 * 用户取消 / 连接失败 / 下载失败 / 校验失败 / 校验未确认 / 成功路径。
 * 同时校验传给 CLI 的真实参数（-c/-d/-v/-rst/地址）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProcResult,
  RunOptions,
} from '../src/util/process';
import { MemoryLogSink, Logger } from '../src/util/logger';
import { Stm32CubeProgrammerCli, ProgrammerRunner } from '../src/flash/stm32CubeProgrammer';
import { FlashDeps, FlashConfirmInfo, performFlash } from '../src/flash/programmer';
import { checkFlashPreconditions } from '../src/cmake/artifacts';
import { BuildRecord, FirmwareArtifact, McuInfo, unknownMcu } from '../src/types';

const NOW = Date.now();
const ELF_PATH = 'C:\\proj\\cmake-build-debug\\firmware.elf';
const BIN_PATH = 'C:\\proj\\cmake-build-debug\\firmware.bin';

function okResult(partial: Partial<ProcResult>): ProcResult {
  return {
    file: 'STM32_Programmer_CLI.exe',
    args: [],
    commandLine: 'STM32_Programmer_CLI.exe',
    exitCode: 0,
    stdout: '',
    stderr: '',
    signal: null,
    timedOut: false,
    cancelled: false,
    durationMs: 10,
    ...partial,
  };
}

interface Scripts {
  probes?: Partial<ProcResult>;
  connect?: Partial<ProcResult>;
  download?: Partial<ProcResult>;
  reset?: Partial<ProcResult>;
}

/** 按参数特征路由到脚本化响应的假 Runner */
function fakeRunner(scripts: Scripts): ProgrammerRunner & { calls: { op: string; args: string[] }[] } {
  const calls: { op: string; args: string[] }[] = [];
  return {
    calls,
    async run(_file: string, args: string[], _opts?: RunOptions): Promise<ProcResult> {
      if (args.includes('-l')) {
        calls.push({ op: 'probes', args });
        return okResult(scripts.probes ?? {});
      }
      if (args.includes('-d')) {
        calls.push({ op: 'download', args });
        return okResult(scripts.download ?? {});
      }
      if (args.includes('-rst')) {
        calls.push({ op: 'reset', args });
        return okResult(scripts.reset ?? {});
      }
      calls.push({ op: 'connect', args });
      return okResult(scripts.connect ?? {});
    },
  };
}

const KNOWN_MCU: McuInfo = {
  ...unknownMcu(),
  model: 'STM32G431RBTx',
  base: 'STM32G431',
  family: 'STM32G4',
  macro: 'STM32G431xx',
  confidence: 'high',
};

const GOOD_BUILD: BuildRecord = {
  id: 'b-1',
  root: 'C:\\proj',
  buildDir: 'C:\\proj\\cmake-build-debug',
  buildType: 'Debug',
  success: true,
  exitCode: 0,
  startedAt: NOW - 10_000,
  endedAt: NOW - 5_000,
  durationMs: 5_000,
};

const PROBES_OK =
  'STM32CubeProgrammer v2.17.0\n' +
  '----- Connected ST-LINK probes list -----\n' +
  'ST-LINK probe 0:\n' +
  '   SN   : 0668FF383331675067121245\n' +
  '   Firmware: V2-37,35\n';
const CONNECT_OK =
  'ST-LINK SN : 0668FF383331675067121245\n' +
  'ST-LINK Firmware version : V2-37\n' +
  'Device connected via SWD\n' +
  'SWD Frequency = 4000Khz\n' +
  'Connection mode : Normal\n' +
  'Device ID : 0x468\n' +
  'Device name : STM32G4 Category 2 Device\n';
const DOWNLOAD_OK =
  'File download complete\n' +
  'Time elapsed during download operation: 00:00:02.100\n' +
  'Download verified successfully\n';

function elfArtifact(): FirmwareArtifact {
  return { path: ELF_PATH, format: 'elf', mtimeMs: NOW - 1_000, sizeBytes: 12345 };
}

interface Setup {
  scripts?: Scripts;
  mcu?: McuInfo;
  lastBuild?: BuildRecord;
  artifacts?: FirmwareArtifact[];
  binAddress?: string;
  requireFreshBuild?: boolean;
  confirmResult?: boolean;
}

async function runFlow(setup: Setup) {
  const runner = fakeRunner(setup.scripts ?? {});
  const cli = new Stm32CubeProgrammerCli('C:\\CubeProg\\STM32_Programmer_CLI.exe', runner);
  const sink = new MemoryLogSink();
  const log = (m: string) => new Logger(sink).info(m);

  const confirmCalls: FlashConfirmInfo[] = [];
  const precheck = checkFlashPreconditions({
    lastBuild: setup.lastBuild ?? (setup.lastBuild === undefined && setup.requireFreshBuild === false ? undefined : GOOD_BUILD),
    artifacts: setup.artifacts ?? [elfArtifact()],
    mcu: setup.mcu ?? KNOWN_MCU,
    binAddress: setup.binAddress,
    requireFreshBuild: setup.requireFreshBuild ?? true,
  });

  const deps: FlashDeps = {
    cli,
    workspaceRoot: 'C:\\proj',
    mcu: setup.mcu ?? KNOWN_MCU,
    precheck,
    settings: { iface: 'SWD', speedKhz: 4000, resetAfterFlash: 'hardware' },
    confirm: async (info) => {
      confirmCalls.push(info);
      return setup.confirmResult ?? true;
    },
    log,
  };
  const outcome = await performFlash(deps);
  return { outcome, confirmCalls, runner, logs: sink };
}

test('编译失败时阻止烧录：不弹确认框、不调用 CLI', async () => {
  const { outcome, confirmCalls, runner } = await runFlow({
    lastBuild: { ...GOOD_BUILD, success: false, exitCode: 1 },
  });
  assert.equal(outcome.status, 'blocked');
  assert.equal(confirmCalls.length, 0, '不得弹出烧录确认窗口');
  assert.equal(runner.calls.length, 0, '不得调用任何 CLI 命令');
  assert.ok(outcome.blocker!.includes('编译失败'));
});

test('芯片型号不确定时阻止烧录', async () => {
  const { outcome, runner } = await runFlow({
    mcu: { ...unknownMcu(), family: 'STM32L4' },
  });
  assert.equal(outcome.status, 'blocked');
  assert.equal(runner.calls.length, 0);
  assert.ok(outcome.blocker!.includes('芯片型号待确认'));
});

test('BIN 地址未确认时阻止烧录', async () => {
  const { outcome, runner } = await runFlow({
    artifacts: [{ path: BIN_PATH, format: 'bin', mtimeMs: NOW - 1_000, sizeBytes: 4096 }],
    // 不提供 binAddress
  });
  assert.equal(outcome.status, 'blocked');
  assert.equal(runner.calls.length, 0);
  assert.ok(outcome.blocker!.includes('BIN'));
});

test('未检测到 ST-LINK 时：明确区分“工具存在”与“硬件在线”', async () => {
  const { outcome, confirmCalls, runner } = await runFlow({
    scripts: { probes: { stdout: 'No connected ST-LINK probe detected\n', exitCode: 0 } },
  });
  assert.equal(outcome.status, 'no-probe');
  assert.equal(confirmCalls.length, 0, '没有硬件就不应请求用户确认烧录');
  assert.equal(runner.calls.length, 1, '只应执行 -l 列表命令');
  assert.ok(outcome.messages.length >= 2, '应给出排查提示');
});

test('用户取消烧录：确认框弹出但下载不会执行', async () => {
  const { outcome, confirmCalls, runner } = await runFlow({
    scripts: { probes: { stdout: PROBES_OK }, connect: { stdout: CONNECT_OK }, download: { stdout: DOWNLOAD_OK } },
    confirmResult: false,
  });
  assert.equal(outcome.status, 'cancelled');
  assert.equal(confirmCalls.length, 1);
  assert.equal(runner.calls.filter((c) => c.op === 'download').length, 0, '取消后不得下载');
  assert.equal(runner.calls.filter((c) => c.op === 'reset').length, 0);
});

test('目标芯片无法连接：连接失败即终止，不下载', async () => {
  const { outcome, runner } = await runFlow({
    scripts: {
      probes: { stdout: PROBES_OK },
      connect: { stdout: 'Error: No cortex-m sw device found\n', exitCode: 1 },
    },
  });
  assert.equal(outcome.status, 'connect-failed');
  assert.ok(outcome.messages.some((m) => m.includes('无法连接')));
  assert.equal(runner.calls.filter((c) => c.op === 'download').length, 0);
});

test('下载失败：退出码非 0', async () => {
  const { outcome } = await runFlow({
    scripts: {
      probes: { stdout: PROBES_OK },
      connect: { stdout: CONNECT_OK },
      download: { stdout: 'Error: Download failed\n', exitCode: 1 },
    },
  });
  assert.equal(outcome.status, 'download-failed');
  assert.equal(outcome.downloaded, false);
});

test('校验失败：下载完成但输出包含校验错误', async () => {
  const { outcome } = await runFlow({
    scripts: {
      probes: { stdout: PROBES_OK },
      connect: { stdout: CONNECT_OK },
      download: {
        stdout: 'File download complete\nError: Verification failed\n',
        exitCode: 1,
      },
    },
  });
  assert.equal(outcome.status, 'verify-failed');
  assert.equal(outcome.downloaded, true);
  assert.equal(outcome.verify, 'failed');
});

test('校验状态未确认：下载成功但输出中没有校验结果行', async () => {
  const { outcome } = await runFlow({
    scripts: {
      probes: { stdout: PROBES_OK },
      connect: { stdout: CONNECT_OK },
      download: { stdout: 'File download complete\n', exitCode: 0 },
    },
  });
  assert.equal(outcome.status, 'verify-unconfirmed');
  assert.equal(outcome.downloaded, true);
  assert.equal(outcome.verify, 'unconfirmed');
  assert.ok(outcome.messages.some((m) => m.includes('校验状态未确认')));
});

test('成功路径：ELF 无需地址，完整执行 探头->连接->确认->下载+校验->复位', async () => {
  const { outcome, confirmCalls, runner } = await runFlow({
    scripts: {
      probes: { stdout: PROBES_OK },
      connect: { stdout: CONNECT_OK },
      download: { stdout: DOWNLOAD_OK, exitCode: 0 },
      reset: { stdout: 'System reset is performed\n', exitCode: 0 },
    },
  });

  assert.equal(outcome.status, 'success');
  assert.equal(outcome.downloaded, true);
  assert.equal(outcome.verify, 'passed');

  // 参数校验：真实 CLI 语法
  const probeCall = runner.calls.find((c) => c.op === 'probes')!;
  assert.deepEqual(probeCall.args, ['-l']);
  const connectCall = runner.calls.find((c) => c.op === 'connect')!;
  assert.deepEqual(connectCall.args, ['-c', 'port=SWD', 'freq=4000']);
  const downloadCall = runner.calls.find((c) => c.op === 'download')!;
  assert.deepEqual(downloadCall.args, [
    '-c', 'port=SWD', 'freq=4000',
    '-d', ELF_PATH,
    '-v',
  ]);
  const resetCall = runner.calls.find((c) => c.op === 'reset')!;
  assert.deepEqual(resetCall.args, ['-c', 'port=SWD', 'freq=4000', '-rst', 'hw']);

  // 确认窗口内容完整性
  assert.equal(confirmCalls.length, 1);
  const info = confirmCalls[0];
  assert.equal(info.workspacePath, 'C:\\proj');
  assert.equal(info.mcuModel, 'STM32G431');
  assert.equal(info.probeStatus, '已检测到 1 个 ST-LINK');
  assert.ok(info.targetStatus.includes('已连接'));
  assert.equal(info.filePath, ELF_PATH);
  assert.equal(info.format, 'ELF');
  assert.equal(info.binAddress, undefined);
  assert.equal(info.stale, false);
});

test('成功路径：BIN 使用确认的地址；软件复位配置生效', async () => {
  const binArtifact: FirmwareArtifact = {
    path: BIN_PATH,
    format: 'bin',
    mtimeMs: NOW - 1_000,
    sizeBytes: 4096,
  };
  const runner = fakeRunner({
    probes: { stdout: PROBES_OK },
    connect: { stdout: CONNECT_OK },
    download: { stdout: DOWNLOAD_OK },
    reset: { stdout: 'ok', exitCode: 0 },
  });
  const cli = new Stm32CubeProgrammerCli('cli.exe', runner);
  const precheck = checkFlashPreconditions({
    lastBuild: GOOD_BUILD,
    artifacts: [binArtifact],
    mcu: KNOWN_MCU,
    binAddress: '0x08000000',
  });
  const outcome = await performFlash({
    cli,
    workspaceRoot: 'C:\\proj',
    mcu: KNOWN_MCU,
    precheck,
    settings: { iface: 'SWD', speedKhz: 4000, resetAfterFlash: 'software' },
    confirm: async () => true,
    log: (m) => new Logger(new MemoryLogSink()).info(m),
  });

  assert.equal(outcome.status, 'success');
  const downloadCall = runner.calls.find((c) => c.op === 'download')!;
  assert.deepEqual(downloadCall.args, [
    '-c', 'port=SWD', 'freq=4000',
    '-d', BIN_PATH,
    '0x08000000',
    '-v',
  ], 'BIN 必须紧跟烧录地址');
  const resetCall = runner.calls.find((c) => c.op === 'reset')!;
  assert.deepEqual(resetCall.args, ['-c', 'port=SWD', 'freq=4000', '-rst', 'sw']);
});

test('下载与校验解析器：直接针对 CLI 真实输出片段', async () => {
  const { parseDownloadResult, parseProbeList, parseConnectResult } = await import(
    '../src/flash/verification'
  );

  const dl = parseDownloadResult(DOWNLOAD_OK, 0, true);
  assert.equal(dl.downloaded, true);
  assert.equal(dl.verify, 'passed');

  const dl2 = parseDownloadResult('File download complete\n', 0, true);
  assert.equal(dl2.verify, 'unconfirmed', '退出码 0 不等于校验成功');

  const probes = parseProbeList(PROBES_OK);
  assert.equal(probes.count, 1);
  assert.equal(probes.probes[0].serial, '0668FF383331675067121245');

  const none = parseProbeList('No connected ST-LINK probe detected\n');
  assert.equal(none.count, 0);

  const conn = parseConnectResult(CONNECT_OK, 0);
  assert.equal(conn.connected, true);
  assert.equal(conn.deviceName, 'STM32G4 Category 2 Device');
  assert.equal(conn.deviceId, '0x468');

  const fail = parseConnectResult('Error: No cortex-m sw device found', 1);
  assert.equal(fail.connected, false);
});
