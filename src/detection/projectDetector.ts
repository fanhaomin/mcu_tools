/**
 * 工程自动识别：扫描工作区根目录，识别 CMake 工程 / CubeMX 工程的
 * 各类标志物，收集芯片证据与已有构建产物。
 *
 * 所有路径均基于传入的 root 参数，模块本身不依赖 vscode。
 */

import * as path from 'path';
import {
  ChipEvidence,
  FirmwareArtifact,
  ProjectInfo,
  unknownMcu,
} from '../types';
import { statSafe, walk, readTextFile } from '../util/path';
import {
  combineEvidence,
  extractChipTokens,
  familyFromHalDir,
  parseChipToken,
} from './stm32Detector';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

const STARTUP_RE = /^startup_.*\.s$/i;
const LINKER_RE = /\.(ld|lds)$/i;
// 兼容 CubeMX（STM32G431RBTX_FLASH.ld）与 CLion/社区模板（STM32F103C8Tx.ld）命名
const LINKER_STM32_RE = /^STM32[A-Z]\d{2,3}[A-Z0-9]*(?:_(?:FLASH|RAM))?\.ld$/i;
const FIRMWARE_EXT_RE = /\.(elf|hex|bin)$/i;
const HAL_DIR_RE = /^STM32[A-Z0-9]+xx_HAL_Driver$/i;
const CMSIS_RE = /^CMSIS$/i;
const TEMPLATE_DIR_RE = /^(Templates|MDK-ARM|EWARM|SW4STM32|Makefile|CMake)$/i;
const BUILD_DIR_RE = /^(build.*|cmake-build.*|out|output)$/i;

interface ScanContext {
  root: string;
  evidence: ChipEvidence[];
  startupFiles: string[];
  linkerScripts: string[];
  halDriverDir?: string;
  hasCoreInc: boolean;
  hasCoreSrc: boolean;
  hasCmsis: boolean;
  buildDirs: string[];
  warnings: string[];
}

function addEvidence(
  ctx: ScanContext,
  source: ChipEvidence['source'],
  weight: number,
  detail: string,
  parsed: { raw: string; base: string; family: string } | undefined,
): void {
  ctx.evidence.push({
    source,
    detail,
    model: parsed?.raw,
    base: parsed?.base,
    family: parsed?.family,
    weight,
  });
}

async function scanIoc(ctx: ScanContext, iocPath: string): Promise<void> {
  const content = await readTextFile(iocPath);
  if (!content) {
    ctx.warnings.push(`无法读取 .ioc 文件: ${iocPath}`);
    return;
  }
  let hit = false;
  for (const line of content.split(/\r?\n/)) {
    const nameM = /^Mcu\.Name\s*=\s*(.+)$/i.exec(line.trim());
    if (nameM) {
      const parsed = extractChipTokens(nameM[1])[0];
      addEvidence(ctx, 'ioc', 5, `.ioc Mcu.Name=${nameM[1].trim()}`, parsed);
      hit = !!parsed || hit;
    }
    const famM = /^Mcu\.Family\s*=\s*(.+)$/i.exec(line.trim());
    if (famM && !hit) {
      ctx.evidence.push({
        source: 'ioc',
        detail: `.ioc Mcu.Family=${famM[1].trim()}`,
        family: famM[1].trim(),
        weight: 5,
      });
    }
  }
  if (!hit) {
    ctx.warnings.push('.ioc 文件中未解析到 Mcu.Name，芯片型号需要人工确认');
  }
}

async function scanTextFileForChips(
  ctx: ScanContext,
  filePath: string,
  source: ChipEvidence['source'],
  weight: number,
): Promise<void> {
  const content = await readTextFile(filePath, MAX_FILE_BYTES);
  if (!content) {
    return;
  }
  const chips = extractChipTokens(content);
  const seenBase = new Set<string>();
  for (const chip of chips) {
    if (seenBase.has(chip.base)) {
      continue;
    }
    seenBase.add(chip.base);
    // 宏定义形式（STM32G431xx）是显式编译定义，权重更高；
    // 普通型号字符串提及按调用方给定权重（上限 2）
    const isMacro = /^STM32[A-Z]\d{2,3}XX$/i.test(chip.raw);
    if (isMacro) {
      const macroSource: ChipEvidence['source'] =
        source === 'cmakeLists' ? 'compileDefine' : source;
      const macroWeight = macroSource === 'compileDefine' ? Math.max(weight, 4) : weight;
      addEvidence(ctx, macroSource, macroWeight, `${path.basename(filePath)}: ${chip.raw}`, chip);
    } else {
      addEvidence(ctx, source, Math.min(weight, 2), `${path.basename(filePath)}: ${chip.raw}`, chip);
    }
  }
}

