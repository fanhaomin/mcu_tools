"use strict";
/**
 * DAP-Link（CMSIS-DAP）烧录后端：OpenOCD。
 *
 * 无 ST-LINK 时自动回退到 CMSIS-DAP 探头（probe-rs 调试本身支持 CMSIS-DAP，
 * 只有烧录必须换后端）。命令形态：
 *   openocd -f interface/cmsis-dap.cfg -c "adapter speed <kHz>" -f <target cfg>
 *           -c "init; targets; shutdown"                          # 探测/识别
 *   openocd -f ... -c "program <file>[ <addr>] verify[ reset] exit"  # 烧录+校验
 *
 * 校验判定按输出内容：`** Programming Finished **` / `verified <n> bytes` 为凭据，
 * 无法确认时如实标记 unconfirmed，绝不把退出码 0 当校验成功。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.openOcdTargetCfg = openOcdTargetCfg;
exports.openOcdDetectArgs = openOcdDetectArgs;
exports.openOcdFlashArgs = openOcdFlashArgs;
exports.parseOpenOcdDetect = parseOpenOcdDetect;
exports.parseOpenOcdFlash = parseOpenOcdFlash;
exports.createOpenOcdRunner = createOpenOcdRunner;
const process_1 = require("../util/process");
/** MCU 型号 → OpenOCD target cfg（STM32H723VGTX → stm32h7x） */
function openOcdTargetCfg(model) {
    const m = /^STM32([A-Z][0-9])/i.exec(model.trim().toUpperCase());
    const family = m?.[1]?.toUpperCase();
    if (!family) {
        return undefined;
    }
    const map = {
        C0: 'stm32c0x',
        F0: 'stm32f0x',
        F1: 'stm32f1x',
        F2: 'stm32f2x',
        F3: 'stm32f3x',
        F4: 'stm32f4x',
        F7: 'stm32f7x',
        G0: 'stm32g0x',
        G4: 'stm32g4x',
        H5: 'stm32h5x',
        H7: 'stm32h7x',
        L0: 'stm32l0x',
        L1: 'stm32l1x',
        L4: 'stm32l4x',
        L5: 'stm32l5x',
        U5: 'stm32u5x',
        WB: 'stm32wbx',
        WL: 'stm32wlx',
    };
    const cfg = map[family];
    return cfg ? `target/${cfg}.cfg` : undefined;
}
function baseArgs(cfg, speedKhz) {
    return ['-f', 'interface/cmsis-dap.cfg', '-c', `adapter speed ${speedKhz}`, '-f', cfg];
}
/** 探测/识别参数：init 后列出目标再退出（不碰 Flash） */
function openOcdDetectArgs(cfg, speedKhz) {
    return [...baseArgs(cfg, speedKhz), '-c', 'init; targets; shutdown'];
}
/** 烧录参数：program <file>[ <bin 地址>] verify[ reset] exit */
function openOcdFlashArgs(file, binAddress, resetAfterFlash, cfg, speedKhz) {
    const reset = resetAfterFlash === 'none' ? '' : ' reset';
    const addr = binAddress ? ` ${binAddress}` : '';
    return [
        ...baseArgs(cfg, speedKhz),
        '-c',
        `program "${file}"${addr} verify${reset} exit`,
    ];
}
/** 解析探测输出：USB 打不开 CMSIS-DAP 判探头不在；init 成功（退出码 0）判在线 */
function parseOpenOcdDetect(run) {
    const raw = `${run.stdout}\n${run.stderr}`;
    const noProbe = /unable to find (a )?cmsis-dap|no cmsis-dap|cmsis-dap.*(not found|no such)|no such device|failed to (open|find).*dap/i.test(raw);
    const connected = run.exitCode === 0 && !run.spawnError && !noProbe;
    return {
        connected,
        noProbe,
        raw,
        exitCode: run.exitCode,
        error: run.spawnError,
    };
}
/** 解析烧录输出：Programming Finished = 下载凭据；verified N bytes = 校验凭据 */
function parseOpenOcdFlash(run) {
    const raw = `${run.stdout}\n${run.stderr}`;
    const ok = run.exitCode === 0 && !run.spawnError;
    const downloaded = ok && (/\*\*\s*programming finished\s*\*\*/i.test(raw) || /wrote \d+ bytes/i.test(raw));
    const failed = /verification failed|error:/i.test(raw);
    const verifyPassed = /verified \d+ bytes/i.test(raw);
    const verify = !downloaded
        ? 'failed'
        : failed
            ? 'failed'
            : verifyPassed
                ? 'passed'
                : 'unconfirmed';
    return { downloaded, verify, raw, exitCode: run.exitCode, error: run.spawnError };
}
function createOpenOcdRunner(openOcdPath) {
    return {
        run: (args, timeoutMs) => (0, process_1.execFileSafe)(openOcdPath, args, { timeoutMs }),
    };
}
//# sourceMappingURL=openocd.js.map