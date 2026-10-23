/**
 * Auto CMake Flash — 扩展入口。
 *
 * 职责：装配各模块、注册命令、维护会话状态与并发控制。
 * 核心逻辑全部在 src/detection、src/cmake、src/flash 中（不依赖 vscode），
 * 本文件只做 VS Code API 适配。
 */

import * as vscode from 'vscode';
import * as path from 'path';

import {
  BusyKind,
  FirmwareArtifact,
  ProjectInfo,
  WorkspaceState,
} from './types';
import { Logger } from './util/logger';
import { existsSync, readTextFile, splitArgs } from './util/path';
import { detectProject } from './detection/projectDetector';
import {
  defaultDetectionEnv,
  detectToolchain,
  missingToolAdvice,
} from './detection/toolchainDetector';
import { detectStLink } from './detection/stlinkDetector';
import { combineEvidence, familyCpuFlags, parseChipToken } from './detection/stm32Detector';
import {
  checkFlashPreconditions,
  findArtifacts,
  isValidHexAddress,
  readPersistedState,
  selectFirmware,
} from './cmake/artifacts';
import {
  clearCMakeConfigureResidue,
  cmakeListsDeclaresToolchain,
  configureProject,
  generateToolchainFileContent,
} from './cmake/configure';
import { buildProject, isConfigured } from './cmake/build';
import { Stm32CubeProgrammerCli } from './flash/stm32CubeProgrammer';
import { FlashConfirmInfo, performFlash } from './flash/programmer';
import { AutoCmakeFlashSettings, loadSettings, onSettingsChange } from './config/settings';
import { SidebarProvider, flashStatusText, verifyText } from './ui/sidebar';
import { StatusBar } from './ui/statusBar';
import {
  chooseMcuDialog,
  confirmCleanDialog,
  confirmFlashDialog,
  confirmReuseBuildDirDialog,
  inputBinAddressDialog,
} from './ui/confirmation';

export function activate(context: vscode.ExtensionContext): void {
  try {
    init(context);
  } catch (e) {
    // 激活异常兜底：不能因插件错误拖垮 VS Code
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    try {
      const ch = vscode.window.createOutputChannel('Auto CMake Flash');
      ch.appendLine(`[FATAL] 扩展激活失败:\n${msg}`);
      ch.show();
    } catch {
      /* ignore */
    }
    void vscode.window.showErrorMessage('Auto CMake Flash 扩展激活失败，详情见输出面板 "Auto CMake Flash"。');
  }
}

