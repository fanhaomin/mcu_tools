/**
 * 工具链检测：cmake / ninja / arm-none-eabi-gcc / g++ / objcopy / size /
 * STM32CubeProgrammer CLI。
 *
 * 检测策略：
 * 1. 用户在设置中手动指定的路径优先；
 * 2. 其次搜索系统 PATH（Windows 上通过 where.exe）；
 * 3. 最后搜索 STM32CubeCLT / STM32CubeProgrammer / GNU Arm Embedded 的默认安装目录。
 *
 * 找到文件后必须运行版本命令确认可用（不能只看文件是否存在）。
 * 通过注入 DetectionEnv 可以在单元测试中模拟 PATH 与版本命令。
 */

import * as path from 'path';
import {
  ALL_TOOL_NAMES,
  TOOL_LABELS,
  ToolInfo,
  ToolName,
  ToolchainInfo,
} from '../types';
import { execFileSafe, RunOptions } from '../util/process';
import { exists } from '../util/path';

export interface VersionProbeResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface DetectionEnv {
  /** 在系统 PATH 中查找可执行文件，返回绝对路径列表 */
  pathLookup(name: string): Promise<string[]>;
  exists(p: string): Promise<boolean>;
  /** 列出目录下的子目录名（用于发现 STM32CubeCLT 安装根），目录不存在返回空 */
  listDirs(dir: string): Promise<string[]>;
  /** 运行版本命令并按正则提取版本号 */
  runVersion(
    file: string,
    args: string[],
    versionRegex: RegExp,
    timeoutMs: number,
  ): Promise<VersionProbeResult>;
}

interface ToolSpec {
  name: ToolName;
  exe: string;
  versionArgs: string[];
  versionRegex: RegExp;
  /** 版本命令失败时的后备参数（例如 STM32_Programmer_CLI 的 --version 不被支持时用 -l 头部） */
  fallbackVersionArgs?: string[];
  /** 相对 STM32CubeCLT 根目录的子路径 */
  cubeCltSubDirs: string[];
  /** 与 CubeCLT 无关的固定候选目录 */
  fixedDirs: (platform: NodeJS.Platform) => string[];
  /**
   * 可选组件（调试工具等）：参与检测但不算入 complete/missing，
   * 缺失只影响对应功能而不阻塞编译/烧录。
   */
  optional?: boolean;
}

const isWin = () => process.platform === 'win32';

function exeName(base: string): string {
  return isWin() ? `${base}.exe` : base;
}

