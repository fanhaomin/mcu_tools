"use strict";
/**
 * Embedded Debug — 扩展入口。
 *
 * 职责：装配各模块、注册命令、维护会话状态与并发控制。
 * 核心逻辑全部在 src/detection、src/cmake、src/flash 中（不依赖 vscode），
 * 本文件只做 VS Code API 适配。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const logger_1 = require("./util/logger");
const path_1 = require("./util/path");
const process_1 = require("./util/process");
const projectDetector_1 = require("./detection/projectDetector");
const toolchainDetector_1 = require("./detection/toolchainDetector");
const stlinkDetector_1 = require("./detection/stlinkDetector");
const cubemxDetector_1 = require("./detection/cubemxDetector");
const svdParser_1 = require("./svd/svdParser");
const svdFinder_1 = require("./svd/svdFinder");
const periphView_1 = require("./ui/periphView");
const stm32Detector_1 = require("./detection/stm32Detector");
const artifacts_1 = require("./cmake/artifacts");
const configure_1 = require("./cmake/configure");
const build_1 = require("./cmake/build");
const stm32CubeProgrammer_1 = require("./flash/stm32CubeProgrammer");
const programmer_1 = require("./flash/programmer");
const debugConfig_1 = require("./debug/debugConfig");
const probeCleanup_1 = require("./debug/probeCleanup");
const settings_1 = require("./config/settings");
const sidebar_1 = require("./ui/sidebar");
const statusBar_1 = require("./ui/statusBar");
const iocLauncherEditor_1 = require("./ui/iocLauncherEditor");
const configPanel_1 = require("./ui/configPanel");
const workspaceSettings_1 = require("./config/workspaceSettings");
const watchView_1 = require("./ui/watchView");
const chartView_1 = require("./ui/chartView");
const arrayView_1 = require("./ui/arrayView");
const memView_1 = require("./ui/memView");
const callStackView_1 = require("./ui/callStackView");
const disasmView_1 = require("./ui/disasmView");
const confirmation_1 = require("./ui/confirmation");
function activate(context) {
    try {
        init(context);
    }
    catch (e) {
        // 激活异常兜底：不能因插件错误拖垮 VS Code
        const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
        try {
            const ch = vscode.window.createOutputChannel('Embedded Debug');
            ch.appendLine(`[FATAL] 扩展激活失败:\n${msg}`);
            ch.show();
        }
        catch {
            /* ignore */
        }
        void vscode.window.showErrorMessage('Embedded Debug 扩展激活失败，详情见输出面板 "Embedded Debug"。');
    }
}
function init(context) {
    const channel = vscode.window.createOutputChannel('Embedded Debug');
    context.subscriptions.push(channel);
    let settings = (0, settings_1.loadSettings)();
    const logger = new logger_1.Logger(channel, () => settings.verboseLogging);
    const state = { busy: 'none', target: undefined };
    const sidebar = new sidebar_1.SidebarProvider(() => state);
    const treeView = vscode.window.createTreeView('autoCmakeFlash.project', {
        treeDataProvider: sidebar,
    });
    context.subscriptions.push(treeView);
    const status = new statusBar_1.StatusBar();
    context.subscriptions.push(status);
    const diagnostics = vscode.languages.createDiagnosticCollection('Embedded Debug');
    context.subscriptions.push(diagnostics);
    let cancelSource;
    const refresh = () => {
        sidebar.refresh();
        status.update(state, settings.buildType);
    };
    const log = (msg) => logger.info(msg);
    // 输出面板自动跟随最新内容：关键节点强制 show（VS Code 只有在视图位于底部时
    // 才会自动滚动，用户滚过一次就停住；重新 show 会让它回到最新行）。
    // repin：先隐藏再显示，强制把视图重新钉回底部——用于任务开始时，
    // 即便面板停留在上次滚动的位置，新输出也会从头跟随。
    let lastOutputShow = 0;
    const showLatest = (force = false, repin = false) => {
        const now = Date.now();
        if (!force && now - lastOutputShow <= 1000) {
            return;
        }
        lastOutputShow = now;
        if (repin) {
            channel.hide();
        }
        channel.show(true);
    };
    context.subscriptions.push((0, settings_1.onSettingsChange)(() => {
        settings = (0, settings_1.loadSettings)();
        logger.info('设置已更新。');
        periph.setIntervalMs(settings.debugRefreshMs);
        watch.setIntervalMs(settings.debugRefreshMs);
        chart.setIntervalMs();
        arrayv.setIntervalMs();
        mem.setIntervalMs(settings.debugRefreshMs);
        refresh();
    }));
    const configPanel = new configPanel_1.ConfigPanel(log);
    // 一次性迁移：旧版默认 cmake-build-${buildType} 残留在工程设置里会覆盖新默认，
    // 检测到即移除（构建目录恢复 build/<构建类型> 两级结构）。
    // 一次性迁移：旧默认 cmake-build-${buildType} 残留会覆盖新默认 → 移除；
    // 同时清理 0.9.39 前写入 bug 落在 settings.json 顶层的无前缀死键。
    void (async () => {
        try {
            if (/cmake-build-/i.test(settings.buildDir)) {
                const legacyDir = settings.buildDir;
                await (0, workspaceSettings_1.updateWorkspaceSetting)('buildDir', undefined);
                settings = (0, settings_1.loadSettings)();
                logger.warn(`已移除旧构建目录设置 "${legacyDir}"；构建目录恢复默认 build/${settings.buildType}（两级目录）`);
                refresh();
            }
            const dead = await (0, workspaceSettings_1.cleanupLegacyDeadKeys)();
            if (dead.length > 0) {
                logger.warn(`已清理 settings.json 中的旧遗留无效键: ${dead.join(', ')}`);
                settings = (0, settings_1.loadSettings)();
            }
        }
        catch {
            // 迁移失败不阻塞启动；buildDirOf 已对 cmake-build-* 强制归一
        }
    })();
    // ---------------- 基础工具 ----------------
    /** 选择工作区根目录（处理未打开工作区 / 多工作区） */
    async function pickRoot() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            void vscode.window.showInformationMessage('Embedded Debug: 请先打开包含 STM32 工程的文件夹（文件 → 打开文件夹）。');
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
        const withMarker = folders.filter((f) => (0, path_1.existsSync)(path.join(f.uri.fsPath, 'CMakeLists.txt')) ||
            (0, path_1.existsSync)(path.join(f.uri.fsPath, '.ioc')) ||
            findIocFast(f.uri.fsPath));
        const candidates = withMarker.length > 0 ? withMarker : folders;
        if (candidates.length === 1) {
            state.root = candidates[0].uri.fsPath;
            return state.root;
        }
        const pick = await vscode.window.showQuickPick(candidates.map((f) => ({
            label: f.name,
            description: f.uri.fsPath,
            fsPath: f.uri.fsPath,
        })), { title: 'Embedded Debug — 选择要操作的工程目录', ignoreFocusOut: true });
        state.root = pick?.fsPath;
        return state.root;
    }
    function findIocFast(root) {
        try {
            const fs = require('fs');
            return fs
                .readdirSync(root)
                .some((n) => n.toLowerCase().endsWith('.ioc'));
        }
        catch {
            return false;
        }
    }
    /** 扫描工程目录下所有 CMakeLists.txt，提取 add_executable / add_custom_target 目标名（忽略 ${...} 变量形式，去重） */
    function discoverTargets(root) {
        const fs = require('fs');
        const found = new Set();
        const skipDirs = new Set(['.git', '.auto-cmake-flash', 'build', 'build-auto', 'cmake-build-debug', 'cmake-build-release']);
        const re = /\b(?:add_executable|add_custom_target)\s*\(\s*([A-Za-z0-9_.+-]+)/g;
        const walk = (dir, depth) => {
            if (depth > 6) {
                return;
            }
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const e of entries) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) {
                    if (e.name.startsWith('.') || skipDirs.has(e.name.toLowerCase())) {
                        continue;
                    }
                    walk(p, depth + 1);
                }
                else if (e.name === 'CMakeLists.txt') {
                    let text;
                    try {
                        text = fs.readFileSync(p, 'utf8');
                    }
                    catch {
                        continue;
                    }
                    let m;
                    while ((m = re.exec(text)) !== null) {
                        const name = m[1];
                        // 正则字符类不含 $，${VAR} 形式天然不匹配；再排除 ALL / main
                        if (!name || name === 'ALL' || name === 'main') {
                            continue;
                        }
                        found.add(name);
                    }
                }
            }
        };
        walk(root, 0);
        return [...found];
    }
    function buildDirOf(root) {
        const bd = settings.buildDir;
        // 支持 ${buildType} 占位符；值为 "build" 时自动按构建类型分子目录
        // （build/Debug、build/Release），与 CLion CMakePresets 的 binaryDir 约定一致。
        let resolved = bd.split('${buildType}').join(settings.buildType);
        // CLion 命名统一：cmake-build-<Type> 的类型段统一小写（cmake-build-debug / release）
        resolved = resolved.replace(/(^|[\\/])cmake-build-([^\\/]+)$/i, (m0, sep, t) => (sep || '') + 'cmake-build-' + t.toLowerCase());
        if (!path.isAbsolute(resolved) && /(^|[\\/])build([\\/])?$/i.test(resolved)) {
            resolved = `${resolved.replace(/[\\/]$/, '')}/${settings.buildType}`;
        }
        return path.isAbsolute(resolved) ? resolved : path.join(root, resolved);
    }
    /** 并发保护：同一时间只允许一个配置/编译/烧录/调试任务 */
    async function runExclusive(kind, title, cancellable, fn) {
        if (state.busy !== 'none') {
            const label = state.busy === 'build'
                ? '编译'
                : state.busy === 'flash'
                    ? '烧录'
                    : state.busy === 'debug'
                        ? '调试'
                        : '配置';
            void vscode.window.showWarningMessage(`Embedded Debug: 已有${label}任务正在进行，请等待其完成后再试。`);
            return undefined;
        }
        state.busy = kind;
        cancelSource = new vscode.CancellationTokenSource();
        refresh();
        try {
            return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Embedded Debug: ${title}`,
                cancellable,
            }, async (_progress, token) => fn(token));
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error(`任务 "${title}" 异常: ${msg}`);
            void vscode.window.showErrorMessage(`Embedded Debug: ${title}失败 — ${msg}`);
            return undefined;
        }
        finally {
            state.busy = 'none';
            cancelSource?.dispose();
            cancelSource = undefined;
            refresh();
        }
    }
    async function ensureScanned(root) {
        if (state.project && state.project.root === root) {
            return;
        }
        await doScan(root, true);
    }
    async function ensureToolchain(root) {
        if (state.toolchain) {
            return true;
        }
        await doDetectEnvironment(root, true);
        return !!state.toolchain;
    }
    // ---------------- 扫描与环境检测 ----------------
    async function doScan(root, silent) {
        logger.section(`扫描工程 ${root}`);
        const project = await (0, projectDetector_1.detectProject)(root);
        state.root = root;
        state.project = project;
        // 读取插件构建目录的持久化状态（上次构建记录）
        const buildDir = buildDirOf(root);
        const persisted = await (0, artifacts_1.readPersistedState)(buildDir);
        if (persisted?.lastBuild) {
            state.lastBuild = persisted.lastBuild;
        }
        logger.info(`工程识别: ${project.name}`);
        logger.info(`CMakeLists.txt: ${project.hasCMakeLists ? project.cmakeListsPath : '未找到'}`);
        logger.info(`.ioc: ${project.hasIoc ? project.iocPath : '未找到'}`);
        // 上下文键：驱动标题栏「打开 .ioc 文件」按钮的显隐
        void vscode.commands.executeCommand('setContext', 'autoCmakeFlash.hasIoc', project.hasIoc);
        // 识别到芯片后自动定位 SVD，供外设寄存器视图使用
        if (project.mcu.base) {
            void refreshPeripheralSvd();
        }
        logger.info(`芯片结论: ${project.mcu.model || '待确认'} 家族=${project.mcu.family || '未知'} ` +
            `可信度=${project.mcu.confidence}${project.mcu.confirmedByUser ? '（用户确认）' : ''}`);
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
            void vscode.window.showInformationMessage(`Embedded Debug 扫描完成 — ${parts.join('；')}`, '手动选择型号').then((pick) => {
                if (pick === '手动选择型号') {
                    void vscode.commands.executeCommand('autoCmakeFlash.chooseMcu');
                }
            });
        }
        refresh();
    }
    async function doDetectEnvironment(root, silent) {
        logger.section('检测开发环境');
        const env = (0, toolchainDetector_1.defaultDetectionEnv)();
        const toolchain = await (0, toolchainDetector_1.detectToolchain)(env, {
            overrides: {
                cmake: settings.cmakePath || undefined,
                ninja: settings.ninjaPath || undefined,
                armGcc: settings.armToolchainPath || undefined,
                programmerCli: settings.programmerCliPath || undefined,
            },
            timeoutMs: 15_000,
        });
        state.toolchain = toolchain;
        for (const name of Object.keys(toolchain.tools)) {
            const t = toolchain.tools[name];
            if (t.found) {
                logger.info(`${t.label}: ${t.path}${t.version ? ` (版本 ${t.version})` : ' (版本未知)'}${t.error ? ` [${t.error}]` : ''}`);
            }
            else {
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
        state.stlink = await (0, stlinkDetector_1.detectStLink)(cliPath, undefined, 30_000);
        const st = state.stlink;
        logger.info(st.status === 'probeDetected'
            ? `ST-LINK: 检测到 ${st.probeCount} 个探头（注意: 这不代表目标芯片已可连接）`
            : st.status === 'noProbe'
                ? 'ST-LINK: 未检测到适配器'
                : st.status === 'cliMissing'
                    ? 'ST-LINK: STM32CubeProgrammer CLI 未找到，无法检测'
                    : `ST-LINK: 检测结果未知 — ${st.error ?? ''}`);
        if (!silent) {
            const found = Object.values(toolchain.tools).filter((t) => t.found).length;
            const total = Object.keys(toolchain.tools).length;
            if (toolchain.complete && state.stlink?.status === 'probeDetected') {
                void vscode.window.showInformationMessage(`Embedded Debug: 环境检测完成（${found}/${total} 组件就绪，ST-LINK 已检测到）。`);
            }
            else if (toolchain.complete) {
                void vscode.window.showInformationMessage(`Embedded Debug: 工具链完整（${found}/${total}），但未检测到 ST-LINK 适配器（烧录前会再次检测）。`);
            }
            else {
                void vscode.window.showWarningMessage(`Embedded Debug: 缺少 ${toolchain.missing.length} 个工具链组件，详见侧边栏与日志。`, '查看解决方法').then((pick) => {
                    if (pick === '查看解决方法') {
                        void vscode.commands.executeCommand('autoCmakeFlash.showMissingTools');
                    }
                });
            }
        }
        refresh();
    }
    // ---------------- CMake 配置 ----------------
    async function doConfigure(root, token, 
    /** 编译失败自愈路径：跳过决策逻辑，直接使用指定工具链文件 */
    override) {
        await ensureScanned(root);
        const project = state.project;
        const tc = state.toolchain;
        if (!project.hasCMakeLists || !project.cmakeListsPath) {
            if (project.hasIoc) {
                void vscode.window
                    .showWarningMessage('Embedded Debug: 工程包含 STM32CubeMX .ioc 文件但没有 CMakeLists.txt。\n' +
                    '请使用 STM32CubeMX → Project Manager → Toolchain/IDE 选择 "CMake" 重新生成工程（插件第一版不自行生成 CubeMX 工程）。', '重新扫描')
                    .then((pick) => {
                    if (pick === '重新扫描') {
                        void vscode.commands.executeCommand('autoCmakeFlash.scanProject');
                    }
                });
            }
            else {
                void vscode.window.showErrorMessage('Embedded Debug: 未找到 CMakeLists.txt，无法进行 CMake 配置。');
            }
            return false;
        }
        if (!tc) {
            void vscode.window.showErrorMessage('Embedded Debug: 开发环境未就绪（CMake 未检测到）。请先执行“检测开发环境”。');
            return false;
        }
        if (!tc.tools.cmake.found || !tc.tools.cmake.path) {
            void vscode.window.showErrorMessage('Embedded Debug: 未找到 CMake。请安装 STM32CubeCLT 或在设置中指定 cmake 路径。');
            return false;
        }
        // 生成器可用性检查（Ninja 不可用时提供切换选项）
        let generator = settings.generator;
        if (/^ninja$/i.test(generator) && !tc.tools.ninja.found) {
            const pick = await vscode.window.showWarningMessage('Embedded Debug: Ninja 未检测到。', { modal: true, detail: '可以安装 STM32CubeCLT（自带 Ninja），或改用其他已安装的生成器。' }, { title: '改用 MinGW Makefiles', value: 'MinGW Makefiles' }, { title: '改用 NMake Makefiles', value: 'NMake Makefiles' }, { title: '仍使用 Ninja', value: 'Ninja' });
            if (!pick) {
                log('用户取消了生成器选择，配置中止。');
                return false;
            }
            generator = pick.value;
            log(`生成器切换为: ${generator}`);
        }
        // 工具链文件决策：不与工程已有配置冲突。
        // cpuFlags 按识别到的芯片家族推导（-mcpu/-mthumb），补齐未提供 CPU 选项的工程。
        const cpuFlags = (0, stm32Detector_1.familyCpuFlags)(project.mcu.family);
        let userToolchainFile;
        let generatedToolchainFile;
        if (override) {
            userToolchainFile = override.toolchainFile;
            log(`使用自愈工具链文件: ${userToolchainFile}`);
        }
        else if (settings.cmakeToolchainFile.trim()) {
            userToolchainFile = settings.cmakeToolchainFile.trim();
        }
        else {
            const declares = await (0, configure_1.cmakeListsDeclaresToolchain)(project.cmakeListsPath);
            if (project.hasToolchainConfig || declares) {
                // 工程自带工具链时直接使用它（与 CLion preset 的 toolchainFile 等价），
                // 保证插件与 CLion 在同一构建目录中缓存一致，不互相触发重配置。
                const original = pickOriginalToolchainFile(project);
                if (original) {
                    userToolchainFile = original;
                    log(`使用工程自带工具链文件: ${original}`);
                }
                else {
                    log('工程已自带工具链配置（CMakeLists 或 .cmake 文件），不注入 CMAKE_TOOLCHAIN_FILE。');
                }
            }
            else if (tc.tools.armGcc.found && tc.tools.armGcc.path && tc.tools.armGpp.found && tc.tools.armGpp.path) {
                const dir = path.join(root, '.auto-cmake-flash');
                const fs = require('fs');
                fs.mkdirSync(dir, { recursive: true });
                const file = path.join(dir, 'auto-cmake-flash.toolchain.cmake');
                fs.writeFileSync(file, (0, configure_1.generateToolchainFileContent)(tc.tools.armGcc.path, tc.tools.armGpp.path, { cpuFlags }), 'utf8');
                generatedToolchainFile = file;
                log(`工程无工具链配置，已生成插件工具链文件: ${file}${cpuFlags ? `（含 ${cpuFlags}）` : ''}`);
            }
            else {
                logger.warn('工程无工具链配置且未检测到 ARM GCC。将尝试直接配置；若 CMakeLists 未设置编译器，配置会失败。');
                void vscode.window.showWarningMessage('Embedded Debug: 未检测到 ARM GCC 工具链，且工程没有自带工具链配置。CMake 配置可能失败，建议先安装 STM32CubeCLT。');
            }
        }
        showLatest(true, true);
        logger.section('CMake 配置');
        const buildDir = buildDirOf(root);
        const cmakeExe = tc.tools.cmake.path;
        const ninjaOk = tc.tools.ninja.found;
        const runConfigure = (toolchainFile, generated, hasExisting = project.hasToolchainConfig) => (0, configure_1.configureProject)({
            root,
            buildDir,
            generator,
            buildType: settings.buildType,
            cmakePath: cmakeExe,
            ninjaAvailable: ninjaOk,
            hasExistingToolchain: hasExisting,
            toolchainFile,
            generatedToolchainFile: generated,
            extraArgs: (0, path_1.splitArgs)(settings.cmakeExtraArgs ?? ''),
            confirmReuseForeignBuildDir: confirmation_1.confirmReuseBuildDirDialog,
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
            const compilerBroken = /is not able to compile a simple test program/i.test(combined) ||
                /Detecting C(?:ompiler|XX compiler) ABI info - failed/i.test(combined) ||
                /compiler[^:\n]*- broken/i.test(combined);
            const needsTryCompileFix = compilerBroken &&
                project.cmakeListsPath !== undefined &&
                !/CMAKE_TRY_COMPILE_TARGET_TYPE/i.test((await (0, path_1.readTextFile)(project.cmakeListsPath, 512 * 1024)) ?? '');
            const gccPath = tc.tools.armGcc.found ? tc.tools.armGcc.path : undefined;
            const gppPath = tc.tools.armGpp.found ? tc.tools.armGpp.path : undefined;
            if ((compilerMissing || needsTryCompileFix) && gccPath && gppPath) {
                const pick = await vscode.window.showWarningMessage('Embedded Debug: CMake 配置失败（交叉编译器检查未通过）。', {
                    modal: true,
                    detail: (compilerMissing
                        ? 'CMake 未能找到编译器，且工程没有可用的工具链配置。\n'
                        : 'CMake 对裸机交叉编译器的默认链接测试失败（工程未设置 CMAKE_TRY_COMPILE_TARGET_TYPE）。\n') +
                        '是否使用插件生成的工具链文件重试一次？\n' +
                        '该文件指向已检测到的 ARM GCC，并设置 CMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY（跳过链接级测试，裸机工程标准做法）。\n' +
                        '将写入 .auto-cmake-flash/ 目录并清理构建目录的 CMake 缓存残留；你的 CMakeLists.txt 不会被修改。',
                }, { title: '使用插件工具链重试', value: 'retry' });
                if (pick?.value === 'retry') {
                    const fs = require('fs');
                    const dir = path.join(root, '.auto-cmake-flash');
                    fs.mkdirSync(dir, { recursive: true });
                    const file = path.join(dir, 'auto-cmake-flash.toolchain.cmake');
                    fs.writeFileSync(file, (0, configure_1.generateToolchainFileContent)(gccPath, gppPath, {
                        cpuFlags,
                        includeOriginalToolchain: pickOriginalToolchainFile(project),
                    }), 'utf8');
                    log(`使用插件工具链文件重试: ${file}${cpuFlags ? `（含 ${cpuFlags}）` : ''}`);
                    const cleaned = await (0, configure_1.clearCMakeConfigureResidue)(buildDir);
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
            void vscode.window.showErrorMessage(`Embedded Debug: CMake 配置失败 — ${outcome.reason ?? `退出码 ${outcome.result?.exitCode}，详见日志`}`, '查看日志').then((pick) => {
                if (pick === '查看日志') {
                    channel.show(true);
                }
            });
            return false;
        }
        void vscode.window.showInformationMessage(`Embedded Debug: CMake 配置成功（${generator} / ${settings.buildType}）。可以开始编译。`);
        return true;
    }
    /** 选择工程内最可能承载工具链设置的 .cmake 文件（生成自愈工具链时先 include 它，保留原有设置） */
    function pickOriginalToolchainFile(project) {
        return project.toolchainFiles.find((f) => /gcc-arm-none-eabi|toolchain|stm32cubemx/i.test(path.basename(f)));
    }
    /** 从编译输出提取内存占用表行（arm-none-eabi-size 汇总 / --print-memory-usage 两种格式） */
    function parseMemoryInfo(stdout) {
        const out = [];
        for (const raw of String(stdout ?? '').split(/\r?\n/)) {
            const l = raw.replace(/\s+$/, '');
            if (!l) {
                continue;
            }
            if (/Memory\s+region\s+Used\s+Size\s+Region\s+Size/i.test(l) ||
                /^\s*[\w().-]+:\s+[\d\s,.]+(B|KB|MB)\s+[\d\s,.]+(B|KB|MB)\s+\d+(?:\.\d+)?%\s*$/i.test(l) ||
                /^\s*text\s+data\s+bss\s+dec\s+hex\s+filename/i.test(l) ||
                /^\s*\d+\s+\d+\s+\d+\s+\d+\s+[0-9a-fA-F]+\s+\S+\.(elf|axf)\s*$/i.test(l)) {
                out.push(l);
            }
        }
        return out;
    }
    // ---------------- 编译 ----------------
    async function doBuild(root, token) {
        await ensureScanned(root);
        const project = state.project;
        if (!project.hasCMakeLists) {
            void vscode.window.showErrorMessage('Embedded Debug: 未找到 CMakeLists.txt，无法编译。若是 CubeMX 工程，请先用 STM32CubeMX 生成 CMake 工程。');
            return false;
        }
        const okTc = await ensureToolchain(root);
        const tc = state.toolchain;
        if (!tc || !tc.tools.cmake.found || !tc.tools.cmake.path) {
            void vscode.window.showErrorMessage('Embedded Debug: CMake 不可用，无法编译。');
            return false;
        }
        const buildDir = buildDirOf(root);
        if (!(await (0, build_1.isConfigured)(buildDir))) {
            log('构建目录尚未配置，先执行 CMake 配置...');
            const configured = await doConfigure(root, token);
            if (!configured) {
                return false;
            }
        }
        showLatest(true, true);
        channel.appendLine('');
        channel.appendLine('='.repeat(20) + `[ 构建 | ${path.basename(root)} | ${settings.buildType} ]` + '='.repeat(32));
        diagnostics.clear();
        const outcome = await (0, build_1.buildProject)({
            root,
            buildDir,
            cmakePath: tc.tools.cmake.path,
            buildType: settings.buildType,
            target: state.target,
            token,
            timeoutMs: settings.buildTimeoutSec * 1000,
            log,
            onOutput: (chunk) => channel.append(chunk),
        });
        // 输出已实时流式显示；结果行已由 build.ts 打印（成功）/ 失败摘要（失败），此处不重复
        // 诊断写入问题面板
        for (const d of outcome.diagnostics) {
            diagnostics.set(vscode.Uri.file(d.file), [
                new vscode.Diagnostic(new vscode.Range(Math.max(0, d.line - 1), Math.max(0, d.column - 1), Math.max(0, d.line - 1), 200), d.message, d.severity === 'error'
                    ? vscode.DiagnosticSeverity.Error
                    : vscode.DiagnosticSeverity.Warning),
            ]);
        }
        state.lastBuild = outcome.record;
        refresh();
        if (!outcome.ok) {
            void vscode.window
                .showWarningMessage(`Embedded Debug: 编译失败（${outcome.record.cancelled ? '已取消' : `退出码 ${outcome.record.exitCode}`}）。已阻止烧录，防止误烧旧固件。`, '查看问题', '查看日志')
                .then((pick) => {
                if (pick === '查看问题') {
                    void vscode.commands.executeCommand('workbench.action.problems.focus');
                }
                else if (pick === '查看日志') {
                    channel.show(true);
                }
            });
            return false;
        }
        // 内存占用表已随 ninja 流式输出显示（紧跟各自的目标链接行），结尾不再重复整块
        showLatest(true);
        return true;
    }
    /** 每个工程只提示一次 CPU 选项自愈，避免循环弹窗 */
    const cpuFlagRemediationDone = new Set();
    /**
     * 编译 + 缺失 CPU 选项自愈。
     * 编译失败且日志命中 "selected processor does not support ..."（工程未提供
     * -mcpu/-mthumb 的典型症状）时，经用户确认后重新配置（工具链文件保留工程
     * 原有设置并自动补齐 CPU 选项）再编译一次。
     */
    async function buildWithCpuRemediation(root, token) {
        let ok = await doBuild(root, token);
        if (ok) {
            return true;
        }
        const buildDir = buildDirOf(root);
        const logText = await (0, path_1.readTextFile)(path.join(buildDir, 'last-build.log'), 1024 * 1024);
        if (!logText || !/selected processor does not support/i.test(logText)) {
            return false;
        }
        const project = state.project;
        const tc = state.toolchain;
        const gccPath = tc?.tools.armGcc.found ? tc.tools.armGcc.path : undefined;
        const gppPath = tc?.tools.armGpp.found ? tc.tools.armGpp.path : undefined;
        const cpuFlags = (0, stm32Detector_1.familyCpuFlags)(project.mcu.family);
        if (!gccPath || !gppPath || !cpuFlags) {
            return false;
        }
        const key = `${root}:${project.mcu.base || project.mcu.family}`;
        if (cpuFlagRemediationDone.has(key)) {
            return false;
        }
        const pick = await vscode.window.showWarningMessage('Embedded Debug: 编译失败 —— 缺少 CPU 编译选项。', {
            modal: true,
            detail: `编译错误 "selected processor does not support ..." 通常表示工程没有为 ` +
                `${project.mcu.base || project.mcu.family} 提供 -mcpu/-mthumb 选项。\n` +
                `是否让插件重新配置并自动补齐（${cpuFlags}）后重新编译？\n` +
                '将生成 .auto-cmake-flash 工具链文件（保留工程原有工具链设置）并清理构建缓存，不会修改你的 CMakeLists.txt。',
        }, { title: '补齐 CPU 选项并重新编译', value: 'fix' });
        if (pick?.value !== 'fix') {
            log('用户选择不补齐 CPU 选项。');
            return false;
        }
        cpuFlagRemediationDone.add(key);
        const fs = require('fs');
        const dir = path.join(root, '.auto-cmake-flash');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'auto-cmake-flash.toolchain.cmake');
        fs.writeFileSync(file, (0, configure_1.generateToolchainFileContent)(gccPath, gppPath, {
            cpuFlags,
            includeOriginalToolchain: pickOriginalToolchainFile(project),
        }), 'utf8');
        log(`自愈: 生成含 CPU 选项的工具链文件 ${file}，重新配置...`);
        const okCfg = await doConfigure(root, token, { toolchainFile: file });
        if (!okCfg) {
            return false;
        }
        return doBuild(root, token);
    }
    // ---------------- 烧录 ----------------
    async function collectAllArtifacts(root) {
        const buildDir = buildDirOf(root);
        const inBuild = await (0, artifacts_1.findArtifacts)(buildDir);
        const fromProject = state.project?.artifacts ?? [];
        const seen = new Set();
        const all = [];
        for (const a of [...inBuild, ...fromProject]) {
            const key = a.path.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                all.push(a);
            }
        }
        return all;
    }
    async function resolveBinAddress(selected) {
        if (!selected || selected.format !== 'bin') {
            return undefined;
        }
        const fromSetting = settings.binFlashAddress.trim();
        if ((0, artifacts_1.isValidHexAddress)(fromSetting)) {
            return fromSetting;
        }
        const input = await (0, confirmation_1.inputBinAddressDialog)(fromSetting || undefined);
        if (input && (0, artifacts_1.isValidHexAddress)(input)) {
            return input.trim();
        }
        return undefined;
    }
    async function doFlash(root, requireFreshBuild, token, 
    /** 调试流程复用：强制烧录后不复位（保持停机，供 probe-rs attach 接管） */
    opts) {
        await ensureScanned(root);
        const project = state.project;
        const okTc = await ensureToolchain(root);
        const tc = state.toolchain;
        const cliInfo = tc?.tools.programmerCli;
        if (!cliInfo?.found || !cliInfo.path) {
            void vscode.window.showErrorMessage('Embedded Debug: 未找到 STM32CubeProgrammer CLI，无法烧录。请安装 STM32CubeCLT 或在设置中指定路径。', '查看解决方法').then((pick) => {
                if (pick === '查看解决方法') {
                    void vscode.commands.executeCommand('autoCmakeFlash.showMissingTools');
                }
            });
            return;
        }
        const all = await collectAllArtifacts(root);
        // 用户选择了编译目标时，优先烧录 <目标名>.elf（其次 .hex/.bin）
        let selected;
        if (state.target) {
            const fs = require('fs');
            const base = path.join(buildDirOf(root), state.target);
            for (const fmt of ['elf', 'hex', 'bin']) {
                const p = `${base}.${fmt}`;
                if (fs.existsSync(p)) {
                    const st = fs.statSync(p);
                    selected = { path: p, format: fmt, mtimeMs: st.mtimeMs, sizeBytes: st.size };
                    log(`目标 ${state.target} 固件: ${p}`);
                    break;
                }
            }
            if (!selected) {
                log(`未在构建目录找到 ${state.target}.elf/.hex/.bin，回退自动选择固件。`);
            }
        }
        if (!selected) {
            selected = (0, artifacts_1.selectFirmware)(all);
        }
        const binAddress = await resolveBinAddress(selected);
        const persisted = await (0, artifacts_1.readPersistedState)(buildDirOf(root));
        const lastBuild = state.lastBuild ?? persisted?.lastBuild;
        const precheck = (0, artifacts_1.checkFlashPreconditions)({
            lastBuild,
            artifacts: all,
            artifact: selected,
            mcu: project.mcu,
            binAddress,
            requireFreshBuild,
        });
        const cli = new stm32CubeProgrammer_1.Stm32CubeProgrammerCli(cliInfo.path, undefined, {
            cancelToken: token,
            downloadTimeoutMs: settings.flashTimeoutSec * 1000,
        });
        showLatest(true, true);
        logger.section('烧录');
        const outcome = await (0, programmer_1.performFlash)({
            cli,
            workspaceRoot: root,
            mcu: project.mcu,
            precheck,
            settings: {
                iface: settings.downloadInterface,
                speedKhz: settings.downloadSpeedKhz,
                resetAfterFlash: opts?.resetOverride ?? settings.resetAfterFlash,
            },
            confirm: confirmation_1.confirmFlashDialog,
            log,
            lastStLink: state.stlink,
            killOrphanProbeHolders: () => (0, probeCleanup_1.killOrphanProbeHolders)('准备烧录', log),
            openOcdPath: settings.openocdPath.trim() || 'openocd',
            flashTimeoutSec: settings.flashTimeoutSec,
        });
        state.lastFlash = outcome;
        refresh();
        showLatest(true);
        switch (outcome.status) {
            case 'success':
                // 烧录成功不弹通知，结果看状态栏按钮和输出面板
                break;
            case 'reset-failed':
                void vscode.window.showWarningMessage('Embedded Debug: 固件已下载并校验通过，但复位命令失败，请手动复位目标。');
                break;
            case 'verify-unconfirmed':
                void vscode.window.showWarningMessage('Embedded Debug: 下载命令执行完成，校验状态未确认。请查看日志核对 STM32CubeProgrammer 输出。', '查看日志').then((pick) => {
                    if (pick === '查看日志') {
                        channel.show(true);
                    }
                });
                break;
            case 'cancelled':
                void vscode.window.showInformationMessage('Embedded Debug: 已取消烧录。');
                break;
            case 'blocked':
                void vscode.window.showWarningMessage(`Embedded Debug: 烧录已阻止 — ${outcome.blocker ?? '前置条件不满足'}`);
                break;
            default:
                void vscode.window
                    .showErrorMessage(`Embedded Debug: 烧录未成功 — ${(0, sidebar_1.flashStatusText)(outcome)}（下载: ${outcome.downloaded ? '成功' : '失败'}，校验: ${(0, sidebar_1.verifyText)(outcome.verify)}）`, '查看日志')
                    .then((pick) => {
                    if (pick === '查看日志') {
                        channel.show(true);
                    }
                });
                break;
        }
        return outcome;
    }
    // ---------------- 调试 ----------------
    /**
     * 启动调试会话（仅 probe-rs：直连 DAP，支持运行中读寄存器，面板读取零停机）。
     * probe-rs 仅负责调试会话；烧录走 CubeProgrammer 链路，烧后不复位保持停机，
     * 由 probe-rs attach 接管。
     */
    async function doDebugLaunch(root, request, token) {
        await ensureScanned(root);
        if (!(await ensureDebugExtension('Embedded Debug', debugConfig_1.PROBE_RS_EXTENSION_ID))) {
            return;
        }
        const project = state.project;
        const chip = settings.probeRsChip.trim() ||
            (0, debugConfig_1.deriveProbeRsChip)(project.mcu.model || project.mcu.base || '');
        if (!chip) {
            void vscode.window.showErrorMessage('Embedded Debug: 无法从识别的型号推导 probe-rs 芯片名（需要精确型号如 STM32F103C8）。' +
                '请执行“手动选择芯片型号”补全，或在设置 autoCmakeFlash.probeRsChip 中直接指定。');
            return;
        }
        logger.section(request === 'launch' ? '编译并调试 (probe-rs)' : '附加调试 (probe-rs)');
        if (request === 'launch' && !(await confirmDebuggableBuild(root))) {
            return;
        }
        // 电压闸门：兼容款 ST-LINK 的电压读数乱跳（0V↔6.3V），probe-rs 读到 0V 直接拒绝
        // 启动。启动前先试探，读到有效值才放行——把碰运气变成插件自动碰。
        await probeRsVoltageGate();
        if (request === 'launch') {
            // 烧录（CubeProgrammer，不复位）——失败即不进入调试
            const outcome = await doFlash(root, true, token, { resetOverride: 'none' });
            if (!outcome || outcome.status !== 'success') {
                void vscode.window.showErrorMessage(`Embedded Debug: 烧录未成功（${outcome ? (0, sidebar_1.flashStatusText)(outcome) : '已取消'}），已取消进入调试。`, '查看日志').then((pick) => {
                    if (pick === '查看日志') {
                        channel.show(true);
                    }
                });
                return;
            }
        }
        let elf = state.lastBuild?.elfPath;
        if (!elf || !(0, path_1.existsSync)(elf)) {
            const all = await collectAllArtifacts(root);
            elf = all.find((a) => a.format === 'elf')?.path;
        }
        if (!elf) {
            void vscode.window.showErrorMessage('Embedded Debug: 未找到 ELF 文件，无法调试（需要带调试信息的 ELF）。请先编译工程。');
            return;
        }
        const config = (0, debugConfig_1.buildProbeRsLaunch)({
            root,
            elfPath: elf,
            chip,
            interface: settings.downloadInterface,
            speedKhz: settings.downloadSpeedKhz,
            svdFile: (svdCache?.file ?? settings.svdFile.trim()) || undefined,
            request: 'attach',
        });
        if (state.stlink?.status === 'noProbe') {
            void vscode.window.showWarningMessage('Embedded Debug: 未检测到 ST-LINK 适配器，调试启动可能失败，请检查连接。');
        }
        // 会话命名带 工程名+引擎+模式，调试工具栏的会话选择器可区分；
        // 单探针独占：先结束残留的引擎会话，避免同名会话堆积
        config.name =
            `调试器 ${state.project?.name ?? root} · probe-rs` +
                (request === 'attach' ? ' · 附加' : '');
        for (const st of [...liveSessions]) {
            try {
                await vscode.debug.stopDebugging(st);
                liveSessions.delete(st);
                log(`已结束残留调试会话: ${st.name}`);
            }
            catch {
                // 会话可能已退出
                liveSessions.delete(st);
            }
        }
        // 上次异常退出可能留下孤儿 GDB Server 一直占着 ST-LINK，启动前先清掉
        await (0, probeCleanup_1.killOrphanProbeHolders)('准备启动调试', log);
        const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
        const started = await vscode.debug.startDebugging(folder, config);
        if (!started) {
            void vscode.window.showErrorMessage('Embedded Debug: 调试会话启动失败，请查看调试控制台（DEBUG CONSOLE）与插件日志。', '查看日志').then((pick) => {
                if (pick === '查看日志') {
                    channel.show(true);
                }
            });
        }
        else {
            void vscode.window.showInformationMessage('Embedded Debug: 已附加到目标（停机状态）。打断点后点调试工具栏的 ⟳ 重启复位，再按 F5 运行到断点。');
        }
    }
    /** Release/MinSizeRel 构建启动调试前的确认（ELF 可能无调试信息） */
    async function confirmDebuggableBuild(root) {
        const cacheText = await (0, path_1.readTextFile)(path.join(buildDirOf(root), 'CMakeCache.txt'), 256 * 1024);
        const bt = (0, debugConfig_1.parseBuildTypeFromCMakeCache)(cacheText ?? '');
        if ((0, debugConfig_1.isDebuggableBuildType)(bt)) {
            return true;
        }
        const pick = await vscode.window.showWarningMessage(`Embedded Debug: 当前构建类型为 ${bt}，ELF 可能没有调试信息（断点可能无法命中源码）。`, { modal: true, detail: '建议将设置 autoCmakeFlash.buildType 改为 Debug 后重新编译。' }, { title: '仍要调试', value: 'continue' });
        if (pick?.value !== 'continue') {
            log('用户取消调试（构建类型无调试信息）。');
            return false;
        }
        return true;
    }
    /**
     * probe-rs 电压闸门：兼容款 ST-LINK 的电压读数乱跳（0V↔6.3V），probe-rs 读到
     * 无效电压会直接拒绝启动。启动前先用 `probe-rs info` 试探，读到有效值才放行；
     * 最多重试 6 次 × 1.2s。返回 false = 重试后仍无效，调用方中止调试。
     */
    async function probeRsVoltageGate() {
        const exe = vscode.workspace
            .getConfiguration('probe-rs-debugger')
            .get('debuggerExecutable', '') || 'probe-rs';
        for (let i = 1; i <= 6; i++) {
            try {
                const r = await (0, process_1.execFileSafe)(exe, ['info'], { timeoutMs: 10_000 });
                const combined = `${r.stdout}\n${r.stderr}`;
                if (/Invalid voltage/i.test(combined)) {
                    log(`probe-rs 电压闸门: 第 ${i}/6 次读到无效电压，等待后重试…`);
                    await new Promise((resolve) => setTimeout(resolve, 1200));
                    continue;
                }
                // 电压读数有效（或进入了芯片识别等其他环节）→ 放行
                log(`probe-rs 电压闸门: 第 ${i} 次读数有效，放行。`);
                return true;
            }
            catch (e) {
                // info 执行失败（探针忙等）也按重试处理
                log(`probe-rs 电压闸门: 第 ${i}/6 次探测失败，等待后重试…`);
                await new Promise((resolve) => setTimeout(resolve, 1200));
            }
        }
        void vscode.window.showWarningMessage('Embedded Debug: 探针电压读数持续异常（兼容款 ST-LINK 常见）。已重试 6 次未放行——请稍后重试调试。');
        return false;
    }
    /** 确保 probe-rs 调试扩展（市场名「Embedded Debug」）已安装，未装时引导安装 */
    async function ensureDebugExtension(displayName, extensionId) {
        if (vscode.extensions.getExtension(extensionId)) {
            return true;
        }
        const pick = await vscode.window.showWarningMessage(`Embedded Debug: 调试引擎扩展「${displayName}」未安装。`, {
            modal: true,
            detail: `「${displayName}」（${extensionId}）提供调试适配层，插件自动生成的调试配置由它执行。是否立即安装？`,
        }, { title: '立即安装', value: 'install' });
        if (pick?.value !== 'install') {
            log(`用户取消安装 ${extensionId}，调试中止。`);
            return false;
        }
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Embedded Debug: 正在安装 ${extensionId}...`,
            }, () => vscode.commands.executeCommand('workbench.extensions.installExtension', extensionId));
        }
        catch (e) {
            void vscode.window.showErrorMessage(`Embedded Debug: ${extensionId} 安装失败 — ${e instanceof Error ? e.message : String(e)}。可在扩展市场手动安装后重试。`);
            return false;
        }
        if (!vscode.extensions.getExtension(extensionId)) {
            void vscode.window.showErrorMessage(`Embedded Debug: ${extensionId} 安装命令已执行但扩展仍不可见，请重启窗口后重试。`);
            return false;
        }
        return true;
    }
    // ---------------- CubeMX (.ioc) ----------------
    /**
     * 用 STM32CubeMX 打开 .ioc（CLion 行为）。分离启动、不阻塞编辑器。
     * 返回：launched=已启动；notfound=未找到 CubeMX；failed=启动失败。
     */
    async function launchIocInCubeMx(iocPath) {
        const env = (0, toolchainDetector_1.defaultDetectionEnv)();
        const cubeMx = await (0, cubemxDetector_1.findCubeMx)(env, settings.cubemxPath || undefined);
        if (!cubeMx) {
            return 'notfound';
        }
        return new Promise((resolve) => {
            try {
                log(`用 STM32CubeMX 打开: ${iocPath}（${cubeMx}）`);
                const cp = require('child_process');
                const child = cp.spawn(cubeMx, [iocPath], {
                    detached: true,
                    stdio: 'ignore',
                    cwd: path.dirname(iocPath),
                });
                let settled = false;
                child.on('error', (e) => {
                    if (!settled) {
                        settled = true;
                        logger.error(`STM32CubeMX 启动失败: ${e.message}`);
                        resolve('failed');
                    }
                });
                child.unref();
                setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        resolve('launched');
                    }
                }, 1500);
            }
            catch (e) {
                logger.error(`STM32CubeMX 启动失败: ${e instanceof Error ? e.message : String(e)}`);
                resolve('failed');
            }
        });
    }
    /** 在文本编辑器中打开 .ioc（自定义编辑器的回退路径） */
    const openIocAsText = (uri) => {
        void vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    };
    // 注册 .ioc 自定义编辑器：资源管理器中点击/双击 .ioc → 自动启动 STM32CubeMX
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(iocLauncherEditor_1.IocLauncherEditorProvider.viewType, new iocLauncherEditor_1.IocLauncherEditorProvider(launchIocInCubeMx, openIocAsText, log), { supportsMultipleEditorsPerDocument: false }));
    // ---------------- 外设寄存器视图（SVD + 实时刷新） ----------------
    let svdCache;
    let periphStatus = '未加载 SVD';
    // 自行跟踪引擎会话：不用 activeDebugSession——存在多个/失效会话时它可能指向
    // 非引擎会话，导致面板误判"未在调试会话中"
    let engineSession;
    /** 活跃的引擎会话（启动新调试前清理，避免同名会话堆积） */
    const liveSessions = new Set();
    // 「调试器」底栏容器显隐：无引擎调试会话时整体隐藏（when=acf.debugActive
    // 挂在全部六个调试视图上，容器内无可见视图时 VS Code 会隐藏整个标签）
    const setDebugPanelsVisible = (on) => {
        void vscode.commands.executeCommand('setContext', 'acf.debugActive', on);
    };
    // 窗口重载落在调试中途的场景：激活时就有活跃会话 → 立即显示
    setDebugPanelsVisible(!!vscode.debug.activeDebugSession);
    const periph = new periphView_1.PeriphViewProvider({
        getSvd: () => (svdCache ? { device: svdCache.device, file: svdCache.file } : undefined),
        getSvdStatus: () => periphStatus,
        getSession: () => engineSession,
        log,
        getInterval: () => settings.debugRefreshMs,
    });
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(periphView_1.PeriphViewProvider.viewType, periph, { webviewOptions: { retainContextWhenHidden: true } }));
    // 波形面板：数据来自变量监控的每轮采样（onSample），曲线勾选列表来自监控条目
    // （onEntries）；仅打开波形标签时由其宿主定时器反向驱动监控采样（forceSample）。
    let watchRef;
    const chart = new chartView_1.ChartViewProvider({
        memento: context.workspaceState,
        log,
        getInterval: () => settings.debugRefreshMs,
        getSession: () => engineSession,
        forceSample: () => watchRef?.forceSample(),
        onReady: () => watchRef?.syncChart(),
    });
    // 数组面板：二维及以上标量数组的矩阵可视化（独立于波形，自行 readMemory 采样）
    const arrayv = new arrayView_1.ArrayViewProvider({
        memento: context.workspaceState,
        getSession: () => engineSession,
        log,
        getInterval: () => settings.debugRefreshMs,
        onReady: () => watchRef?.syncChart(),
    });
    const watch = new watchView_1.WatchViewProvider({
        getSession: () => engineSession,
        log,
        memento: context.workspaceState,
        getElf: async () => {
            const p = state.lastBuild?.elfPath;
            if (p && (0, path_1.existsSync)(p)) {
                return p;
            }
            // 兜底：上次构建记录缺失/指向旧目录时，扫描构建目录取最新的 ELF
            const root = state.root;
            if (!root) {
                return undefined;
            }
            const elfs = (await (0, artifacts_1.findArtifacts)(buildDirOf(root))).filter((a) => a.format === 'elf');
            return elfs[0]?.path;
        },
        getNm: () => {
            const g = state.toolchain?.tools.armGcc;
            if (!g?.found || !g.path) {
                return undefined;
            }
            const nm = path.join(path.dirname(g.path), process.platform === 'win32' ? 'arm-none-eabi-nm.exe' : 'arm-none-eabi-nm');
            return (0, path_1.existsSync)(nm) ? nm : undefined;
        },
        getReadelf: () => {
            const g = state.toolchain?.tools.armGcc;
            if (!g?.found || !g.path) {
                return undefined;
            }
            const re = path.join(path.dirname(g.path), process.platform === 'win32' ? 'arm-none-eabi-readelf.exe' : 'arm-none-eabi-readelf');
            return (0, path_1.existsSync)(re) ? re : undefined;
        },
        getInterval: () => settings.debugRefreshMs,
        onEntries: (list) => {
            chart.setEntries(list);
            arrayv.setEntries(list);
        },
        onSample: (t, vals) => {
            chart.pushSample(t, vals);
        },
    });
    watchRef = watch;
    const mem = new memView_1.MemViewProvider({
        getSession: () => engineSession,
        log,
        memento: context.workspaceState,
        getInterval: () => settings.debugRefreshMs,
    });
    // 调用栈：目标停机时自动读取；运行中「微停机抓一次」按需触发
    const callstack = new callStackView_1.CallStackViewProvider({
        getSession: () => engineSession,
        log,
    });
    // 反汇编：源码↔汇编混合视图，停机时按栈顶 PC 定位（objdump 离线解析）
    const disasm = new disasmView_1.DisasmViewProvider({
        getSession: () => engineSession,
        getElf: async () => {
            const p = state.lastBuild?.elfPath;
            if (p && (0, path_1.existsSync)(p)) {
                return p;
            }
            const root = state.root;
            if (!root) {
                return undefined;
            }
            const elfs = (await (0, artifacts_1.findArtifacts)(buildDirOf(root))).filter((a) => a.format === 'elf');
            return elfs[0]?.path;
        },
        getObjdump: () => {
            const g = state.toolchain?.tools.armGcc;
            if (!g?.found || !g.path) {
                return undefined;
            }
            const od = path.join(path.dirname(g.path), process.platform === 'win32' ? 'arm-none-eabi-objdump.exe' : 'arm-none-eabi-objdump');
            return (0, path_1.existsSync)(od) ? od : undefined;
        },
        log,
    });
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(watchView_1.WatchViewProvider.viewType, watch, {
        webviewOptions: { retainContextWhenHidden: true },
    }), vscode.window.registerWebviewViewProvider(chartView_1.ChartViewProvider.viewType, chart, {
        webviewOptions: { retainContextWhenHidden: true },
    }), vscode.window.registerWebviewViewProvider(arrayView_1.ArrayViewProvider.viewType, arrayv, {
        webviewOptions: { retainContextWhenHidden: true },
    }), vscode.window.registerWebviewViewProvider(memView_1.MemViewProvider.viewType, mem, {
        webviewOptions: { retainContextWhenHidden: true },
    }), vscode.window.registerWebviewViewProvider(callStackView_1.CallStackViewProvider.viewType, callstack, {
        webviewOptions: { retainContextWhenHidden: true },
    }), vscode.window.registerWebviewViewProvider(disasmView_1.DisasmViewProvider.viewType, disasm, {
        webviewOptions: { retainContextWhenHidden: true },
    }));
    // 断点捕获：目标暂停时从变量作用域按名捕获监控条目的内存引用
    const stopTrackerFactory = {
        createDebugAdapterTracker(session) {
            return {
                onDidSendMessage: (m) => {
                    if (m.type === 'event' && (m.event === 'stopped' || m.event === 'continued')) {
                        if (isEngineSession(session)) {
                            if (m.event === 'stopped') {
                                void watch.onTargetStopped(session);
                                callstack.onDebugEvent('stopped');
                                disasm.onDebugEvent('stopped');
                            }
                            else {
                                callstack.onDebugEvent('continued');
                                disasm.onDebugEvent('continued');
                            }
                        }
                    }
                },
            };
        },
    };
    context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('probe-rs-debug', stopTrackerFactory));
    const isEngineSession = (s) => s.type === 'probe-rs-debug';
    // 编辑器光标 → 反汇编联动（去抖 150ms；kind=command 的程序化跳转忽略，防回环）
    let disasmFollowTimer;
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.kind === vscode.TextEditorSelectionChangeKind.Command) {
            return;
        }
        const line = e.selections[0]?.active.line;
        if (line === undefined) {
            return;
        }
        if (disasmFollowTimer) {
            clearTimeout(disasmFollowTimer);
        }
        const file = e.textEditor.document.uri.fsPath;
        const ln = line + 1;
        disasmFollowTimer = setTimeout(() => disasm.onEditorCursor(file, ln), 150);
    }));
    // 「已编译进固件」绿点标注（始终开启）：C/C++ 编辑器打开/激活时行尾标出有指令的源码行
    const isCFile = (doc) => /^(c|cpp)$/.test(doc.languageId) || /\.(c|h|cpp|hpp)$/i.test(doc.fileName);
    const decorate = (ed) => {
        if (ed && isCFile(ed.document)) {
            void disasm.decorateEditor(ed);
        }
    };
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(decorate), vscode.workspace.onDidOpenTextDocument((doc) => {
        const ed = vscode.window.visibleTextEditors.find((e) => e.document === doc);
        if (ed && isCFile(doc)) {
            decorate(ed);
        }
    }), 
    // ELF 重建（覆盖所有构建路径，含手动 ninja）→ 重解析目录并重标全部可见 C/C++
    // 编辑器，免除“编译完要切一下文件才显示”
    (() => {
        const w = vscode.workspace.createFileSystemWatcher('**/*.elf');
        let timer;
        const kick = () => {
            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(() => disasm.onElfRebuilt(), 300);
        };
        w.onDidChange(kick);
        w.onDidCreate(kick);
        return w;
    })());
    if (vscode.window.activeTextEditor) {
        decorate(vscode.window.activeTextEditor);
    }
    if (vscode.debug.activeDebugSession && isEngineSession(vscode.debug.activeDebugSession)) {
        engineSession = vscode.debug.activeDebugSession;
    }
    context.subscriptions.push(vscode.debug.onDidChangeActiveDebugSession((s) => {
        if (s && isEngineSession(s)) {
            engineSession = s;
            periph.pushSession();
        }
    }));
    context.subscriptions.push(vscode.debug.onDidStartDebugSession((s) => {
        if (isEngineSession(s)) {
            engineSession = s;
            liveSessions.add(s);
            setDebugPanelsVisible(true);
            periph.pushSession();
            void refreshPeripheralSvd();
            // 开调试即反汇编定位：attach 接管时目标处于停机态（烧录后复位停机），
            // 此刻读栈顶 PC 无需任何额外停机；稍等适配器就绪
            setTimeout(() => disasm.onDebugEvent('stopped'), 2500);
        }
    }), vscode.debug.onDidTerminateDebugSession((s) => {
        callstack.onSessionEnded();
        disasm.onSessionEnded();
        liveSessions.delete(s);
        if (engineSession && engineSession.id === s.id) {
            engineSession = undefined;
        }
        setDebugPanelsVisible(liveSessions.size > 0);
        periph.pushSession();
        // 引擎回收子进程需要一点时间；延迟清理孤儿（期间新会话已启动则自动跳过）
        setTimeout(() => void (0, probeCleanup_1.killOrphanProbeHolders)('调试会话结束', log), 1500);
    }));
    /** 按识别的芯片型号定位并解析 SVD（设置优先 → CubeIDE → Keil DFP → C:\ST） */
    async function refreshPeripheralSvd() {
        const mcu = state.project?.mcu?.base;
        if (!mcu) {
            periphStatus = '未识别芯片型号，无法自动匹配 SVD（先扫描工程）';
            periph.pushSession();
            return;
        }
        const env = (0, toolchainDetector_1.defaultDetectionEnv)();
        const file = await (0, svdFinder_1.findSvd)(env, settings.svdFile || undefined, mcu);
        if (!file) {
            periphStatus = `未找到 ${mcu} 的 SVD —— 可在设置 autoCmakeFlash.svdFile 中指定`;
            periph.pushSession();
            return;
        }
        if (svdCache?.file !== file) {
            const text = await (0, path_1.readTextFile)(file, 8 * 1024 * 1024);
            if (!text) {
                periphStatus = `SVD 读取失败: ${file}`;
                periph.pushSession();
                return;
            }
            svdCache = { file, device: (0, svdParser_1.parseSvd)(text) };
            log(`外设视图: 已加载 SVD ${file}（${svdCache.device.peripherals.length} 个外设）`);
        }
        periphStatus = undefined;
        periph.setSvd(svdCache.device, svdCache.file);
    }
    // ---------------- 命令注册 ----------------
    const register = (id, fn) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, async (...args) => {
            try {
                await fn(...args);
            }
            catch (e) {
                const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
                logger.error(`命令 ${id} 异常:\n${msg}`);
                void vscode.window.showErrorMessage(`Embedded Debug: 命令执行异常 — ${e instanceof Error ? e.message : String(e)}`);
            }
        }));
    };
    register('autoCmakeFlash.scanProject', async () => {
        const root = await pickRoot();
        if (root) {
            // 刷新 = 工程识别 + 开发环境/ST-LINK 检测 一次完成（静默，汇总不再弹窗）
            await doScan(root, true);
            await doDetectEnvironment(root, true);
            refresh();
            log('已刷新工程与环境信息');
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
        state.stlink = await (0, stlinkDetector_1.detectStLink)(cliPath, undefined, 30_000);
        const st = state.stlink;
        if (st.status === 'probeDetected') {
            void vscode.window.showInformationMessage(`Embedded Debug: 已检测到 ${st.probeCount} 个 ST-LINK（SN: ${st.probes.map((p) => p.serial ?? '?').join(', ')}）。\n注意: 这表示适配器在线，目标芯片连接状态在烧录预检中确认。`);
        }
        else if (st.status === 'noProbe') {
            void vscode.window.showWarningMessage(`Embedded Debug: 未检测到 ST-LINK。\n${st.error ?? ''}`);
        }
        else {
            void vscode.window.showWarningMessage(`Embedded Debug: ST-LINK 检测结果未知。\n${st.error ?? ''}`);
        }
        // 检测成功时不再倒出完整原始输出，仅在失败/未知时保留完整记录便于排查
        if (st.status !== 'probeDetected') {
            logger.info(`ST-LINK 检测原始输出:\n${st.rawOutput ?? st.error ?? '(无)'}`);
        }
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
    register('autoCmakeFlash.debug', async () => {
        await runExclusive('debug', '编译并调试', true, async (token) => {
            const root = await pickRoot();
            if (!root) {
                return undefined;
            }
            const okBuild = await buildWithCpuRemediation(root, token);
            if (!okBuild) {
                return undefined;
            }
            await doDebugLaunch(root, 'launch', token);
            return undefined;
        });
    });
    register('autoCmakeFlash.debugAttach', async () => {
        await runExclusive('debug', '附加调试', false, async (token) => {
            const root = await pickRoot();
            if (root) {
                // attach 只连接正在运行的目标，不重新编译、不写固件
                await doDebugLaunch(root, 'attach', token);
            }
            return undefined;
        });
    });
    register('autoCmakeFlash.chooseProject', async () => {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            void vscode.window.showInformationMessage('Embedded Debug: 请先打开包含 STM32 工程的文件夹（文件 → 打开文件夹）。');
            return;
        }
        const root = state.root ?? folders[0].uri.fsPath;
        // 只列出可编译/烧录的 CMake 目标（add_executable / add_custom_target）
        const items = [];
        if (state.target) {
            items.push({ label: `$(close) 清除目标选择（编译全部）`, pickKind: 'clear', value: '' });
        }
        items.push(...discoverTargets(root).map((t) => ({
            label: `$(target) ${t}`,
            pickKind: 'target',
            value: t,
        })));
        if (items.length === (state.target ? 1 : 0)) {
            void vscode.window.showInformationMessage('Embedded Debug: 未在工程中找到 CMake 目标（CMakeLists.txt 中的 add_executable / add_custom_target）。');
            return;
        }
        const pick = await vscode.window.showQuickPick(items, {
            title: 'Embedded Debug',
            placeHolder: '选择编译/烧录目标',
            ignoreFocusOut: true,
        });
        if (!pick) {
            return;
        }
        if (pick.pickKind === 'clear') {
            state.target = undefined;
            log('已清除目标选择，恢复编译全部。');
            refresh();
            return;
        }
        state.target = pick.value;
        log(`已选择编译目标: ${state.target}`);
        refresh();
    });
    register('autoCmakeFlash.clean', async () => {
        const root = await pickRoot();
        if (!root) {
            return;
        }
        if (state.busy !== 'none') {
            void vscode.window.showWarningMessage('Embedded Debug: 有任务正在进行，无法清理构建目录。');
            return;
        }
        const buildDir = buildDirOf(root);
        const fs = require('fs');
        if (!fs.existsSync(buildDir)) {
            void vscode.window.showInformationMessage(`Embedded Debug: 构建目录不存在（${buildDir}），无需清理。`);
            return;
        }
        const persisted = await (0, artifacts_1.readPersistedState)(buildDir);
        const isOurs = !!persisted;
        const confirmed = await (0, confirmation_1.confirmCleanDialog)(buildDir, isOurs);
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
            void vscode.window.showInformationMessage('Embedded Debug: 构建目录已清理。');
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error(`清理失败: ${msg}`);
            void vscode.window.showErrorMessage(`Embedded Debug: 清理失败 — ${msg}`);
        }
    });
    register('autoCmakeFlash.openBuildDir', async () => {
        const root = await pickRoot();
        if (!root) {
            return;
        }
        const buildDir = buildDirOf(root);
        if (!(0, path_1.existsSync)(buildDir)) {
            void vscode.window.showInformationMessage(`Embedded Debug: 构建目录尚不存在（${buildDir}）。请先执行 CMake 配置。`);
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
            void vscode.window.showInformationMessage('Embedded Debug: 未找到任何固件产物（.elf/.hex/.bin）。请先成功编译工程。');
            return;
        }
        const persisted = await (0, artifacts_1.readPersistedState)(buildDirOf(root));
        const lastBuild = state.lastBuild ?? persisted?.lastBuild;
        const items = all.map((a) => ({
            label: `$(file-binary) [${a.format.toUpperCase()}] ${path.basename(a.path)}`,
            description: `${(a.sizeBytes / 1024).toFixed(1)} KB  ${new Date(a.mtimeMs).toLocaleString()}`,
            detail: a.path,
            artifact: a,
        }));
        const pick = await vscode.window.showQuickPick(items, {
            title: 'Embedded Debug — 构建产物（选择后定位文件）',
            ignoreFocusOut: true,
        });
        if (pick) {
            if (lastBuild && lastBuild.success) {
                // 标记新鲜度供用户参考
                void vscode.window.showInformationMessage(`产物: ${pick.artifact.path}\n该文件 ${pick.artifact.mtimeMs >= lastBuild.startedAt - 2000 ? '产生于最近一次构建' : '早于最近一次构建（旧产物，默认情况下会被烧录门禁阻止）'}`, { modal: false });
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
        if (!elf || !(0, path_1.existsSync)(elf)) {
            const all = await (0, artifacts_1.findArtifacts)(buildDirOf(root));
            elf = all.find((a) => a.format === 'elf')?.path;
        }
        if (!elf) {
            void vscode.window.showInformationMessage('Embedded Debug: 未找到 ELF 文件，请先成功编译工程。');
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
        const project = state.project;
        const models = [
            ...new Set(project.mcu.evidence.filter((e) => e.model).map((e) => e.model)),
        ];
        const bases = [
            ...new Set(project.mcu.evidence.filter((e) => e.base).map((e) => `${e.base}xx`)),
        ];
        const candidates = [...new Set([...models, ...bases])];
        const pick = await (0, confirmation_1.chooseMcuDialog)(candidates, project.mcu.family || undefined);
        if (!pick) {
            return;
        }
        const chip = (0, stm32Detector_1.parseChipToken)(pick);
        if (!chip) {
            void vscode.window.showErrorMessage(`无法解析型号 "${pick}"，请输入 STM32 开头的完整型号。`);
            return;
        }
        state.project.mcu = (0, stm32Detector_1.combineEvidence)(project.mcu.evidence, pick);
        logger.info(`用户手动确认芯片型号: ${pick} -> ${state.project.mcu.base} (${state.project.mcu.macro})`);
        refresh();
        void vscode.window.showInformationMessage(`Embedded Debug: 芯片型号已确认为 ${state.project.mcu.base}（编译宏 ${state.project.mcu.macro}）。`);
    });
    register('autoCmakeFlash.openIoc', async () => {
        const root = await pickRoot();
        if (!root) {
            return;
        }
        await ensureScanned(root);
        const project = state.project;
        if (!project.hasIoc || !project.iocPath || !(0, path_1.existsSync)(project.iocPath)) {
            void vscode.window.showInformationMessage('Embedded Debug: 当前工程没有找到 .ioc 文件（不是 CubeMX 生成的工程）。');
            return;
        }
        const iocPath = project.iocPath;
        // 像 CLion 一样：在 STM32CubeMX 中打开 .ioc
        const result = await launchIocInCubeMx(iocPath);
        if (result === 'launched') {
            void vscode.window.showInformationMessage(`Embedded Debug: 正在用 STM32CubeMX 打开 ${path.basename(iocPath)}...`);
            return;
        }
        if (result === 'notfound') {
            const pick = await vscode.window.showWarningMessage('Embedded Debug: 未找到 STM32CubeMX，无法用 CubeMX 打开 .ioc。', {
                modal: true,
                detail: '请安装 STM32CubeMX，或在设置 autoCmakeFlash.cubemxPath 中指定 STM32CubeMX.exe 的完整路径。\n' +
                    '（注意 STM32CubeCLT 不包含 CubeMX，两者是分开安装的。）',
            }, { title: '在编辑器中打开', value: 'editor' });
            if (pick?.value === 'editor') {
                openIocAsText(vscode.Uri.file(iocPath));
            }
            return;
        }
        void vscode.window.showErrorMessage('Embedded Debug: STM32CubeMX 启动失败。可在设置 autoCmakeFlash.cubemxPath 中核正路径。', '在编辑器中打开').then((pick) => {
            if (pick === '在编辑器中打开') {
                openIocAsText(vscode.Uri.file(iocPath));
            }
        });
    });
    register('autoCmakeFlash.showLogs', () => {
        channel.show(true);
    });
    register('autoCmakeFlash.chooseBuildType', async () => {
        const options = ['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel'];
        const pick = await vscode.window.showQuickPick(options.map((o) => ({
            label: o === settings.buildType ? '$(check) ' + o : o,
            description: o === 'Debug' ? '调试信息完整，调试用（build/Debug）' :
                o === 'Release' ? '无调试信息，体积最小（build/Release）' :
                    o === 'RelWithDebInfo' ? '优化 + 调试信息（build/RelWithDebInfo）' :
                        '最小体积（build/MinSizeRel）',
        })), { title: 'Embedded Debug — 选择构建类型', ignoreFocusOut: true });
        if (!pick || pick.label === '$(check) ' + pick.label) {
            return;
        }
        await (0, workspaceSettings_1.updateWorkspaceSetting)('buildType', pick.label);
        settings = (0, settings_1.loadSettings)();
        log('构建类型已切换为 ' + pick.label + '；构建目录随类型自动切换');
        refresh();
    });
    register('autoCmakeFlash.chooseRefreshInterval', async () => {
        const options = [50, 100, 200, 500, 1000];
        const pick = await vscode.window.showQuickPick(options.map((o) => ({ label: o === settings.debugRefreshMs ? '✓ ' + o + 'ms' : o + 'ms' })), { title: 'Embedded Debug — 调试面板刷新间隔（外设/变量/内存共用）', ignoreFocusOut: true });
        if (!pick) {
            return;
        }
        const ms = parseInt(pick.label.replace(/[^0-9]/g, ''), 10);
        await (0, workspaceSettings_1.updateWorkspaceSetting)('debugRefreshMs', ms);
        settings = (0, settings_1.loadSettings)();
        settings.debugRefreshMs = ms; // 直写文件后 Configuration 读取有延迟，先用刚写的值
        periph.setIntervalMs(ms);
        watch.setIntervalMs(ms);
        chart.setIntervalMs();
        mem.setIntervalMs(ms);
        log('调试面板刷新间隔: ' + ms + 'ms');
    });
    // 编辑器右键「在反汇编中显示此行」：离线数据，运行中也可浏览
    register('autoCmakeFlash.showDisasmHere', async () => {
        const ed = vscode.window.activeTextEditor;
        if (!ed) {
            return;
        }
        await vscode.commands.executeCommand('autoCmakeFlash.disasm.focus');
        const ok = await disasm.revealSourceLine(ed.document.uri.fsPath, ed.selection.active.line + 1);
        if (!ok) {
            void vscode.window.showInformationMessage('Embedded Debug: 当前行的源码没有对应汇编（未编译进 ELF 或该行无指令，如注释/空行）。');
        }
    });
    register('autoCmakeFlash.openSettings', () => {
        configPanel.show();
    });
    // 编辑器中选中变量名 → 右键添加到变量监控（DWARF 目录校验）
    register('autoCmakeFlash.addWatchFromEditor', async () => {
        const ed = vscode.window.activeTextEditor;
        if (!ed) {
            void vscode.window.showWarningMessage('Embedded Debug: 没有激活的编辑器。');
            return;
        }
        let name = ed.document.getText(ed.selection).trim();
        if (!name) {
            const wr = ed.document.getWordRangeAtPosition(ed.selection.active);
            if (wr) {
                name = ed.document.getText(wr).trim();
            }
        }
        if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            void vscode.window.showWarningMessage('Embedded Debug: 请先在代码中选中一个变量名（或把光标放在变量名上再右键）。');
            return;
        }
        const r = await watch.addFromEditor(name);
        if (r.status === 'added') {
            void vscode.window.showInformationMessage(`Embedded Debug: 已添加 ${name}（${r.var?.type.label} @ 0x${r.var?.addr.toString(16).toUpperCase()}）到变量监控。`);
        }
        else if (r.status === 'exists') {
            void vscode.window.showInformationMessage(`Embedded Debug: ${name} 已在监控列表中。`);
        }
        else if (r.status === 'full') {
            void vscode.window.showWarningMessage('Embedded Debug: 变量监控条目已满，请先移除部分条目。');
        }
        else if (r.status === 'noelf') {
            void vscode.window.showWarningMessage('Embedded Debug: 没有可用的 DWARF 调试信息（先完成一次 Debug 构建，并确认 readelf 工具可用）。');
        }
        else {
            void vscode.window.showWarningMessage(`Embedded Debug: ELF 中未找到变量 ${name}（函数内局部变量请打断点捕获；也可能被编译器优化掉）。`);
        }
    });
    register('autoCmakeFlash.browseWatchVars', async () => {
        await watch.browseAndAdd();
    });
    register('autoCmakeFlash.showWarnings', async () => {
        const w = state.project?.warnings ?? [];
        if (w.length === 0) {
            void vscode.window.showInformationMessage('Embedded Debug: 当前没有识别警告。');
            return;
        }
        await vscode.window.showInformationMessage(`Embedded Debug 识别警告:\n\n${w.map((x, i) => `${i + 1}. ${x}`).join('\n')}`, { modal: true });
    });
    register('autoCmakeFlash.showMissingTools', async () => {
        const missing = state.toolchain?.missing ?? [];
        if (missing.length === 0) {
            void vscode.window.showInformationMessage('Embedded Debug: 工具链完整，没有缺失组件。');
            return;
        }
        const advice = (0, toolchainDetector_1.missingToolAdvice)(missing);
        await vscode.window.showWarningMessage(`Embedded Debug 缺少 ${missing.length} 个组件:\n\n${advice.map((a, i) => `${i + 1}. ${a}`).join('\n')}`, { modal: true }, '打开设置').then((pick) => {
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
                const marker = folders.find((f) => (0, path_1.existsSync)(path.join(f.uri.fsPath, 'CMakeLists.txt')) ||
                    (0, path_1.existsSync)(path.join(f.uri.fsPath, '.ioc')) ||
                    findIocFast(f.uri.fsPath));
                const root = marker?.uri.fsPath ?? folders[0].uri.fsPath;
                logger.section('自动扫描（扩展激活）');
                await doScan(root, true);
                await doDetectEnvironment(root, true);
            }
            catch (e) {
                logger.error(`自动扫描失败: ${e instanceof Error ? e.message : String(e)}`);
            }
        })();
    }, 2000);
    context.subscriptions.push(new vscode.Disposable(() => clearTimeout(timer)));
    logger.info('Embedded Debug 已激活。');
    refresh();
}
function deactivate() {
    // 运行中的外部进程由 withProgress 令牌与进程超时管理，
    // VS Code 停用扩展时会随宿主关闭而终止。
}
//# sourceMappingURL=extension.js.map