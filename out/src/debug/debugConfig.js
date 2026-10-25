"use strict";
/**
 * 调试启动配置生成（纯函数，不依赖 vscode）。
 *
 * 调试引擎仅支持 probe-rs（运行中旁路直读，零停机）：
 * - 复用 probe-rs-debugger 扩展（probe-rs.probe-rs-debugger）直连 DAP；
 *   烧录走 CubeProgrammer 链路，调试会话 attach 接管，互不冲突。
 * - 未来 RISC-V（CH32V 系列）/ESP32：新增对应后端（如 cdt-gdb-vscode 的
 *   gdbtarget 通用 GDB 适配器 + 厂商 OpenOCD），实现同一签名并按芯片家族分发，
 *   命令层与门禁逻辑复用。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROBE_RS_EXTENSION_ID = void 0;
exports.parseBuildTypeFromCMakeCache = parseBuildTypeFromCMakeCache;
exports.isDebuggableBuildType = isDebuggableBuildType;
exports.deriveProbeRsChip = deriveProbeRsChip;
exports.buildProbeRsLaunch = buildProbeRsLaunch;
// ---------------- probe-rs 引擎 ----------------
/**
 * 从 CMakeCache.txt 解析构建类型。
 * 行形如 `CMAKE_BUILD_TYPE:STRING=Debug`；多配置生成器（Visual Studio、
 * Ninja Multi-Config）该值为空，返回空串表示"无法判定"。
 */
function parseBuildTypeFromCMakeCache(cacheText) {
    const m = /^\s*CMAKE_BUILD_TYPE(?::\w+)?\s*=\s*(.*?)\s*$/mi.exec(cacheText);
    return m ? m[1] : undefined;
}
/**
 * 该构建类型是否值得直接调试。
 * 未知/为空（多配置生成器）不阻止；明确为 Release/MinSizeRel 时由调用方提示。
 */
function isDebuggableBuildType(buildType) {
    if (!buildType || !buildType.trim()) {
        return true;
    }
    return /debug|relwithdebinfo/i.test(buildType);
}
/** probe-rs 调试扩展 ID */
exports.PROBE_RS_EXTENSION_ID = 'probe-rs.probe-rs-debugger';
/**
 * 从识别出的型号推导 probe-rs 芯片名（其注册表使用不带封装后缀的名称，
 * 如 STM32F103C8T6 → STM32F103C8）。家族级名称（STM32F103）无法定位到
 * 唯一芯片，返回 undefined，由用户在设置中指定。
 */
function deriveProbeRsChip(model) {
    const m = /^(STM32[A-Z]\d{3}[A-Z][A-Z0-9])/i.exec(model.trim());
    return m ? m[1].toUpperCase() : undefined;
}
/** 生成 probe-rs 的 launch/attach 配置（字段与 probe-rs-debugger 0.32 一致） */
function buildProbeRsLaunch(spec) {
    const launch = spec.request === 'launch';
    const config = {
        type: 'probe-rs-debug',
        name: launch ? 'Embedded Debug: 调试 (probe-rs)' : 'Embedded Debug: 附加调试 (probe-rs)',
        request: spec.request,
        cwd: spec.root,
        chip: spec.chip,
        speed: spec.speedKhz,
        // probe-rs 的枚举变体首字母大写：'Swd' / 'Jtag'（全小写会报 unknown variant）
        wireProtocol: spec.interface === 'JTAG' ? 'Jtag' : 'Swd',
        coreConfigs: [
            {
                coreIndex: 0,
                programBinary: spec.elfPath,
                ...(spec.svdFile ? { svdFile: spec.svdFile } : {}),
            },
        ],
    };
    if (spec.probe) {
        config.probe = spec.probe;
    }
    if (launch) {
        config.flashingConfig = {
            flashingEnabled: true, // 调试会话负责烧写固件（gdb load 同理）
            haltAfterReset: true, // 复位后停机，等价于停在入口
            verifyAfterFlashing: true,
        };
    }
    return config;
}
//# sourceMappingURL=debugConfig.js.map