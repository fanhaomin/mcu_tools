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

// ---------------- probe-rs 引擎 ----------------

/**
 * 从 CMakeCache.txt 解析构建类型。
 * 行形如 `CMAKE_BUILD_TYPE:STRING=Debug`；多配置生成器（Visual Studio、
 * Ninja Multi-Config）该值为空，返回空串表示"无法判定"。
 */
export function parseBuildTypeFromCMakeCache(cacheText: string): string | undefined {
  const m = /^\s*CMAKE_BUILD_TYPE(?::\w+)?\s*=\s*(.*?)\s*$/mi.exec(cacheText);
  return m ? m[1] : undefined;
}

/**
 * 该构建类型是否值得直接调试。
 * 未知/为空（多配置生成器）不阻止；明确为 Release/MinSizeRel 时由调用方提示。
 */
export function isDebuggableBuildType(buildType: string | undefined): boolean {
  if (!buildType || !buildType.trim()) {
    return true;
  }
  return /debug|relwithdebinfo/i.test(buildType);
}

/** probe-rs 调试扩展 ID */
export const PROBE_RS_EXTENSION_ID = 'probe-rs.probe-rs-debugger';

/**
 * 从识别出的型号推导 probe-rs 芯片名（其注册表使用不带封装后缀的名称，
 * 如 STM32F103C8T6 → STM32F103C8）。家族级名称（STM32F103）无法定位到
 * 唯一芯片，返回 undefined，由用户在设置中指定。
 */
export function deriveProbeRsChip(model: string): string | undefined {
  const m = /^(STM32[A-Z]\d{3}[A-Z][A-Z0-9])/i.exec(model.trim());
  return m ? m[1].toUpperCase() : undefined;
}

export interface ProbeRsLaunchSpec {
  root: string;
  elfPath: string;
  /** probe-rs 注册表中的精确芯片名，如 STM32F103C8 */
  chip: string;
  interface: 'SWD' | 'JTAG';
  speedKhz: number;
  /** 可选 SVD 文件（probe-rs 自带外设视图也用它） */
  svdFile?: string;
  /** 可选探针选择器（VID:PID[:Serial]）；缺省 = 使用第一个探针。
   *  注意：probe-rs 0.32 不接受 "auto"——该格式解析会直接报 Serialization error。 */
  probe?: string;
  request: 'launch' | 'attach';
}

/** 生成 probe-rs 的 launch/attach 配置（字段与 probe-rs-debugger 0.32 一致） */
export function buildProbeRsLaunch(spec: ProbeRsLaunchSpec): Record<string, unknown> {
  const launch = spec.request === 'launch';
  const config: Record<string, unknown> = {
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
      haltAfterReset: true,  // 复位后停机，等价于停在入口
      verifyAfterFlashing: true,
    };
  }
  return config;
}