/** 收集根目录/构建目录中的固件产物 */
async function collectArtifacts(dirs: string[], depth: number): Promise<FirmwareArtifact[]> {
  const found: FirmwareArtifact[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    await walk(
      dir,
      async (p) => {
        if (!FIRMWARE_EXT_RE.test(p)) {
          return;
        }
        const key = p.toLowerCase();
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        const st = await statSafe(p);
        if (!st || !st.isFile()) {
          return;
        }
        const ext = path.extname(p).toLowerCase().slice(1);
        found.push({
          path: p,
          format: ext as FirmwareArtifact['format'],
          mtimeMs: st.mtimeMs,
          sizeBytes: st.size,
        });
      },
      { depth, skipDirs: [/^CMakeFiles$/i] },
    );
  }
  return found;
}

/**
 * 扫描工程目录并生成 ProjectInfo。
 */
export async function detectProject(root: string): Promise<ProjectInfo> {
  const ctx: ScanContext = {
    root,
    evidence: [],
    startupFiles: [],
    linkerScripts: [],
    hasCoreInc: false,
    hasCoreSrc: false,
    hasCmsis: false,
    buildDirs: [],
    warnings: [],
  };

  let cmakeListsPath: string | undefined;
  let iocPath: string | undefined;
  const toolchainFiles: string[] = [];
  const foreignBuildDirs: string[] = [];
  const cmakeGenerators: string[] = [];
  const artifactDirs: string[] = [];
  let buildAutoDir: string | undefined;

  // 1) 根目录直接条目
  let rootEntries: import('fs').Dirent[];
  try {
    const fs = await import('fs');
    rootEntries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (e) {
    const info = emptyProject(root, path.basename(root));
    info.warnings.push(`无法读取工作区目录: ${e instanceof Error ? e.message : String(e)}`);
    return info;
  }

  for (const ent of rootEntries) {
    const full = path.join(root, ent.name);
    if (ent.isFile()) {
      if (/^CMakeLists\.txt$/i.test(ent.name)) {
        cmakeListsPath = full;
      } else if (/\.ioc$/i.test(ent.name)) {
        iocPath = iocPath ?? full;
      } else if (/\.cmake$/i.test(ent.name)) {
        toolchainFiles.push(full);
      } else if (STARTUP_RE.test(ent.name)) {
        ctx.startupFiles.push(full);
      } else if (LINKER_RE.test(ent.name)) {
        ctx.linkerScripts.push(full);
      }
    } else if (ent.isDirectory()) {
      if (/^Core$/i.test(ent.name)) {
        const inc = await statSafe(path.join(full, 'Inc'));
        const src = await statSafe(path.join(full, 'Src'));
        ctx.hasCoreInc = !!inc?.isDirectory();
        ctx.hasCoreSrc = !!src?.isDirectory();
      } else if (CMSIS_RE.test(ent.name) || /CMSIS/i.test(ent.name)) {
        ctx.hasCmsis = true;
      } else if (HAL_DIR_RE.test(ent.name)) {
        ctx.evidence.push({
          source: 'halDriver',
          detail: `HAL 驱动目录 ${ent.name}（仅能确定家族）`,
          family: familyFromHalDir(ent.name),
          weight: 1,
        });
        if (!ctx.halDriverDir) {
          ctx.halDriverDir = full;
        }
      } else if (BUILD_DIR_RE.test(ent.name)) {
        if (/^build-auto$/i.test(ent.name)) {
          buildAutoDir = full;
        } else {
          foreignBuildDirs.push(full);
        }
      } else if (/^(cmake|cmake-modules)$/i.test(ent.name)) {
        // CubeMX CMake 工程的 cmake/gcc-arm-none-eabi.cmake
        try {
          const fs = await import('fs');
          const sub = await fs.promises.readdir(full, { withFileTypes: true });
          for (const s of sub) {
            if (s.isFile() && s.name.endsWith('.cmake')) {
              toolchainFiles.push(path.join(full, s.name));
            }
          }
        } catch {
          /* 目录不可读，忽略 */
        }
      }
    }
  }

  // Drivers 目录需要单独查看（Drivers/CMSIS、Drivers/STM32xx_HAL_Driver）
  const driversDir = path.join(root, 'Drivers');
  try {
    const fs = await import('fs');
    const drivers = await fs.promises.readdir(driversDir, { withFileTypes: true });
    for (const d of drivers) {
      if (!d.isDirectory()) {
        continue;
      }
      if (HAL_DIR_RE.test(d.name)) {
        ctx.evidence.push({
          source: 'halDriver',
          detail: `Drivers/${d.name}（仅能确定家族）`,
          family: familyFromHalDir(d.name),
          weight: 1,
        });
        if (!ctx.halDriverDir) {
          ctx.halDriverDir = path.join(driversDir, d.name);
        }
      } else if (CMSIS_RE.test(d.name)) {
        ctx.hasCmsis = true;
      }
    }
  } catch {
    /* 无 Drivers 目录 */
  }

  // 2) 递归扫描启动文件与链接脚本（跳过 Templates/IDE 工程目录与构建目录，
  //    避免 CMSIS Device 模板目录中大量其他型号的启动文件造成证据冲突）
  await walk(
    root,
    async (p, name, _depth, isDir) => {
      if (isDir) {
        return;
      }
      if (STARTUP_RE.test(name)) {
        ctx.startupFiles.push(p);
      } else if (LINKER_RE.test(name)) {
        ctx.linkerScripts.push(p);
      }
    },
    { depth: 4, skipDirs: [BUILD_DIR_RE, TEMPLATE_DIR_RE, /^\.auto-cmake-flash$/i] },
  );

  // 去重
  ctx.startupFiles = [...new Set(ctx.startupFiles)];
  ctx.linkerScripts = [...new Set(ctx.linkerScripts)];

  // 3) 芯片证据：启动文件、链接脚本
  for (const sf of ctx.startupFiles.slice(0, 20)) {
    const m = /^startup_([a-z0-9_]+)\.s$/i.exec(path.basename(sf));
    if (!m) {
      continue;
    }
    const token = m[1].toUpperCase();
    const chip = token.startsWith('STM32') ? parseChipToken(token) : undefined;
    if (chip) {
      addEvidence(ctx, 'startupFile', 3, `启动文件 ${path.basename(sf)}`, chip);
    }
  }
  for (const ls of ctx.linkerScripts.slice(0, 20)) {
    const base = path.basename(ls);
    if (LINKER_STM32_RE.test(base)) {
      const chip = extractChipTokens(base.replace(/_(FLASH|RAM)\.ld$/i, ''))[0];
      const inDrivers = /[/\\]Drivers[/\\]/i.test(ls);
      addEvidence(ctx, 'linkerScript', inDrivers ? 2 : 3, `链接脚本 ${base}`, chip);
    }
  }

  // 4) 文本内容证据：CMakeLists.txt、.ioc、工具链文件、CMakeCache
  if (cmakeListsPath) {
    await scanTextFileForChips(ctx, cmakeListsPath, 'cmakeLists', 2);
  }
  if (iocPath) {
    await scanIoc(ctx, iocPath);
  }
  for (const tf of toolchainFiles.slice(0, 10)) {
    await scanTextFileForChips(ctx, tf, 'toolchainFile', 4);
  }

  // 5) 已有构建目录的 CMakeCache（生成器、构建类型、芯片宏）
  for (const bd of foreignBuildDirs) {
    const cache = await readTextFile(path.join(bd, 'CMakeCache.txt'), 1024 * 1024);
    if (!cache) {
      continue;
    }
    const genM = /^CMAKE_GENERATOR(?::\w+)?\s*=\s*(.+)$/m.exec(cache);
    if (genM) {
      cmakeGenerators.push(genM[1].trim());
    }
    await scanTextFileForChips(ctx, path.join(bd, 'CMakeCache.txt'), 'cmakeCache', 4);
  }

  // 6) 固件产物：根目录（仅根层文件）+ 已有构建目录（如 CLion 的 cmake-build-debug，
  //    支持直接烧录 CLion 编译出的固件）+ 插件构建目录
  artifactDirs.push(root, ...foreignBuildDirs);
  if (buildAutoDir) {
    artifactDirs.push(buildAutoDir);
  }
  const artifacts = await collectArtifacts([...new Set(artifactDirs)], 3);

  // 7) 工具链配置判定：必须存在"实际设置编译器/工具链"的证据，
  //    单纯提及 toolchain/arm-none-eabi 字样不算（否则会误判并跳过工具链注入）
  let hasToolchainConfig = false;
  if (cmakeListsPath) {
    const content = await readTextFile(cmakeListsPath);
    if (
      content &&
      (/set\s*\(\s*CMAKE_TOOLCHAIN_FILE/i.test(content) ||
        /set\s*\(\s*CMAKE_(?:C|CXX)_COMPILER/i.test(content) ||
        /-DCMAKE_TOOLCHAIN_FILE=/i.test(content))
    ) {
      hasToolchainConfig = true;
    }
  }
  if (!hasToolchainConfig) {
    for (const tf of toolchainFiles.slice(0, 10)) {
      const content = await readTextFile(tf, 512 * 1024);
      if (content && /CMAKE_(?:C|CXX)_COMPILER|CMAKE_TOOLCHAIN_FILE|CMAKE_TRY_COMPILE/i.test(content)) {
        hasToolchainConfig = true;
        break;
      }
    }
  }

  const hasCMakeLists = !!cmakeListsPath;
  const hasIoc = !!iocPath;
  const isCubeMxCMake = hasIoc && hasCMakeLists && ctx.hasCoreInc && ctx.hasCoreSrc;

  if (hasIoc && !hasCMakeLists) {
    ctx.warnings.push(
      '工程包含 STM32CubeMX .ioc 文件但没有 CMakeLists.txt。请使用 STM32CubeMX 的 Project Manager → Toolchain/IDE 选择 CMake 重新生成工程。',
    );
  }
  if (!hasCMakeLists) {
    ctx.warnings.push('未找到 CMakeLists.txt，无法执行 CMake 配置与编译。');
  }
  if (foreignBuildDirs.length > 0) {
    ctx.warnings.push(
      `检测到已有构建目录: ${foreignBuildDirs.map((d) => path.basename(d)).join('、')}。插件只会使用专用目录 build-auto，不会改动它们。`,
    );
  }

  const mcu = combineEvidence(ctx.evidence);
  const recognized = hasIoc || !!ctx.halDriverDir || !!mcu.family || ctx.evidence.length > 0;

  const info: ProjectInfo = {
    root,
    name: path.basename(root),
    hasCMakeLists,
    cmakeListsPath,
    hasIoc,
    iocPath,
    isCubeMxCMake,
    hasCoreDirs: ctx.hasCoreInc && ctx.hasCoreSrc,
    hasHalDriver: !!ctx.halDriverDir,
    hasCmsis: ctx.hasCmsis,
    startupFiles: ctx.startupFiles,
    linkerScripts: ctx.linkerScripts,
    toolchainFiles,
    hasToolchainConfig,
    foreignBuildDirs,
    cmakeGenerators: [...new Set(cmakeGenerators)],
    artifacts,
    mcu,
    recognized,
    warnings: ctx.warnings,
  };
  return info;
}

function emptyProject(root: string, name: string): ProjectInfo {
  return {
    root,
    name,
    hasCMakeLists: false,
    hasIoc: false,
    isCubeMxCMake: false,
    hasCoreDirs: false,
    hasHalDriver: false,
    hasCmsis: false,
    startupFiles: [],
    linkerScripts: [],
    toolchainFiles: [],
    hasToolchainConfig: false,
    foreignBuildDirs: [],
    cmakeGenerators: [],
    artifacts: [],
    mcu: unknownMcu(),
    recognized: false,
    warnings: ['目录为空或不可读'],
  };
}
