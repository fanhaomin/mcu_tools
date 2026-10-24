"use strict";
/**
 * probe-rs 引擎测试：芯片名推导 / launch 配置字段（基于扩展 0.32 真实 schema）。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const debugConfig_1 = require("../src/debug/debugConfig");
(0, node_test_1.test)('芯片名推导：去封装后缀，家族名返回 undefined', () => {
    strict_1.default.equal((0, debugConfig_1.deriveProbeRsChip)('STM32F103C8T6'), 'STM32F103C8');
    strict_1.default.equal((0, debugConfig_1.deriveProbeRsChip)('STM32G431RBTx'), 'STM32G431RB');
    strict_1.default.equal((0, debugConfig_1.deriveProbeRsChip)('STM32F103'), undefined, '家族级无法定位唯一芯片');
    strict_1.default.equal((0, debugConfig_1.deriveProbeRsChip)(''), undefined);
});
(0, node_test_1.test)('launch 配置：flash + 复位停机 + SVD 下发到 coreConfigs', () => {
    const c = (0, debugConfig_1.buildProbeRsLaunch)({
        root: 'D:\\work\\proj',
        elfPath: 'D:\\work\\proj\\cmake-build-debug\\cs_test.elf',
        chip: 'STM32F103C8',
        interface: 'SWD',
        speedKhz: 4000,
        svdFile: 'D:\\svd\\STM32F103.svd',
        request: 'launch',
    });
    strict_1.default.equal(c.type, 'probe-rs-debug');
    strict_1.default.equal(c.request, 'launch');
    strict_1.default.equal(c.chip, 'STM32F103C8');
    strict_1.default.equal(c.speed, 4000);
    strict_1.default.equal(c.wireProtocol, 'Swd');
    const cj = (0, debugConfig_1.buildProbeRsLaunch)({
        root: 'D:\\work\\proj',
        elfPath: 'D:\\work\\proj\\cmake-build-debug\\cs_test.elf',
        chip: 'STM32F103C8',
        interface: 'JTAG',
        speedKhz: 4000,
        request: 'launch',
    });
    strict_1.default.equal(cj.wireProtocol, 'Jtag', 'JTAG 应映射为枚举变体 Jtag');
    strict_1.default.equal(!('probe' in c), true, '未指定探针时应省略字段（0.32 不接受 "auto"）');
    const cores = c.coreConfigs;
    strict_1.default.equal(cores.length, 1);
    strict_1.default.equal(cores[0].coreIndex, 0);
    strict_1.default.equal(cores[0].programBinary, 'D:\\work\\proj\\cmake-build-debug\\cs_test.elf');
    strict_1.default.equal(cores[0].svdFile, 'D:\\svd\\STM32F103.svd');
    const flash = c.flashingConfig;
    strict_1.default.equal(flash.flashingEnabled, true, 'launch 应由调试会话烧写固件');
    strict_1.default.equal(flash.haltAfterReset, true, '复位后停机等价于停在入口');
    strict_1.default.equal(flash.verifyAfterFlashing, true);
});
(0, node_test_1.test)('attach 配置：不烧写、不复位', () => {
    const c = (0, debugConfig_1.buildProbeRsLaunch)({
        root: 'D:\\work\\proj',
        elfPath: 'D:\\work\\proj\\cmake-build-debug\\cs_test.elf',
        chip: 'STM32F103C8',
        interface: 'SWD',
        speedKhz: 4000,
        request: 'attach',
    });
    strict_1.default.equal(c.request, 'attach');
    strict_1.default.equal(c.flashingConfig, undefined, 'attach 不应携带烧写配置');
});
(0, node_test_1.test)('probe-rs 扩展 ID 正确', () => {
    strict_1.default.equal(debugConfig_1.PROBE_RS_EXTENSION_ID, 'probe-rs.probe-rs-debugger');
});
//# sourceMappingURL=probeRs.test.js.map