const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'cmake',
    exe: exeName('cmake'),
    versionArgs: ['--version'],
    versionRegex: /cmake version (\d+\.\d+(?:\.\d+)?)/i,
    cubeCltSubDirs: [path.join('CMake', 'bin')],
    fixedDirs: (platform) =>
      platform === 'win32'
        ? ['C:\\Program Files\\CMake\\bin']
        : ['/usr/local/bin', '/usr/bin'],
  },
  {
    name: 'ninja',
    exe: exeName('ninja'),
    versionArgs: ['--version'],
    versionRegex: /^(\d+\.\d+(?:\.\d+)?)/m,
    // 兼容两种布局：CubeCLT 新版为 Ninja\bin，旧版为 Ninja
    cubeCltSubDirs: [path.join('Ninja', 'bin'), 'Ninja'],
    fixedDirs: () => [],
  },
  {
    name: 'armGcc',
    exe: exeName('arm-none-eabi-gcc'),
    versionArgs: ['--version'],
    versionRegex: /(\d+\.\d+\.\d+)/,
    cubeCltSubDirs: [path.join('GNU-tools-for-STM32', 'bin')],
    fixedDirs: (platform) =>
      platform === 'win32'
        ? ['C:\\Program Files (x86)\\GNU Arm Embedded Toolchain\\bin', 'C:\\Program Files\\GNU Arm Embedded Toolchain\\bin']
        : ['/usr/bin'],
  },
  {
    name: 'armGpp',
    exe: exeName('arm-none-eabi-g++'),
    versionArgs: ['--version'],
    versionRegex: /(\d+\.\d+\.\d+)/,
    cubeCltSubDirs: [path.join('GNU-tools-for-STM32', 'bin')],
    fixedDirs: (platform) =>
      platform === 'win32'
        ? ['C:\\Program Files (x86)\\GNU Arm Embedded Toolchain\\bin', 'C:\\Program Files\\GNU Arm Embedded Toolchain\\bin']
        : ['/usr/bin'],
  },
  {
    name: 'objcopy',
    exe: exeName('arm-none-eabi-objcopy'),
    versionArgs: ['--version'],
    versionRegex: /(\d+\.\d+\.\d+)/,
    cubeCltSubDirs: [path.join('GNU-tools-for-STM32', 'bin')],
    fixedDirs: (platform) =>
      platform === 'win32'
        ? ['C:\\Program Files (x86)\\GNU Arm Embedded Toolchain\\bin']
        : ['/usr/bin'],
  },
  {
    name: 'size',
    exe: exeName('arm-none-eabi-size'),
    versionArgs: ['--version'],
    versionRegex: /(\d+\.\d+\.\d+)/,
    cubeCltSubDirs: [path.join('GNU-tools-for-STM32', 'bin')],
    fixedDirs: (platform) =>
      platform === 'win32'
        ? ['C:\\Program Files (x86)\\GNU Arm Embedded Toolchain\\bin']
        : ['/usr/bin'],
  },
  {
    name: 'programmerCli',
    exe: exeName('STM32_Programmer_CLI'),
    versionArgs: ['--version'],
    versionRegex: /(?:STM32CubeProgrammer|CubeProgrammer)\s+v?(\d+\.\d+\.\d+)/i,
    fallbackVersionArgs: ['-l'],
    cubeCltSubDirs: [path.join('STM32CubeProgrammer', 'bin')],
    fixedDirs: (platform) =>
      platform === 'win32'
        ? [
            'C:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeProgrammer\\bin',
            'C:\\Program Files (x86)\\STMicroelectronics\\STM32Cube\\STM32CubeProgrammer\\bin',
          ]
        : ['/usr/local/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin'],
  },
  {
    name: 'armGdb',
    exe: exeName('arm-none-eabi-gdb'),
    versionArgs: ['--version'],
    versionRegex: /GNU gdb \(.*?\)\s+v?(\d+\.\d+(?:\.\d+)?)/i,
    cubeCltSubDirs: [path.join('GNU-tools-for-STM32', 'bin')],
    fixedDirs: (platform) =>
      platform === 'win32'
        ? ['C:\\Program Files (x86)\\GNU Arm Embedded Toolchain\\bin', 'C:\\Program Files\\GNU Arm Embedded Toolchain\\bin']
        : ['/usr/bin'],
    optional: true,
  },
  {
    name: 'stlinkGdbServer',
    exe: exeName('ST-LINK_gdbserver'),
    versionArgs: ['--version'],
    versionRegex: /version[^\d\r\n]*v?(\d+\.\d+(?:\.\d+)?)/i,
    cubeCltSubDirs: [path.join('STM32CubeProgrammer', 'bin')],
    fixedDirs: (platform) =>
      platform === 'win32'
        ? [
            'C:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeProgrammer\\bin',
            'C:\\Program Files (x86)\\STMicroelectronics\\STM32Cube\\STM32CubeProgrammer\\bin',
          ]
        : ['/usr/local/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin'],
    optional: true,
  },
];

export function toolSpec(name: ToolName): ToolSpec {
  const spec = TOOL_SPECS.find((s) => s.name === name);
  if (!spec) {
    throw new Error(`未知工具: ${name}`);
  }
  return spec;
}

/** 默认检测环境：真实文件系统 + 真实进程调用 */
export function defaultDetectionEnv(): DetectionEnv {
  return {
    async pathLookup(name: string): Promise<string[]> {
      const cmd = isWin() ? 'where.exe' : 'which';
      const r = await execFileSafe(cmd, [name], { timeoutMs: 10_000 });
      if (r.exitCode !== 0 && !r.stdout.trim()) {
        return [];
      }
      return r.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    },
    exists,
    async listDirs(dir: string): Promise<string[]> {
      try {
        const fs = await import('fs');
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return [];
      }
    },
    async runVersion(file, args, regex, timeoutMs): Promise<VersionProbeResult> {
      const opts: RunOptions = { timeoutMs };
      const r = await execFileSafe(file, args, opts);
      const combined = `${r.stdout}\n${r.stderr}`;
      const m = regex.exec(combined);
      if (m) {
        return { ok: true, version: m[1] };
      }
      if (r.spawnError) {
        return { ok: false, error: `无法启动: ${r.spawnError}` };
      }
      return {
        ok: false,
        error: `版本命令执行失败 (退出码 ${r.exitCode}${r.timedOut ? ', 超时' : ''})`,
      };
    },
  };
}

