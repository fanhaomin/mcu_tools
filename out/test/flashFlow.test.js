"use strict";
/**
 * 烧录流程测试：通过注入假 Runner 模拟 STM32CubeProgrammer CLI 输出，
 * 覆盖：构建失败阻止 / 型号不确定阻止 / BIN 无地址阻止 / 无 ST-LINK /
 * 用户取消 / 连接失败 / 下载失败 / 校验失败 / 校验未确认 / 成功路径。
 * 同时校验传给 CLI 的真实参数（-c/-d/-v/-rst/地址）。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const logger_1 = require("../src/util/logger");
const stm32CubeProgrammer_1 = require("../src/flash/stm32CubeProgrammer");
const programmer_1 = require("../src/flash/programmer");
const artifacts_1 = require("../src/cmake/artifacts");
const types_1 = require("../src/types");
const NOW = Date.now();
const ELF_PATH = 'C:\\proj\\cmake-build-debug\\firmware.elf';
const BIN_PATH = 'C:\\proj\\cmake-build-debug\\firmware.bin';
function okResult(partial) {
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
/** 按参数特征路由到脚本化响应的假 Runner */
function fakeRunner(scripts) {
    const calls = [];
    return {
        calls,
        async run(_file, args, _opts) {
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
const KNOWN_MCU = {
    ...(0, types_1.unknownMcu)(),
    model: 'STM32G431RBTx',
    base: 'STM32G431',
    family: 'STM32G4',
    macro: 'STM32G431xx',
    confidence: 'high',
};
const GOOD_BUILD = {
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
const PROBES_OK = 'STM32CubeProgrammer v2.17.0\n' +
    '----- Connected ST-LINK probes list -----\n' +
    'ST-LINK probe 0:\n' +
    '   SN   : 0668FF383331675067121245\n' +
    '   Firmware: V2-37,35\n';
const CONNECT_OK = 'ST-LINK SN : 0668FF383331675067121245\n' +
    'ST-LINK Firmware version : V2-37\n' +
    'Device connected via SWD\n' +
    'SWD Frequency = 4000Khz\n' +
    'Connection mode : Normal\n' +
    'Device ID : 0x468\n' +
    'Device name : STM32G4 Category 2 Device\n';
const DOWNLOAD_OK = 'File download complete\n' +
    'Time elapsed during download operation: 00:00:02.100\n' +
    'Download verified successfully\n';
function elfArtifact() {
    return { path: ELF_PATH, format: 'elf', mtimeMs: NOW - 1_000, sizeBytes: 12345 };
}
async function runFlow(setup) {
    const runner = fakeRunner(setup.scripts ?? {});
    const cli = new stm32CubeProgrammer_1.Stm32CubeProgrammerCli('C:\\CubeProg\\STM32_Programmer_CLI.exe', runner);
    const sink = new logger_1.MemoryLogSink();
    const log = (m) => new logger_1.Logger(sink).info(m);
    const confirmCalls = [];
    const precheck = (0, artifacts_1.checkFlashPreconditions)({
        lastBuild: setup.lastBuild ?? (setup.lastBuild === undefined && setup.requireFreshBuild === false ? undefined : GOOD_BUILD),
        artifacts: setup.artifacts ?? [elfArtifact()],
        mcu: setup.mcu ?? KNOWN_MCU,
        binAddress: setup.binAddress,
        requireFreshBuild: setup.requireFreshBuild ?? true,
    });
    const deps = {
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
    const outcome = await (0, programmer_1.performFlash)(deps);
    return { outcome, confirmCalls, runner, logs: sink };
}
(0, node_test_1.test)('编译失败时阻止烧录：不弹确认框、不调用 CLI', async () => {
    const { outcome, confirmCalls, runner } = await runFlow({
        lastBuild: { ...GOOD_BUILD, success: false, exitCode: 1 },
    });
    strict_1.default.equal(outcome.status, 'blocked');
    strict_1.default.equal(confirmCalls.length, 0, '不得弹出烧录确认窗口');
    strict_1.default.equal(runner.calls.length, 0, '不得调用任何 CLI 命令');
    strict_1.default.ok(outcome.blocker.includes('编译失败'));
});
(0, node_test_1.test)('芯片型号不确定时阻止烧录', async () => {
    const { outcome, runner } = await runFlow({
        mcu: { ...(0, types_1.unknownMcu)(), family: 'STM32L4' },
    });
    strict_1.default.equal(outcome.status, 'blocked');
    strict_1.default.equal(runner.calls.length, 0);
    strict_1.default.ok(outcome.blocker.includes('芯片型号待确认'));
});
(0, node_test_1.test)('BIN 地址未确认时阻止烧录', async () => {
    const { outcome, runner } = await runFlow({
        artifacts: [{ path: BIN_PATH, format: 'bin', mtimeMs: NOW - 1_000, sizeBytes: 4096 }],
        // 不提供 binAddress
    });
    strict_1.default.equal(outcome.status, 'blocked');
    strict_1.default.equal(runner.calls.length, 0);
    strict_1.default.ok(outcome.blocker.includes('BIN'));
});
(0, node_test_1.test)('未检测到 ST-LINK 时：明确区分“工具存在”与“硬件在线”', async () => {
    const { outcome, confirmCalls, runner } = await runFlow({
        scripts: { probes: { stdout: 'No connected ST-LINK probe detected\n', exitCode: 0 } },
    });
    strict_1.default.equal(outcome.status, 'no-probe');
    strict_1.default.equal(confirmCalls.length, 0, '没有硬件就不应请求用户确认烧录');
    strict_1.default.equal(runner.calls.length, 1, '只应执行 -l 列表命令');
    strict_1.default.ok(outcome.messages.length >= 2, '应给出排查提示');
});
(0, node_test_1.test)('用户取消烧录：确认框弹出但下载不会执行', async () => {
    const { outcome, confirmCalls, runner } = await runFlow({
        scripts: { probes: { stdout: PROBES_OK }, connect: { stdout: CONNECT_OK }, download: { stdout: DOWNLOAD_OK } },
        confirmResult: false,
    });
    strict_1.default.equal(outcome.status, 'cancelled');
    strict_1.default.equal(confirmCalls.length, 1);
    strict_1.default.equal(runner.calls.filter((c) => c.op === 'download').length, 0, '取消后不得下载');
    strict_1.default.equal(runner.calls.filter((c) => c.op === 'reset').length, 0);
});
(0, node_test_1.test)('目标芯片无法连接：连接失败即终止，不下载', async () => {
    const { outcome, runner } = await runFlow({
        scripts: {
            probes: { stdout: PROBES_OK },
            connect: { stdout: 'Error: No cortex-m sw device found\n', exitCode: 1 },
        },
    });
    strict_1.default.equal(outcome.status, 'connect-failed');
    strict_1.default.ok(outcome.messages.some((m) => m.includes('无法连接')));
    strict_1.default.equal(runner.calls.filter((c) => c.op === 'download').length, 0);
});
(0, node_test_1.test)('下载失败：退出码非 0', async () => {
    const { outcome } = await runFlow({
        scripts: {
            probes: { stdout: PROBES_OK },
            connect: { stdout: CONNECT_OK },
            download: { stdout: 'Error: Download failed\n', exitCode: 1 },
        },
    });
    strict_1.default.equal(outcome.status, 'download-failed');
    strict_1.default.equal(outcome.downloaded, false);
});
(0, node_test_1.test)('校验失败：下载完成但输出包含校验错误', async () => {
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
    strict_1.default.equal(outcome.status, 'verify-failed');
    strict_1.default.equal(outcome.downloaded, true);
    strict_1.default.equal(outcome.verify, 'failed');
});
(0, node_test_1.test)('校验状态未确认：下载成功但输出中没有校验结果行', async () => {
    const { outcome } = await runFlow({
        scripts: {
            probes: { stdout: PROBES_OK },
            connect: { stdout: CONNECT_OK },
            download: { stdout: 'File download complete\n', exitCode: 0 },
        },
    });
    strict_1.default.equal(outcome.status, 'verify-unconfirmed');
    strict_1.default.equal(outcome.downloaded, true);
    strict_1.default.equal(outcome.verify, 'unconfirmed');
    strict_1.default.ok(outcome.messages.some((m) => m.includes('校验状态未确认')));
});
(0, node_test_1.test)('成功路径：ELF 无需地址，完整执行 探头->连接->确认->下载+校验->复位', async () => {
    const { outcome, confirmCalls, runner } = await runFlow({
        scripts: {
            probes: { stdout: PROBES_OK },
            connect: { stdout: CONNECT_OK },
            download: { stdout: DOWNLOAD_OK, exitCode: 0 },
            reset: { stdout: 'System reset is performed\n', exitCode: 0 },
        },
    });
    strict_1.default.equal(outcome.status, 'success');
    strict_1.default.equal(outcome.downloaded, true);
    strict_1.default.equal(outcome.verify, 'passed');
    // 参数校验：真实 CLI 语法
    const probeCall = runner.calls.find((c) => c.op === 'probes');
    strict_1.default.deepEqual(probeCall.args, ['-l']);
    const connectCall = runner.calls.find((c) => c.op === 'connect');
    strict_1.default.deepEqual(connectCall.args, ['-c', 'port=SWD', 'freq=4000']);
    const downloadCall = runner.calls.find((c) => c.op === 'download');
    strict_1.default.deepEqual(downloadCall.args, [
        '-c', 'port=SWD', 'freq=4000',
        '-d', ELF_PATH,
        '-v',
    ]);
    const resetCall = runner.calls.find((c) => c.op === 'reset');
    strict_1.default.deepEqual(resetCall.args, ['-c', 'port=SWD', 'freq=4000', '-rst', 'hw']);
    // 确认窗口内容完整性
    strict_1.default.equal(confirmCalls.length, 1);
    const info = confirmCalls[0];
    strict_1.default.equal(info.workspacePath, 'C:\\proj');
    strict_1.default.equal(info.mcuModel, 'STM32G431');
    strict_1.default.equal(info.probeStatus, '已检测到 1 个 ST-LINK');
    strict_1.default.ok(info.targetStatus.includes('已连接'));
    strict_1.default.equal(info.filePath, ELF_PATH);
    strict_1.default.equal(info.format, 'ELF');
    strict_1.default.equal(info.binAddress, undefined);
    strict_1.default.equal(info.stale, false);
});
(0, node_test_1.test)('成功路径：BIN 使用确认的地址；软件复位配置生效', async () => {
    const binArtifact = {
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
    const cli = new stm32CubeProgrammer_1.Stm32CubeProgrammerCli('cli.exe', runner);
    const precheck = (0, artifacts_1.checkFlashPreconditions)({
        lastBuild: GOOD_BUILD,
        artifacts: [binArtifact],
        mcu: KNOWN_MCU,
        binAddress: '0x08000000',
    });
    const outcome = await (0, programmer_1.performFlash)({
        cli,
        workspaceRoot: 'C:\\proj',
        mcu: KNOWN_MCU,
        precheck,
        settings: { iface: 'SWD', speedKhz: 4000, resetAfterFlash: 'software' },
        confirm: async () => true,
        log: (m) => new logger_1.Logger(new logger_1.MemoryLogSink()).info(m),
    });
    strict_1.default.equal(outcome.status, 'success');
    const downloadCall = runner.calls.find((c) => c.op === 'download');
    strict_1.default.deepEqual(downloadCall.args, [
        '-c', 'port=SWD', 'freq=4000',
        '-d', BIN_PATH,
        '0x08000000',
        '-v',
    ], 'BIN 必须紧跟烧录地址');
    const resetCall = runner.calls.find((c) => c.op === 'reset');
    strict_1.default.deepEqual(resetCall.args, ['-c', 'port=SWD', 'freq=4000', '-rst', 'sw']);
});
(0, node_test_1.test)('下载与校验解析器：直接针对 CLI 真实输出片段', async () => {
    const { parseDownloadResult, parseProbeList, parseConnectResult } = await Promise.resolve().then(() => __importStar(require('../src/flash/verification')));
    const dl = parseDownloadResult(DOWNLOAD_OK, 0, true);
    strict_1.default.equal(dl.downloaded, true);
    strict_1.default.equal(dl.verify, 'passed');
    const dl2 = parseDownloadResult('File download complete\n', 0, true);
    strict_1.default.equal(dl2.verify, 'unconfirmed', '退出码 0 不等于校验成功');
    const probes = parseProbeList(PROBES_OK);
    strict_1.default.equal(probes.count, 1);
    strict_1.default.equal(probes.probes[0].serial, '0668FF383331675067121245');
    const none = parseProbeList('No connected ST-LINK probe detected\n');
    strict_1.default.equal(none.count, 0);
    const conn = parseConnectResult(CONNECT_OK, 0);
    strict_1.default.equal(conn.connected, true);
    strict_1.default.equal(conn.deviceName, 'STM32G4 Category 2 Device');
    strict_1.default.equal(conn.deviceId, '0x468');
    const fail = parseConnectResult('Error: No cortex-m sw device found', 1);
    strict_1.default.equal(fail.connected, false);
});
//# sourceMappingURL=flashFlow.test.js.map