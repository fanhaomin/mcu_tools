/**
 * Auto CMake Flash — 共享类型定义。
 *
 * 注意：本文件不得 import 'vscode'，以便核心逻辑可在纯 Node 环境下单元测试。
 */

/** 识别可信度 */
export type Confidence = 'high' | 'medium' | 'low' | 'none';

/** 芯片证据来源 */
export type EvidenceSource =
  | 'ioc'            // STM32CubeMX .ioc 文件
  | 'compileDefine'  // -DSTM32xxxx 宏定义
  | 'cmakeLists'     // CMakeLists.txt 中的芯片型号字符串
  | 'cmakeCache'     // 已有构建目录 CMakeCache.txt
  | 'toolchainFile'  // 工具链文件中的宏/芯片信息
  | 'linkerScript'   // 链接脚本文件名 STM32xxx_FLASH.ld
  | 'startupFile'    // startup_stm32xxxx.s
  | 'halDriver'      // Drivers/STM32xx_HAL_Driver 目录（仅家族级证据）
  | 'userSelection'; // 用户手动确认

export interface ChipEvidence {
  source: EvidenceSource;
  /** 证据来源的简述，例如文件路径或命中的文本 */
  detail: string;
  /** 解析出的精确型号（原始文本），如 STM32G431RBTx */
  model?: string;
  /** 归一化的基础型号，如 STM32G431 */
  base?: string;
  /** 家族，如 STM32G4 */
  family?: string;
  /** 该证据的权重 */
  weight: number;
}

export interface McuInfo {
  /** 展示用型号（最可信证据的原始型号），未知时为空字符串 */
  model: string;
  /** 归一化基础型号，如 STM32G431；未知时为空字符串 */
  base: string;
  /** 家族，如 STM32G4；未知时为空字符串 */
  family: string;
  /** 编译宏形式，如 STM32G431xx */
  macro: string;
  confidence: Confidence;
  evidence: ChipEvidence[];
  /** 用户已手动确认型号 */
  confirmedByUser: boolean;
  /** 识别过程中的警告（如证据冲突） */
  warnings: string[];
}

export function unknownMcu(): McuInfo {
  return {
    model: '',
    base: '',
    family: '',
    macro: '',
    confidence: 'none',
    evidence: [],
    confirmedByUser: false,
    warnings: [],
  };
}

export type FirmwareFormat = 'elf' | 'hex' | 'bin';

export interface FirmwareArtifact {
  path: string;
  format: FirmwareFormat;
  mtimeMs: number;
  sizeBytes: number;
}

/** 一次构建的独立成功/失败记录 */
export interface BuildRecord {
  id: string;
  root: string;
  buildDir: string;
  buildType: string;
  generator?: string;
  success: boolean;
  exitCode: number | null;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** 构建成功后定位到的 ELF 文件 */
  elfPath?: string;
  /** 该 ELF 在构建成功时刻的 mtime（Ninja 无改动时不会重写文件，靠此字段认可产物） */
  elfMtimeMs?: number;
  cancelled?: boolean;
}

/** 持久化在构建目录中的插件状态标记（同时作为“插件创建的目录”标记） */
export interface PersistedBuildState {
  version: 1;
  createdByAutoCmakeFlash: boolean;
  lastBuild?: BuildRecord;
}

export type ToolName =
  | 'cmake'
  | 'ninja'
  | 'armGcc'
  | 'armGpp'
  | 'objcopy'
  | 'size'
  | 'programmerCli';

export const ALL_TOOL_NAMES: ToolName[] = [
  'cmake',
  'ninja',
  'armGcc',
  'armGpp',
  'objcopy',
  'size',
  'programmerCli',
];

export const TOOL_LABELS: Record<ToolName, string> = {
  cmake: 'CMake',
  ninja: 'Ninja',
  armGcc: 'ARM GCC (arm-none-eabi-gcc)',
  armGpp: 'ARM G++ (arm-none-eabi-g++)',
  objcopy: 'arm-none-eabi-objcopy',
  size: 'arm-none-eabi-size',
  programmerCli: 'STM32CubeProgrammer CLI',
};