/** 列出 STM32CubeCLT 可能的安装根目录（如 C:\ST\STM32CubeCLT_1.15.0） */
async function discoverCubeCltRoots(env: DetectionEnv, extraRoots: string[]): Promise<string[]> {
  const roots: string[] = [];
  const parents = [
    'C:\\ST',
    'C:\\Program Files\\STMicroelectronics\\STM32Cube',
    'C:\\Program Files (x86)\\STMicroelectronics\\STM32Cube',
    ...extraRoots,
  ];
  for (const parent of parents) {
    if (!(await env.exists(parent))) {
      continue;
    }
    try {
      const children = await env.listDirs(parent);
      for (const name of children) {
        if (/^STM32CubeCLT/i.test(name)) {
          roots.push(path.join(parent, name));
        }
      }
      // 父目录本身也可能是安装根（用户自定义目录）
      if (/STM32CubeCLT/i.test(path.basename(parent))) {
        roots.push(parent);
      }
    } catch {
      /* 目录不可读 */
    }
  }
  return [...new Set(roots)];
}

export interface ToolchainDetectionOptions {
  /**
   * 用户设置中的覆盖路径：
   * - cmake/ninja/programmerCli：完整可执行文件路径或命令名
   * - armGcc：gcc 完整路径，或工具链 bin 目录（目录形式会同时解析出 g++/objcopy/size/gdb）
   */
  overrides?: Partial<Record<ToolName, string>>;
  /** 额外的 STM32CubeCLT 搜索根目录 */
  extraCltRoots?: string[];
  /** 版本命令超时（毫秒），默认 15 秒 */
  timeoutMs?: number;
}

/**
 * 将 armToolchainPath 设置解析为具体候选：
 * - 指向 .exe 文件 → 直接使用
 * - 指向目录 → 目录下的 arm-none-eabi-*.exe
 * - 空字符串/undefined → 无覆盖
 */
export function resolveArmToolchainSetting(
  setting: string | undefined,
): Partial<Record<ToolName, string>> {
  const out: Partial<Record<ToolName, string>> = {};
  if (!setting || !setting.trim()) {
    return out;
  }
  const p = setting.trim();
  if (/\.(exe|elf)$/i.test(p) || !path.extname(p)) {
    if (/\.(exe|elf)$/i.test(p)) {
      // 完整可执行文件路径：推导同目录其他工具
      out.armGcc = p;
      const dir = path.dirname(p);
      out.armGpp = path.join(dir, exeName('arm-none-eabi-g++'));
      out.objcopy = path.join(dir, exeName('arm-none-eabi-objcopy'));
      out.size = path.join(dir, exeName('arm-none-eabi-size'));
      out.armGdb = path.join(dir, exeName('arm-none-eabi-gdb'));
    } else {
      // 目录形式
      out.armGcc = path.join(p, exeName('arm-none-eabi-gcc'));
      out.armGpp = path.join(p, exeName('arm-none-eabi-g++'));
      out.objcopy = path.join(p, exeName('arm-none-eabi-objcopy'));
      out.size = path.join(p, exeName('arm-none-eabi-size'));
      out.armGdb = path.join(p, exeName('arm-none-eabi-gdb'));
    }
  }
  return out;
}

export async function detectToolchain(
  env: DetectionEnv,
  opts: ToolchainDetectionOptions = {},
): Promise<ToolchainInfo> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const cltRoots = await discoverCubeCltRoots(env, opts.extraCltRoots ?? []);
  const overrideBySetting = resolveArmToolchainSetting(opts.overrides?.armGcc);

  const tools = {} as Record<ToolName, ToolInfo>;
  for (const spec of TOOL_SPECS) {
    const overrideRaw = opts.overrides?.[spec.name] ?? overrideBySetting[spec.name];
    const info = await detectOneTool(env, spec, overrideRaw, cltRoots, timeoutMs);
    tools[spec.name] = info;
  }

  const missing = ALL_TOOL_NAMES.filter((n) => !tools[n].found);
  return {
    tools,
    complete: missing.length === 0,
    missing,
    detectedAt: new Date().toISOString(),
  };
}