function init(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Auto CMake Flash');
  context.subscriptions.push(channel);

  let settings: AutoCmakeFlashSettings = loadSettings();
  const logger = new Logger(channel, () => settings.verboseLogging);

  const state: WorkspaceState = { busy: 'none' };
  const sidebar = new SidebarProvider(() => state);
  const treeView = vscode.window.createTreeView('autoCmakeFlash.project', {
    treeDataProvider: sidebar,
  });
  context.subscriptions.push(treeView);

  const status = new StatusBar();
  context.subscriptions.push(status);

  const diagnostics = vscode.languages.createDiagnosticCollection('Auto CMake Flash');
  context.subscriptions.push(diagnostics);

  let cancelSource: vscode.CancellationTokenSource | undefined;

  const refresh = (): void => {
    sidebar.refresh();
    status.update(state);
  };

  const log = (msg: string): void => logger.info(msg);

  context.subscriptions.push(
    onSettingsChange(() => {
      settings = loadSettings();
      logger.info('设置已更新。');
      refresh();
    }),
  );

  // ---------------- 基础工具 ----------------

  /** 选择工作区根目录（处理未打开工作区 / 多工作区） */
  async function pickRoot(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      void vscode.window.showInformationMessage(
        'Auto CMake Flash: 请先打开包含 STM32 工程的文件夹（文件 → 打开文件夹）。',
      );
      return undefined;
    }
    if (state.root && folders.some((f) => f.uri.fsPath === state.root)) {
      return state.root;
    }
    if (folders.length === 1) {
      state.root = folders[0].uri.fsPath;
      return state.root;
    }
    // 多工作区：优先自动选择含 CMakeLists.txt 或 .ioc 的目录
    const withMarker = folders.filter(
      (f) =>
        existsSync(path.join(f.uri.fsPath, 'CMakeLists.txt')) ||
        existsSync(path.join(f.uri.fsPath, '.ioc')) ||
        findIocFast(f.uri.fsPath),
    );
    const candidates = withMarker.length > 0 ? withMarker : folders;
    if (candidates.length === 1) {
      state.root = candidates[0].uri.fsPath;
      return state.root;
    }
    const pick = await vscode.window.showQuickPick(
      candidates.map((f) => ({
        label: f.name,
        description: f.uri.fsPath,
        fsPath: f.uri.fsPath,
      })),
      { title: 'Auto CMake Flash — 选择要操作的工程目录', ignoreFocusOut: true },
    );
    state.root = pick?.fsPath;
    return state.root;
  }

  function findIocFast(root: string): boolean {
    try {
      const fs = require('fs') as typeof import('fs');
      return fs
        .readdirSync(root)
        .some((n) => n.toLowerCase().endsWith('.ioc'));
    } catch {
      return false;
    }
  }

  function buildDirOf(root: string): string {
    const bd = settings.buildDir;
    // 支持 ${buildType} 占位符；值为 "build" 时自动按构建类型分子目录
    // （build/Debug、build/Release），与 CLion CMakePresets 的 binaryDir 约定一致。
    let resolved = bd.split('${buildType}').join(settings.buildType);
    if (!path.isAbsolute(resolved) && /(^|[\\/])build([\\/])?$/i.test(resolved)) {
      resolved = `${resolved.replace(/[\\/]$/, '')}/${settings.buildType}`;
    }
    return path.isAbsolute(resolved) ? resolved : path.join(root, resolved);
  }

  /** 并发保护：同一时间只允许一个配置/编译/烧录任务 */
  async function runExclusive<T>(
    kind: BusyKind,
    title: string,
    cancellable: boolean,
    fn: (token: vscode.CancellationToken) => Promise<T>,
  ): Promise<T | undefined> {
    if (state.busy !== 'none') {
      const label =
        state.busy === 'build' ? '编译' : state.busy === 'flash' ? '烧录' : '配置';
      void vscode.window.showWarningMessage(
        `Auto CMake Flash: 已有${label}任务正在进行，请等待其完成后再试。`,
      );
      return undefined;
    }
    state.busy = kind;
    cancelSource = new vscode.CancellationTokenSource();
    refresh();
    try {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Auto CMake Flash: ${title}`,
          cancellable,
        },
        async (_progress, token) => fn(token),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`任务 "${title}" 异常: ${msg}`);
      void vscode.window.showErrorMessage(`Auto CMake Flash: ${title}失败 — ${msg}`);
      return undefined;
    } finally {
      state.busy = 'none';
      cancelSource?.dispose();
      cancelSource = undefined;
      refresh();
    }
  }

  async function ensureScanned(root: string): Promise<void> {
    if (state.project && state.project.root === root) {
      return;
    }
    await doScan(root, true);
  }

  async function ensureToolchain(root: string): Promise<boolean> {
    if (state.toolchain) {
      return true;
    }
    await doDetectEnvironment(root, true);
    return !!state.toolchain;
  }

  // ---------------- 扫描与环境检测 ----------------

  async function doScan(root: string, silent: boolean): Promise<void> {
    logger.section(`扫描工程 ${root}`);
    const project = await detectProject(root);
    state.root = root;
    state.project = project;

    // 读取插件构建目录的持久化状态（上次构建记录）
    const buildDir = buildDirOf(root);
    const persisted = await readPersistedState(buildDir);
    if (persisted?.lastBuild) {
      state.lastBuild = persisted.lastBuild;
    }

    logger.info(`工程识别: ${project.name}`);
    logger.info(`CMakeLists.txt: ${project.hasCMakeLists ? project.cmakeListsPath : '未找到'}`);
    logger.info(`.ioc: ${project.hasIoc ? project.iocPath : '未找到'}`);
    logger.info(
      `芯片结论: ${project.mcu.model || '待确认'} 家族=${project.mcu.family || '未知'} ` +
        `可信度=${project.mcu.confidence}${project.mcu.confirmedByUser ? '（用户确认）' : ''}`,
    );
    for (const ev of project.mcu.evidence) {
      logger.debug(`  证据[${ev.source}] ${ev.detail} -> base=${ev.base ?? '-'} 权重=${ev.weight}`);
    }
    for (const w of project.warnings) {
      logger.warn(w);
    }
    for (const a of project.artifacts) {
      logger.debug(`  产物: ${a.path} (${a.format}, ${a.sizeBytes} bytes)`);
    }

    if (!silent) {
      const parts = [`工程: ${project.name}`, `MCU: ${project.mcu.model || '芯片型号待确认'}`];
      if (project.mcu.warnings.length > 0) {
        parts.push(project.mcu.warnings[0]);
      }
      void vscode.window.showInformationMessage(
        `Auto CMake Flash 扫描完成 — ${parts.join('；')}`,
        '手动选择型号',
      ).then((pick) => {
        if (pick === '手动选择型号') {
          void vscode.commands.executeCommand('autoCmakeFlash.chooseMcu');
        }
      });
    }
    refresh();
  }

  async function doDetectEnvironment(root: string, silent: boolean): Promise<void> {
    logger.section('检测开发环境');
    const env = defaultDetectionEnv();
    const toolchain = await detectToolchain(env, {
      overrides: {
        cmake: settings.cmakePath || undefined,
        ninja: settings.ninjaPath || undefined,
        armGcc: settings.armToolchainPath || undefined,
        programmerCli: settings.programmerCliPath || undefined,
      },
      timeoutMs: 15_000,
    });
    state.toolchain = toolchain;

    for (const name of Object.keys(toolchain.tools) as (keyof typeof toolchain.tools)[]) {
      const t = toolchain.tools[name];
      if (t.found) {
        logger.info(`${t.label}: ${t.path}${t.version ? ` (版本 ${t.version})` : ' (版本未知)'}${t.error ? ` [${t.error}]` : ''}`);
      } else {
        logger.warn(`${t.label}: 未找到 — ${t.error ?? ''}`);
      }
      if (t.searched.length > 0 && !t.found) {
        logger.debug(`  搜索过的候选: ${t.searched.join(' ; ')}`);
      }
    }

    // ST-LINK 检测（CLI 找到才有意义）
    const cliPath = toolchain.tools.programmerCli.found
      ? toolchain.tools.programmerCli.path
      : undefined;
    state.stlink = await detectStLink(cliPath, undefined, 30_000);
    const st = state.stlink;
    logger.info(
      st.status === 'probeDetected'
        ? `ST-LINK: 检测到 ${st.probeCount} 个探头（注意: 这不代表目标芯片已可连接）`
        : st.status === 'noProbe'
          ? 'ST-LINK: 未检测到适配器'
          : st.status === 'cliMissing'
            ? 'ST-LINK: STM32CubeProgrammer CLI 未找到，无法检测'
            : `ST-LINK: 检测结果未知 — ${st.error ?? ''}`,
    );

    if (!silent) {
      const found = Object.values(toolchain.tools).filter((t) => t.found).length;
      const total = Object.keys(toolchain.tools).length;
      if (toolchain.complete && state.stlink?.status === 'probeDetected') {
        void vscode.window.showInformationMessage(
          `Auto CMake Flash: 环境检测完成（${found}/${total} 组件就绪，ST-LINK 已检测到）。`,
        );
      } else if (toolchain.complete) {
        void vscode.window.showInformationMessage(
          `Auto CMake Flash: 工具链完整（${found}/${total}），但未检测到 ST-LINK 适配器（烧录前会再次检测）。`,
        );
      } else {
        void vscode.window.showWarningMessage(
          `Auto CMake Flash: 缺少 ${toolchain.missing.length} 个工具链组件，详见侧边栏与日志。`,
          '查看解决方法',
        ).then((pick) => {
          if (pick === '查看解决方法') {
            void vscode.commands.executeCommand('autoCmakeFlash.showMissingTools');
          }
        });
      }
    }
    refresh();
  }

  // ---------------- CMake 配置 ----------------

  async function doConfigure(
    root: string,
    token: vscode.CancellationToken,
    /** 编译失败自愈路径：跳过决策逻辑，直接使用指定工具链文件 */
    override?: { toolchainFile: string },
  ): Promise<boolean> {
    await ensureScanned(root);
    const project = state.project!;
    const tc = state.toolchain;

    if (!project.hasCMakeLists || !project.cmakeListsPath) {
      if (project.hasIoc) {
        void vscode.window
          .showWarningMessage(
            'Auto CMake Flash: 工程包含 STM32CubeMX .ioc 文件但没有 CMakeLists.txt。\n' +
              '请使用 STM32CubeMX → Project Manager → Toolchain/IDE 选择 "CMake" 重新生成工程（插件第一版不自行生成 CubeMX 工程）。',
            '重新扫描',
          )
          .then((pick) => {
            if (pick === '重新扫描') {
              void vscode.commands.executeCommand('autoCmakeFlash.scanProject');
            }
          });
      } else {
        void vscode.window.showErrorMessage(
          'Auto CMake Flash: 未找到 CMakeLists.txt，无法进行 CMake 配置。',
        );
      }
      return false;
    }
    if (!tc) {
      void vscode.window.showErrorMessage('Auto CMake Flash: 开发环境未就绪（CMake 未检测到）。请先执行“检测开发环境”。');
      return false;
    }
    if (!tc.tools.cmake.found || !tc.tools.cmake.path) {
      void vscode.window.showErrorMessage(
        'Auto CMake Flash: 未找到 CMake。请安装 STM32CubeCLT 或在设置中指定 cmake 路径。',
      );
      return false;
    }

    // 生成器可用性检查（Ninja 不可用时提供切换选项）
    let generator = settings.generator;
    if (/^ninja$/i.test(generator) && !tc.tools.ninja.found) {
      const pick = await vscode.window.showWarningMessage(
        'Auto CMake Flash: Ninja 未检测到。',
        { modal: true, detail: '可以安装 STM32CubeCLT（自带 Ninja），或改用其他已安装的生成器。' },
        { title: '改用 MinGW Makefiles', value: 'MinGW Makefiles' },
        { title: '改用 NMake Makefiles', value: 'NMake Makefiles' },
        { title: '仍使用 Ninja', value: 'Ninja' },
      );
      if (!pick) {
        log('用户取消了生成器选择，配置中止。');
        return false;
      }
      generator = pick.value;
      log(`生成器切换为: ${generator}`);
    }

    // 工具链文件决策：不与工程已有配置冲突。
    // cpuFlags 按识别到的芯片家族推导（-mcpu/-mthumb），补齐未提供 CPU 选项的工程。
    const cpuFlags = familyCpuFlags(project.mcu.family);
    let userToolchainFile: string | undefined;
    let generatedToolchainFile: string | undefined;
    if (override) {
      userToolchainFile = override.toolchainFile;
      log(`使用自愈工具链文件: ${userToolchainFile}`);
    } else if (settings.cmakeToolchainFile.trim()) {
      userToolchainFile = settings.cmakeToolchainFile.trim();
    } else {
      const declares = await cmakeListsDeclaresToolchain(project.cmakeListsPath);
      if (project.hasToolchainConfig || declares) {
        // 工程自带工具链时直接使用它（与 CLion preset 的 toolchainFile 等价），
        // 保证插件与 CLion 在同一构建目录中缓存一致，不互相触发重配置。
        const original = pickOriginalToolchainFile(project);
        if (original) {
          userToolchainFile = original;
          log(`使用工程自带工具链文件: ${original}`);
        } else {
          log('工程已自带工具链配置（CMakeLists 或 .cmake 文件），不注入 CMAKE_TOOLCHAIN_FILE。');
        }
      } else if (tc.tools.armGcc.found && tc.tools.armGcc.path && tc.tools.armGpp.found && tc.tools.armGpp.path) {
        const dir = path.join(root, '.auto-cmake-flash');
        const fs = require('fs') as typeof import('fs');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'auto-cmake-flash.toolchain.cmake');
        fs.writeFileSync(
          file,
          generateToolchainFileContent(tc.tools.armGcc.path, tc.tools.armGpp.path, { cpuFlags }),
          'utf8',
        );
        generatedToolchainFile = file;
        log(`工程无工具链配置，已生成插件工具链文件: ${file}${cpuFlags ? `（含 ${cpuFlags}）` : ''}`);
      } else {
        logger.warn(
          '工程无工具链配置且未检测到 ARM GCC。将尝试直接配置；若 CMakeLists 未设置编译器，配置会失败。',
        );
        void vscode.window.showWarningMessage(
          'Auto CMake Flash: 未检测到 ARM GCC 工具链，且工程没有自带工具链配置。CMake 配置可能失败，建议先安装 STM32CubeCLT。',
        );
      }
    }

    logger.section('CMake 配置');
    const buildDir = buildDirOf(root);
    const cmakeExe = tc.tools.cmake.path;
    const ninjaOk = tc.tools.ninja.found;
    const runConfigure = (toolchainFile?: string, generated?: string, hasExisting = project.hasToolchainConfig) =>
      configureProject({
        root,
        buildDir,
        generator,
        buildType: settings.buildType,
        cmakePath: cmakeExe,
        ninjaAvailable: ninjaOk,
        hasExistingToolchain: hasExisting,
        toolchainFile,
        generatedToolchainFile: generated,
        extraArgs: splitArgs(settings.cmakeExtraArgs ?? ''),
        confirmReuseForeignBuildDir: confirmReuseBuildDirDialog,
        log,
        token,
        timeoutMs: 300_000,
      });

    let outcome = await runConfigure(userToolchainFile, generatedToolchainFile);

    // 工程未提供可用的编译器配置导致 configure 失败时：
    // 经用户明确确认后，注入插件生成的工具链文件并清理缓存残留重试一次。
    // 覆盖两类真实场景（CLion/CubeMX 工程互通实测）：
    // a) No CMAKE_C/CXX_COMPILER could be found —— 工具链不在 PATH；
    // b) "is not able to compile a simple test program" —— CMake 对裸机交叉
    //    编译器做链接级 ABI 检查失败（工程未设置 CMAKE_TRY_COMPILE_TARGET_TYPE）。
    if (!outcome.ok && outcome.result && !userToolchainFile && !generatedToolchainFile) {
      const combined = `${outcome.result.stdout}\n${outcome.result.stderr}`;
      const compilerMissing = /No CMAKE_(?:C|CXX)_COMPILER could be found/i.test(combined);
      const compilerBroken =
        /is not able to compile a simple test program/i.test(combined) ||
        /Detecting C(?:ompiler|XX compiler) ABI info - failed/i.test(combined) ||
        /compiler[^:\n]*- broken/i.test(combined);
      const needsTryCompileFix =
        compilerBroken &&
        project.cmakeListsPath !== undefined &&
        !/CMAKE_TRY_COMPILE_TARGET_TYPE/i.test(
          (await readTextFile(project.cmakeListsPath, 512 * 1024)) ?? '',
        );
      const gccPath = tc.tools.armGcc.found ? tc.tools.armGcc.path : undefined;
      const gppPath = tc.tools.armGpp.found ? tc.tools.armGpp.path : undefined;
      if ((compilerMissing || needsTryCompileFix) && gccPath && gppPath) {
        const pick = await vscode.window.showWarningMessage(
          'Auto CMake Flash: CMake 配置失败（交叉编译器检查未通过）。',
          {
            modal: true,
            detail:
              (compilerMissing
                ? 'CMake 未能找到编译器，且工程没有可用的工具链配置。\n'
                : 'CMake 对裸机交叉编译器的默认链接测试失败（工程未设置 CMAKE_TRY_COMPILE_TARGET_TYPE）。\n') +
              '是否使用插件生成的工具链文件重试一次？\n' +
              '该文件指向已检测到的 ARM GCC，并设置 CMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY（跳过链接级测试，裸机工程标准做法）。\n' +
              '将写入 .auto-cmake-flash/ 目录并清理 build-auto 的 CMake 缓存残留；你的 CMakeLists.txt 不会被修改。',
          },
          { title: '使用插件工具链重试', value: 'retry' },
        );
        if (pick?.value === 'retry') {
          const fs = require('fs') as typeof import('fs');
          const dir = path.join(root, '.auto-cmake-flash');
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, 'auto-cmake-flash.toolchain.cmake');
          fs.writeFileSync(
            file,
            generateToolchainFileContent(gccPath, gppPath, {
              cpuFlags,
              includeOriginalToolchain: pickOriginalToolchainFile(project),
            }),
            'utf8',
          );
          log(`使用插件工具链文件重试: ${file}${cpuFlags ? `（含 ${cpuFlags}）` : ''}`);
          const cleaned = await clearCMakeConfigureResidue(buildDir);
          if (cleaned) {
            logger.warn(`清理缓存残留时出现问题: ${cleaned}`);
          }
          outcome = await runConfigure(file, undefined, false);
        }
      }
    }

    if (outcome.result) {
      logger.procResult(outcome.result);
    }
    if (outcome.reason) {
      logger.warn(outcome.reason);
    }
    if (!outcome.ok) {
      void vscode.window.showErrorMessage(
        `Auto CMake Flash: CMake 配置失败 — ${outcome.reason ?? `退出码 ${outcome.result?.exitCode}，详见日志`}`,
        '查看日志',
      ).then((pick) => {
        if (pick === '查看日志') {
          channel.show(true);
        }
      });
      return false;
    }
    void vscode.window.showInformationMessage(
      `Auto CMake Flash: CMake 配置成功（${generator} / ${settings.buildType}）。可以开始编译。`,
    );
    return true;
  }

  /** 选择工程内最可能承载工具链设置的 .cmake 文件（生成自愈工具链时先 include 它，保留原有设置） */
  function pickOriginalToolchainFile(project: ProjectInfo): string | undefined {
    return project.toolchainFiles.find((f) =>
      /gcc-arm-none-eabi|toolchain|stm32cubemx/i.test(path.basename(f)),
    );
  }

  // ---------------- 编译 ----------------

  async function doBuild(
    root: string,
    token: vscode.CancellationToken,
  ): Promise<boolean> {
    await ensureScanned(root);
    const project = state.project!;
    if (!project.hasCMakeLists) {
      void vscode.window.showErrorMessage(
        'Auto CMake Flash: 未找到 CMakeLists.txt，无法编译。若是 CubeMX 工程，请先用 STM32CubeMX 生成 CMake 工程。',
      );
      return false;
    }
    const okTc = await ensureToolchain(root);
    const tc = state.toolchain;
    if (!tc || !tc.tools.cmake.found || !tc.tools.cmake.path) {
      void vscode.window.showErrorMessage('Auto CMake Flash: CMake 不可用，无法编译。');
      return false;
    }

    const buildDir = buildDirOf(root);
    if (!(await isConfigured(buildDir))) {
      log('构建目录尚未配置，先执行 CMake 配置...');
      const configured = await doConfigure(root, token);
      if (!configured) {
        return false;
      }
    }

    logger.section('编译');
    diagnostics.clear();
    const outcome = await buildProject({
      root,
      buildDir,
      cmakePath: tc.tools.cmake.path,
      buildType: settings.buildType,
      token,
      timeoutMs: settings.buildTimeoutSec * 1000,
      log,
      onOutput: (chunk) => channel.append(chunk),
    });

    // 完整编译日志已在 buildProject 内落盘；输出通道归档结构化记录
    logger.procResult(outcome.result, '编译输出');

    // 诊断写入问题面板
    for (const d of outcome.diagnostics) {
      diagnostics.set(vscode.Uri.file(d.file), [
        new vscode.Diagnostic(
          new vscode.Range(Math.max(0, d.line - 1), Math.max(0, d.column - 1), Math.max(0, d.line - 1), 200),
          d.message,
          d.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning,
        ),
      ]);
    }

    state.lastBuild = outcome.record;
    refresh();

    if (!outcome.ok) {
      void vscode.window
        .showWarningMessage(
          `Auto CMake Flash: 编译失败（${outcome.record.cancelled ? '已取消' : `退出码 ${outcome.record.exitCode}`}）。已阻止烧录，防止误烧旧固件。`,
          '查看问题',
          '查看日志',
        )
        .then((pick) => {
          if (pick === '查看问题') {
            void vscode.commands.executeCommand('workbench.action.problems.focus');
          } else if (pick === '查看日志') {
            channel.show(true);
          }
        });
      return false;
    }
    return true;
  }

  /** 每个工程只提示一次 CPU 选项自愈，避免循环弹窗 */
  const cpuFlagRemediationDone = new Set<string>();

  /**
   * 编译 + 缺失 CPU 选项自愈。
   * 编译失败且日志命中 "selected processor does not support ..."（工程未提供
   * -mcpu/-mthumb 的典型症状）时，经用户确认后重新配置（工具链文件保留工程
   * 原有设置并自动补齐 CPU 选项）再编译一次。
   */
  async function buildWithCpuRemediation(
    root: string,
    token: vscode.CancellationToken,
  ): Promise<boolean> {
    let ok = await doBuild(root, token);
    if (ok) {
      return true;
    }
    const buildDir = buildDirOf(root);
    const logText = await readTextFile(
      path.join(buildDir, 'auto-cmake-flash-last-build.log'),
      1024 * 1024,
    );
    if (!logText || !/selected processor does not support/i.test(logText)) {
      return false;
    }
    const project = state.project!;
    const tc = state.toolchain;
    const gccPath = tc?.tools.armGcc.found ? tc.tools.armGcc.path : undefined;
    const gppPath = tc?.tools.armGpp.found ? tc.tools.armGpp.path : undefined;
    const cpuFlags = familyCpuFlags(project.mcu.family);
    if (!gccPath || !gppPath || !cpuFlags) {
      return false;
    }
    const key = `${root}:${project.mcu.base || project.mcu.family}`;
    if (cpuFlagRemediationDone.has(key)) {
      return false;
    }
    const pick = await vscode.window.showWarningMessage(
      'Auto CMake Flash: 编译失败 —— 缺少 CPU 编译选项。',
      {
        modal: true,
        detail:
          `编译错误 "selected processor does not support ..." 通常表示工程没有为 ` +
          `${project.mcu.base || project.mcu.family} 提供 -mcpu/-mthumb 选项。\n` +
          `是否让插件重新配置并自动补齐（${cpuFlags}）后重新编译？\n` +
          '将生成 .auto-cmake-flash 工具链文件（保留工程原有工具链设置）并清理构建缓存，不会修改你的 CMakeLists.txt。',
      },
      { title: '补齐 CPU 选项并重新编译', value: 'fix' },
    );
    if (pick?.value !== 'fix') {
      log('用户选择不补齐 CPU 选项。');
      return false;
    }
    cpuFlagRemediationDone.add(key);
    const fs = require('fs') as typeof import('fs');
    const dir = path.join(root, '.auto-cmake-flash');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'auto-cmake-flash.toolchain.cmake');
    fs.writeFileSync(
      file,
      generateToolchainFileContent(gccPath, gppPath, {
        cpuFlags,
        includeOriginalToolchain: pickOriginalToolchainFile(project),
      }),
      'utf8',
    );
    log(`自愈: 生成含 CPU 选项的工具链文件 ${file}，重新配置...`);
    const okCfg = await doConfigure(root, token, { toolchainFile: file });
    if (!okCfg) {
      return false;
    }
    return doBuild(root, token);
  }

  // ---------------- 烧录 ----------------

  async function collectAllArtifacts(root: string): Promise<FirmwareArtifact[]> {
    const buildDir = buildDirOf(root);
    const inBuild = await findArtifacts(buildDir);
    const fromProject = state.project?.artifacts ?? [];
    const seen = new Set<string>();
    const all: FirmwareArtifact[] = [];
    for (const a of [...inBuild, ...fromProject]) {
      const key = a.path.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        all.push(a);
      }
    }
    return all;
  }

  async function resolveBinAddress(selected: FirmwareArtifact | undefined): Promise<string | undefined> {
    if (!selected || selected.format !== 'bin') {
      return undefined;
    }
    const fromSetting = settings.binFlashAddress.trim();
    if (isValidHexAddress(fromSetting)) {
      return fromSetting;
    }
    const input = await inputBinAddressDialog(fromSetting || undefined);
    if (input && isValidHexAddress(input)) {
      return input.trim();
    }
    return undefined;
  }

  async function doFlash(
    root: string,
    requireFreshBuild: boolean,
    token: vscode.CancellationToken,
  ): Promise<void> {
    await ensureScanned(root);
    const project = state.project!;
    const okTc = await ensureToolchain(root);
    const tc = state.toolchain;

    const cliInfo = tc?.tools.programmerCli;
    if (!cliInfo?.found || !cliInfo.path) {
      void vscode.window.showErrorMessage(
        'Auto CMake Flash: 未找到 STM32CubeProgrammer CLI，无法烧录。请安装 STM32CubeCLT 或在设置中指定路径。',
        '查看解决方法',
      ).then((pick) => {
        if (pick === '查看解决方法') {
          void vscode.commands.executeCommand('autoCmakeFlash.showMissingTools');
        }
      });
      return;
    }

    const all = await collectAllArtifacts(root);
    const selected = selectFirmware(all);
    const binAddress = await resolveBinAddress(selected);

    const persisted = await readPersistedState(buildDirOf(root));
    const lastBuild = state.lastBuild ?? persisted?.lastBuild;

    const precheck = checkFlashPreconditions({
      lastBuild,
      artifacts: all,
      mcu: project.mcu,
      binAddress,
      requireFreshBuild,
    });

    const cli = new Stm32CubeProgrammerCli(cliInfo.path, undefined, {
      cancelToken: token,
      downloadTimeoutMs: settings.flashTimeoutSec * 1000,
    });

    logger.section('烧录');
    const outcome = await performFlash({
      cli,
      workspaceRoot: root,
      mcu: project.mcu,
      precheck,
      settings: {
        iface: settings.downloadInterface,
        speedKhz: settings.downloadSpeedKhz,
        resetAfterFlash: settings.resetAfterFlash,
      },
      confirm: confirmFlashDialog,
      log,
      lastStLink: state.stlink,
    });

    state.lastFlash = outcome;
    refresh();

    switch (outcome.status) {
      case 'success':
        void vscode.window.showInformationMessage(
          'Auto CMake Flash: 烧录成功 — 下载成功，校验通过，目标已复位。',
        );
        break;
      case 'reset-failed':
        void vscode.window.showWarningMessage(
          'Auto CMake Flash: 固件已下载并校验通过，但复位命令失败，请手动复位目标。',
        );
        break;
      case 'verify-unconfirmed':
        void vscode.window.showWarningMessage(
          'Auto CMake Flash: 下载命令执行完成，校验状态未确认。请查看日志核对 STM32CubeProgrammer 输出。',
          '查看日志',
        ).then((pick) => {
          if (pick === '查看日志') {
            channel.show(true);
          }
        });
        break;
      case 'cancelled':
        void vscode.window.showInformationMessage('Auto CMake Flash: 已取消烧录。');
        break;
      case 'blocked':
        void vscode.window.showWarningMessage(
          `Auto CMake Flash: 烧录已阻止 — ${outcome.blocker ?? '前置条件不满足'}`,
        );
        break;
      default:
        void vscode.window
          .showErrorMessage(
            `Auto CMake Flash: 烧录未成功 — ${flashStatusText(outcome)}（下载: ${outcome.downloaded ? '成功' : '失败'}，校验: ${verifyText(outcome.verify)}）`,
            '查看日志',
          )
          .then((pick) => {
            if (pick === '查看日志') {
              channel.show(true);
            }
          });
        break;
    }
  }

  // ---------------- 命令注册 ----------------

  const register = (id: string, fn: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          await fn(...args);
        } catch (e) {
          const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
          logger.error(`命令 ${id} 异常:\n${msg}`);
          void vscode.window.showErrorMessage(`Auto CMake Flash: 命令执行异常 — ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
  };

  register('autoCmakeFlash.scanProject', async () => {
    const root = await pickRoot();
    if (root) {
      await doScan(root, false);
    }
  });

  register('autoCmakeFlash.detectEnvironment', async () => {
    const root = await pickRoot();
    if (root) {
      await doDetectEnvironment(root, false);
    }
  });

  register('autoCmakeFlash.detectStLink', async () => {
    const root = await pickRoot();
    if (!root) {
      return;
    }
    await ensureToolchain(root);
    const cliPath = state.toolchain?.tools.programmerCli.found
      ? state.toolchain.tools.programmerCli.path
      : undefined;
    state.stlink = await detectStLink(cliPath, undefined, 30_000);
    const st = state.stlink;
    if (st.status === 'probeDetected') {
      void vscode.window.showInformationMessage(
        `Auto CMake Flash: 已检测到 ${st.probeCount} 个 ST-LINK（SN: ${st.probes.map((p) => p.serial ?? '?').join(', ')}）。\n注意: 这表示适配器在线，目标芯片连接状态在烧录预检中确认。`,
      );
    } else if (st.status === 'noProbe') {
      void vscode.window.showWarningMessage(`Auto CMake Flash: 未检测到 ST-LINK。\n${st.error ?? ''}`);
    } else {
      void vscode.window.showWarningMessage(`Auto CMake Flash: ST-LINK 检测结果未知。\n${st.error ?? ''}`);
    }
    logger.info(`ST-LINK 检测原始输出:\n${st.rawOutput ?? st.error ?? '(无)'}`);
    refresh();
  });

  register('autoCmakeFlash.configureCMake', async () => {
    await runExclusive('configure', 'CMake 配置', false, async (token) => {
      const root = await pickRoot();
      if (root) {
        await doConfigure(root, token);
      }
      return undefined;
    });
  });

  register('autoCmakeFlash.build', async () => {
    await runExclusive('build', '编译工程', true, async (token) => {
      const root = await pickRoot();
      if (root) {
        await buildWithCpuRemediation(root, token);
      }
      return undefined;
    });
  });

  register('autoCmakeFlash.rebuild', async () => {
    await runExclusive('build', '重新配置并编译', true, async (token) => {
      const root = await pickRoot();
      if (!root) {
        return undefined;
      }
      const okCfg = await doConfigure(root, token);
      if (!okCfg) {
        return undefined;
      }
      await buildWithCpuRemediation(root, token);
      return undefined;
    });
  });

  register('autoCmakeFlash.buildAndFlash', async () => {
    await runExclusive('flash', '编译并烧录', true, async (token) => {
      const root = await pickRoot();
      if (!root) {
        return undefined;
      }
      const okBuild = await buildWithCpuRemediation(root, token);
      if (!okBuild) {
        return undefined;
      }
      await doFlash(root, true, token);
      return undefined;
    });
  });

  register('autoCmakeFlash.flashExisting', async () => {
    await runExclusive('flash', '烧录现有固件', false, async (token) => {
      const root = await pickRoot();
      if (root) {
        // “烧录现有固件”是用户显式选择的独立操作：不要求本次构建成功，
        // 但确认窗口中会显著提示固件来源，且仍需明确确认。
        await doFlash(root, false, token);
      }
      return undefined;
    });
  });

  register('autoCmakeFlash.clean', async () => {
    const root = await pickRoot();
    if (!root) {
      return;
    }
    if (state.busy !== 'none') {
      void vscode.window.showWarningMessage('Auto CMake Flash: 有任务正在进行，无法清理构建目录。');
      return;
    }
    const buildDir = buildDirOf(root);
    const fs = require('fs') as typeof import('fs');
    if (!fs.existsSync(buildDir)) {
      void vscode.window.showInformationMessage(`Auto CMake Flash: 构建目录不存在（${buildDir}），无需清理。`);
      return;
    }
    const persisted = await readPersistedState(buildDir);
    const isOurs = !!persisted;
    const confirmed = await confirmCleanDialog(buildDir, isOurs);
    if (!confirmed) {
      log('用户取消了清理操作。');
      return;
    }
    logger.section('清理构建目录');
    log(`删除目录: ${buildDir}`);
    try {
      fs.rmSync(buildDir, { recursive: true, force: true });
      state.lastBuild = undefined;
      diagnostics.clear();
      refresh();
      void vscode.window.showInformationMessage('Auto CMake Flash: 构建目录已清理。');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`清理失败: ${msg}`);
      void vscode.window.showErrorMessage(`Auto CMake Flash: 清理失败 — ${msg}`);
    }
  });

  register('autoCmakeFlash.openBuildDir', async () => {
    const root = await pickRoot();
    if (!root) {
      return;
    }
    const buildDir = buildDirOf(root);
    if (!existsSync(buildDir)) {
      void vscode.window.showInformationMessage(
        `Auto CMake Flash: 构建目录尚不存在（${buildDir}）。请先执行 CMake 配置。`,
      );
      return;
    }
    await vscode.env.openExternal(vscode.Uri.file(buildDir));
  });

  register('autoCmakeFlash.showArtifacts', async () => {
    const root = await pickRoot();
    if (!root) {
      return;
    }
    const all = await collectAllArtifacts(root);
    if (all.length === 0) {
      void vscode.window.showInformationMessage(
        'Auto CMake Flash: 未找到任何固件产物（.elf/.hex/.bin）。请先成功编译工程。',
      );
      return;
    }
    const persisted = await readPersistedState(buildDirOf(root));
    const lastBuild = state.lastBuild ?? persisted?.lastBuild;
    const items = all.map((a) => ({
      label: `$(file-binary) [${a.format.toUpperCase()}] ${path.basename(a.path)}`,
      description: `${(a.sizeBytes / 1024).toFixed(1)} KB  ${new Date(a.mtimeMs).toLocaleString()}`,
      detail: a.path,
      artifact: a,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      title: 'Auto CMake Flash — 构建产物（选择后定位文件）',
      ignoreFocusOut: true,
    });
    if (pick) {
      if (lastBuild && lastBuild.success) {
        // 标记新鲜度供用户参考
        void vscode.window.showInformationMessage(
          `产物: ${pick.artifact.path}\n该文件 ${pick.artifact.mtimeMs >= lastBuild.startedAt - 2000 ? '产生于最近一次构建' : '早于最近一次构建（旧产物，默认情况下会被烧录门禁阻止）'}`,
          { modal: false },
        );
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(pick.artifact.path));
    }
  });

  register('autoCmakeFlash.revealElf', async () => {
    const root = await pickRoot();
    if (!root) {
      return;
    }
    let elf = state.lastBuild?.elfPath;
    if (!elf || !existsSync(elf)) {
      const all = await findArtifacts(buildDirOf(root));
      elf = all.find((a) => a.format === 'elf')?.path;
    }
    if (!elf) {
      void vscode.window.showInformationMessage('Auto CMake Flash: 未找到 ELF 文件，请先成功编译工程。');
      return;
    }
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(elf));
  });

  register('autoCmakeFlash.chooseMcu', async () => {
    const root = await pickRoot();
    if (!root) {
      return;
    }
    await ensureScanned(root);
    const project = state.project!;
    const models = [
      ...new Set(project.mcu.evidence.filter((e) => e.model).map((e) => e.model!)),
    ];
    const bases = [
      ...new Set(project.mcu.evidence.filter((e) => e.base).map((e) => `${e.base!}xx`)),
    ];
    const candidates = [...new Set([...models, ...bases])];
    const pick = await chooseMcuDialog(candidates, project.mcu.family || undefined);
    if (!pick) {
      return;
    }
    const chip = parseChipToken(pick);
    if (!chip) {
      void vscode.window.showErrorMessage(`无法解析型号 "${pick}"，请输入 STM32 开头的完整型号。`);
      return;
    }
    state.project!.mcu = combineEvidence(project.mcu.evidence, pick);
    logger.info(`用户手动确认芯片型号: ${pick} -> ${state.project!.mcu.base} (${state.project!.mcu.macro})`);
    refresh();
    void vscode.window.showInformationMessage(
      `Auto CMake Flash: 芯片型号已确认为 ${state.project!.mcu.base}（编译宏 ${state.project!.mcu.macro}）。`,
    );
  });

  register('autoCmakeFlash.showLogs', () => {
    channel.show(true);
  });

  register('autoCmakeFlash.openSettings', () => {
    void vscode.commands.executeCommand(
      'workbench.action.openSettings',
      '@ext:acflash.auto-cmake-flash',
    );
  });

  register('autoCmakeFlash.showWarnings', async () => {
    const w = state.project?.warnings ?? [];
    if (w.length === 0) {
      void vscode.window.showInformationMessage('Auto CMake Flash: 当前没有识别警告。');
      return;
    }
    await vscode.window.showInformationMessage(
      `Auto CMake Flash 识别警告:\n\n${w.map((x, i) => `${i + 1}. ${x}`).join('\n')}`,
      { modal: true },
    );
  });

  register('autoCmakeFlash.showMissingTools', async () => {
    const missing = state.toolchain?.missing ?? [];
    if (missing.length === 0) {
      void vscode.window.showInformationMessage('Auto CMake Flash: 工具链完整，没有缺失组件。');
      return;
    }
    const advice = missingToolAdvice(missing);
    await vscode.window.showWarningMessage(
      `Auto CMake Flash 缺少 ${missing.length} 个组件:\n\n${advice.map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
      { modal: true },
      '打开设置',
    ).then((pick) => {
      if (pick === '打开设置') {
        void vscode.commands.executeCommand('autoCmakeFlash.openSettings');
      }
    });
  });

  // ---------------- 激活后自动扫描（延迟，不阻塞启动） ----------------
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
          return;
        }
        const marker = folders.find(
          (f) =>
            existsSync(path.join(f.uri.fsPath, 'CMakeLists.txt')) ||
            existsSync(path.join(f.uri.fsPath, '.ioc')) ||
            findIocFast(f.uri.fsPath),
        );
        const root = marker?.uri.fsPath ?? folders[0].uri.fsPath;
        logger.section('自动扫描（扩展激活）');
        await doScan(root, true);
        await doDetectEnvironment(root, true);
      } catch (e) {
        logger.error(`自动扫描失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, 2000);
  context.subscriptions.push(new vscode.Disposable(() => clearTimeout(timer)));

  logger.info('Auto CMake Flash 已激活。');
  refresh();
}

export function deactivate(): void {
  // 运行中的外部进程由 withProgress 令牌与进程超时管理，
  // VS Code 停用扩展时会随宿主关闭而终止。
}