export interface ToolInfo {
  name: ToolName;
  label: string;
  found: boolean;
  path?: string;
  version?: string;
  /** 是否已通过版本命令确认工具可运行 */
  versionConfirmed: boolean;
  /** 未找到或版本确认失败的原因 */
  error?: string;
  /** 搜索过的候选路径（用于问题定位） */
  searched: string[];
}

export interface ToolchainInfo {
  tools: Record<ToolName, ToolInfo>;
  complete: boolean;
  missing: ToolName[];
  detectedAt: string;
}

export interface StLinkProbe {
  serial?: string;
  firmware?: string;
}

/**
 * 注意区分状态层级：
 * - cliMissing：连 STM32CubeProgrammer CLI 都没有，无法判断硬件
 * - probeDetected：检测到 ST-LINK 适配器（不等于芯片已连接）
 * - noProbe：明确未检测到适配器
 * - unknown：命令执行了但无法解析结果
 */
export type StLinkStatus = 'notChecked' | 'cliMissing' | 'probeDetected' | 'noProbe' | 'unknown';

export interface StLinkInfo {
  status: StLinkStatus;
  probeCount: number;
  probes: StLinkProbe[];
  cliPath?: string;
  rawOutput?: string;
  error?: string;
  checkedAt?: string;
}

/** 通过 CLI 连接目标后解析出的目标信息 */
export interface TargetConnection {
  connected: boolean;
  deviceName?: string;
  deviceId?: string;
  cpu?: string;
  rawOutput?: string;
  error?: string;
}

export type VerifyStatus = 'passed' | 'failed' | 'unconfirmed' | 'skipped';

export type FlashStatus =
  | 'success'             // 下载成功（校验结果见 verify 字段）
  | 'download-failed'     // 下载失败
  | 'verify-failed'       // 下载完成但校验失败
  | 'verify-unconfirmed'  // 下载命令执行完成，校验状态未确认
  | 'connect-failed'      // 目标芯片无法连接
  | 'no-probe'            // 未检测到 ST-LINK
  | 'blocked'             // 前置条件不满足（编译失败/型号不确定等）
  | 'cancelled'           // 用户取消
  | 'reset-failed';       // 下载校验完成后复位失败（附注信息）

export interface FlashOutcome {
  status: FlashStatus;
  downloaded: boolean;
  verify: VerifyStatus;
  messages: string[];
  blocker?: string;
  exitCode?: number | null;
}

export interface ParsedDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
}

export type BusyKind = 'none' | 'configure' | 'build' | 'flash';

/** 插件在内存中维护的会话状态（供侧边栏/状态栏渲染） */
export interface WorkspaceState {
  root?: string;
  project?: ProjectInfo;
  toolchain?: ToolchainInfo;
  stlink?: StLinkInfo;
  lastBuild?: BuildRecord;
  lastFlash?: FlashOutcome;
  busy: BusyKind;
}

export interface ProjectInfo {
  root: string;
  name: string;
  hasCMakeLists: boolean;
  cmakeListsPath?: string;
  hasIoc: boolean;
  iocPath?: string;
  /** .ioc + CMakeLists + Core 目录同时存在，视为 CubeMX 生成的 CMake 工程 */
  isCubeMxCMake: boolean;
  hasCoreDirs: boolean;
  hasHalDriver: boolean;
  hasCmsis: boolean;
  startupFiles: string[];
  linkerScripts: string[];
  /** 工程内发现的工具链相关 .cmake 文件 */
  toolchainFiles: string[];
  /** 工程是否已自带工具链配置（此时插件不得重复注入 CMAKE_TOOLCHAIN_FILE） */
  hasToolchainConfig: boolean;
  /** 根目录下发现的其他构建目录（非插件目录） */
  foreignBuildDirs: string[];
  /** 各构建目录 CMakeCache 中发现的生成器 */
  cmakeGenerators: string[];
  /** 根目录与构建目录中发现的固件产物 */
  artifacts: FirmwareArtifact[];
  mcu: McuInfo;
  /** 是否识别为 STM32 工程 */
  recognized: boolean;
  warnings: string[];
}
