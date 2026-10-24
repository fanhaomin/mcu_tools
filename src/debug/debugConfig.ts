/**
 * 调试启动配置生成（纯函数，不依赖 vscode）。
 *
 * 调试层按「后端」组织，与 flash 层的烧录后端抽象同构：
 * - CortexDebugBackend（本文件）：ARM Cortex-M（STM32/GD32/CH32 非 V 系列）。
 *   复用 cortex-debug 扩展（marus25.cortex-debug），servertype=stlink 时
 *   由它驱动 ST-LINK_gdbserver + arm-none-eabi-gdb，launch 请求经 gdb load
 *   把 ELF 写入芯片并停在 main，与 CubeProgrammer 烧录互不冲突。
 * - 未来 RISC-V（CH32V 系列）/ESP32：新增对应后端（如 cdt-gdb-vscode 的
 *   gdbtarget 通用 GDB 适配器 + 厂商 OpenOCD），实现同一签名并按芯片家族分发，
 *   命令层与门禁逻辑复用。
 */

/** cortex-debug 扩展 ID（运行时检测是否已安装并引导安装） */
export const CORTEX_DEBUG_EXTENSION_ID = 'marus25.cortex-debug';

export interface DebugLaunchSpec {
  /** 工作区根目录（作为调试会话 cwd） */
  root: string;
  /** ELF 固件路径（调试必须 ELF；HEX/BIN 无调试信息，断点无法命中源码行） */
  elfPath: string;
  /** 芯片型号，如 STM32F103C8；证据不足时传基础型号或 STM32 */
  device: string;
  /** 调试接口 */
  interface: 'SWD' | 'JTAG';
  /** arm-none-eabi-gdb 完整路径 */
  gdbPath: string;
  /** ST-LINK_gdbserver 完整路径 */
  gdbServerPath: string;
  /**
   * STM32CubeProgrammer 的 bin 目录（可选但强烈建议）。
   * gdbserver 的 -cp 参数用它加载 Flash 烧写库；不钉死时 cortex-debug 会自己搜
   * STM32CubeIDE 安装，抓到与 gdbserver 版本不配套的库 → "Error finishing flash
   * operation (from target-download)"。
   */
  cubeProgrammerPath?: string;
  /** 可选 SVD 文件路径（调试时显示外设寄存器视图） */
  svdFile?: string;
  /**
   * launch：下载固件并停在 main（固件由调试会话经 gdb load 写入，不走烧录确认窗口）；
   * attach：只连接正在运行的目标，不写任何内容。
   */
  request: 'launch' | 'attach';
}

/** 生成 cortex-debug 的 launch/attach 配置（字段与 cortex-debug 1.x launch.json 一致） */
export function buildCortexDebugLaunch(spec: DebugLaunchSpec): Record<string, unknown> {
  const config: Record<string, unknown> = {
    type: 'cortex-debug',
    name:
      spec.request === 'launch'
        ? 'Auto CMake Flash: 调试 (ST-LINK)'
        : 'Auto CMake Flash: 附加调试 (ST-LINK)',
    request: spec.request,
    servertype: 'stlink',
    cwd: spec.root,
    executable: spec.elfPath,
    device: spec.device,
    interface: spec.interface.toLowerCase(),
    gdbPath: spec.gdbPath,
    serverpath: spec.gdbServerPath,
  };
  if (spec.svdFile) {
    config.svdFile = spec.svdFile;
  }
  if (spec.cubeProgrammerPath) {
    config.stm32cubeprogrammer = spec.cubeProgrammerPath;
  }
  if (spec.request === 'launch') {
    config.runToEntryPoint = 'main';
  }
  return config;
}

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

// ---------------- probe-rs 引擎 ----------------

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
    name: launch ? 'Auto CMake Flash: 调试 (probe-rs)' : 'Auto CMake Flash: 附加调试 (probe-rs)',
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