async function detectOneTool(
  env: DetectionEnv,
  spec: ToolSpec,
  override: string | undefined,
  cltRoots: string[],
  timeoutMs: number,
): Promise<ToolInfo> {
  const info: ToolInfo = {
    name: spec.name,
    label: TOOL_LABELS[spec.name],
    found: false,
    versionConfirmed: false,
    searched: [],
  };

  // 组装候选（去重、保持优先级）：覆盖 → PATH → CubeCLT → 固定目录
  const candidates: string[] = [];
  const push = (p: string | undefined) => {
    if (p && p.trim() && !candidates.includes(p.trim())) {
      candidates.push(p.trim());
    }
  };
  push(override);
  for (const p of await env.pathLookup(spec.exe)) {
    push(p);
  }
  for (const root of cltRoots) {
    for (const sub of spec.cubeCltSubDirs) {
      push(path.join(root, sub, spec.exe));
    }
  }
  for (const dir of spec.fixedDirs(process.platform)) {
    push(path.join(dir, spec.exe));
  }
  info.searched = candidates;

  if (candidates.length === 0) {
    info.error = `未找到 ${spec.exe}。已搜索: 用户设置、系统 PATH、STM32CubeCLT 默认安装目录。`;
    return info;
  }

  let firstExisting: string | undefined;
  let firstExistingError = '';
  for (const cand of candidates) {
    if (!(await env.exists(cand))) {
      continue;
    }
    const probe = await env.runVersion(cand, spec.versionArgs, spec.versionRegex, timeoutMs);
    if (probe.ok) {
      info.found = true;
      info.path = cand;
      info.version = probe.version;
      info.versionConfirmed = true;
      return info;
    }
    // 版本命令失败：尝试后备参数（STM32CubeProgrammer --version 不支持时）
    if (spec.fallbackVersionArgs) {
      const fb = await env.runVersion(cand, spec.fallbackVersionArgs, spec.versionRegex, timeoutMs);
      if (fb.ok) {
        info.found = true;
        info.path = cand;
        info.version = fb.version;
        info.versionConfirmed = true;
        info.error = `“${spec.versionArgs.join(' ')}” 不被支持，已通过后备命令确认版本`;
        return info;
      }
    }
    if (!firstExisting) {
      firstExisting = cand;
      firstExistingError = probe.error ?? '版本命令执行失败';
    }
  }

  if (firstExisting) {
    // 文件存在但无法通过版本命令确认
    info.found = true;
    info.path = firstExisting;
    info.error = `文件存在但版本命令确认失败: ${firstExistingError}`;
    return info;
  }

  info.error = `未找到可用的 ${spec.exe}。已检查 ${candidates.length} 个候选路径（含用户设置、PATH、STM32CubeCLT 目录），均无效。`;
  return info;
}

/** 生成面向用户的缺失组件与解决方法说明 */
export function missingToolAdvice(missing: ToolName[]): string[] {
  return missing.map((name) => {
    switch (name) {
      case 'cmake':
        return '缺少 CMake: 请安装 STM32CubeCLT（含 CMake），或在设置 autoCmakeFlash.cmakePath 中手动指定。';
      case 'ninja':
        return '缺少 Ninja: 请安装 STM32CubeCLT（含 Ninja），或将设置 autoCmakeFlash.generator 改为已安装的生成器（如 "MinGW Makefiles"）。';
      case 'armGcc':
      case 'armGpp':
        return '缺少 ARM GNU 工具链: 请安装 STM32CubeCLT（含 GNU-tools-for-STM32），或在设置 autoCmakeFlash.armToolchainPath 中指定 bin 目录。';
      case 'objcopy':
      case 'size':
        return `缺少 ${TOOL_LABELS[name]}: 随 ARM GNU 工具链一起安装（bin 目录）。`;
      case 'programmerCli':
        return '缺少 STM32CubeProgrammer CLI: 请安装 STM32CubeCLT 或单独安装 STM32CubeProgrammer，或在设置 autoCmakeFlash.programmerCliPath 中指定 STM32_Programmer_CLI.exe 路径。';
      case 'armGdb':
        return '缺少 ARM GDB: 请安装 STM32CubeCLT（GNU-tools-for-STM32 自带 arm-none-eabi-gdb），或在设置 autoCmakeFlash.gdbPath 中指定。';
      case 'stlinkGdbServer':
        return '缺少 ST-LINK GDB Server: 随 STM32CubeProgrammer 一起安装（bin 目录），或在设置 autoCmakeFlash.gdbServerPath 中指定。';
      default:
        return `缺少组件: ${name}`;
    }
  });
}
