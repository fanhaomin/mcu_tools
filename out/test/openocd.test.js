"use strict";
/**
 * DAP-Link（CMSIS-DAP）OpenOCD 烧录后端测试：target cfg 推导、命令参数、
 * 探测/烧录输出解析（凭据判定与诚实降级）。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const openocd_1 = require("../src/flash/openocd");
(0, node_test_1.test)('openOcdTargetCfg：主流家族映射', () => {
    strict_1.default.equal((0, openocd_1.openOcdTargetCfg)('STM32H723VGTX'), 'target/stm32h7x.cfg');
    strict_1.default.equal((0, openocd_1.openOcdTargetCfg)('STM32F103C8'), 'target/stm32f1x.cfg');
    strict_1.default.equal((0, openocd_1.openOcdTargetCfg)('stm32g431rbt6'), 'target/stm32g4x.cfg');
    strict_1.default.equal((0, openocd_1.openOcdTargetCfg)('STM32U575'), 'target/stm32u5x.cfg');
    strict_1.default.equal((0, openocd_1.openOcdTargetCfg)('GD32F303'), undefined, '非 ST 型号不猜 cfg');
    strict_1.default.equal((0, openocd_1.openOcdTargetCfg)(''), undefined);
});
(0, node_test_1.test)('openOcdDetectArgs / openOcdFlashArgs：参数形态', () => {
    const det = (0, openocd_1.openOcdDetectArgs)('target/stm32h7x.cfg', 4000);
    strict_1.default.ok(det.includes('interface/cmsis-dap.cfg'));
    strict_1.default.ok(det.some((a) => a.includes('adapter speed 4000')));
    strict_1.default.ok(det.some((a) => a.includes('init; targets; shutdown')));
    const elf = (0, openocd_1.openOcdFlashArgs)('build/app.elf', undefined, 'hardware', 'target/stm32h7x.cfg', 4000);
    strict_1.default.ok(elf.some((a) => a.includes('program "build/app.elf" verify reset exit')));
    const bin = (0, openocd_1.openOcdFlashArgs)('app.bin', '0x08000000', 'none', 'target/stm32f1x.cfg', 1000);
    strict_1.default.ok(bin.some((a) => a.includes('program "app.bin" 0x08000000 verify exit')), 'BIN 带地址；none 不复位');
});
(0, node_test_1.test)('parseOpenOcdDetect：探头缺失与在线', () => {
    const missing = (0, openocd_1.parseOpenOcdDetect)({
        exitCode: 1, stdout: '', stderr: 'Error: unable to find CMSIS-DAP device', spawnError: undefined,
    });
    strict_1.default.equal(missing.connected, false);
    strict_1.default.equal(missing.noProbe, true);
    const online = (0, openocd_1.parseOpenOcdDetect)({
        exitCode: 0, stdout: 'TargetName: stm32h7x.cpu\ntarget halted', stderr: '', spawnError: undefined,
    });
    strict_1.default.equal(online.connected, true);
    strict_1.default.equal(online.noProbe, false);
});
(0, node_test_1.test)('parseOpenOcdFlash：成功凭据 / 校验失败 / 未确认', () => {
    const ok = (0, openocd_1.parseOpenOcdFlash)({
        exitCode: 0,
        stdout: '** Programming Finished **\n** Verify Started **\nverified 1234 bytes in 10ms\n** Resetting Target **',
        stderr: '', spawnError: undefined,
    });
    strict_1.default.equal(ok.downloaded, true);
    strict_1.default.equal(ok.verify, 'passed');
    const bad = (0, openocd_1.parseOpenOcdFlash)({
        exitCode: 1, stdout: '', stderr: 'Error: failed to erase flash', spawnError: undefined,
    });
    strict_1.default.equal(bad.downloaded, false);
    strict_1.default.equal(bad.verify, 'failed');
    const unsure = (0, openocd_1.parseOpenOcdFlash)({
        exitCode: 0, stdout: '** Programming Finished **', stderr: '', spawnError: undefined,
    });
    strict_1.default.equal(unsure.downloaded, true);
    strict_1.default.equal(unsure.verify, 'unconfirmed', '无 verified 凭据时如实降级');
});
//# sourceMappingURL=openocd.test.js.map