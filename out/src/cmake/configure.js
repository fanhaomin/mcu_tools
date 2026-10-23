"use strict";
/**
 * CMake 配置。
 *
 * 安全策略：
 * - 只在插件专用构建目录（默认 build-auto）中生成文件；
 * - 不覆盖用户已有的 CMakeLists.txt；
 * - 目录非空且不是插件创建的 → 必须用户确认后才能继续；
 * - 工程已自带工具链配置（如 CubeMX CMake 工程）→ 不注入 CMAKE_TOOLCHAIN_FILE。
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
exports.generateToolchainFileContent = generateToolchainFileContent;
exports.buildConfigureArgs = buildConfigureArgs;
exports.cmakeListsDeclaresToolchain = cmakeListsDeclaresToolchain;
exports.clearCMakeConfigureResidue = clearCMakeConfigureResidue;
exports.configureProject = configureProject;
const path = __importStar(require("path"));
const process_1 = require("../util/process");
const path_1 = require("../util/path");
const artifacts_1 = require("./artifacts");
function generateToolchainFileContent(cCompiler, cppCompiler, opts = {}) {
    const lines = [
        '# 由 Auto CMake Flash 自动生成（位于 .auto-cmake-flash/ 目录，可随时删除）。',
    ];
    if (opts.includeOriginalToolchain) {
        lines.push('# 先加载工程原有工具链设置（如 CubeMX 的 gcc-arm-none-eabi.cmake），', '# 再由下方完整路径设置覆盖编译器，确保不依赖 PATH。', `include("${opts.includeOriginalToolchain.replace(/\\/g, '/')}")`, '');
    }
    lines.push('set(CMAKE_SYSTEM_NAME Generic)', 'set(CMAKE_SYSTEM_PROCESSOR arm)', 'set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)', `set(CMAKE_C_COMPILER "${cCompiler.replace(/\\/g, '/')}")`, `set(CMAKE_CXX_COMPILER "${cppCompiler.replace(/\\/g, '/')}")`);
    if (opts.cpuFlags) {
        // *_FLAGS_INIT 仅在首次配置时生效，不会覆盖工程自己追加的选项；
        // 用于补齐未提供 -mcpu/-mthumb 的工程（缺省时 GCC 按 ARM 模式汇编导致
        // "selected processor does not support `wfe' in ARM mode" 等错误）。
        lines.push(`set(CMAKE_C_FLAGS_INIT "\${CMAKE_C_FLAGS_INIT} ${opts.cpuFlags}")`, `set(CMAKE_CXX_FLAGS_INIT "\${CMAKE_CXX_FLAGS_INIT} ${opts.cpuFlags}")`, `set(CMAKE_ASM_FLAGS_INIT "\${CMAKE_ASM_FLAGS_INIT} ${opts.cpuFlags}")`);
    }
    lines.push('');
    return lines.join('\n');
}
/** 组装 cmake 配置参数（纯函数，便于测试） */
function buildConfigureArgs(input) {
    const args = [
        '-S', input.root,
        '-B', input.buildDir,
        '-G', input.generator,
        `-DCMAKE_BUILD_TYPE=${input.buildType}`,
        '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
    ];
    if (input.toolchainFile) {
        args.push(`-DCMAKE_TOOLCHAIN_FILE=${input.toolchainFile}`);
    }
    args.push(...input.extraArgs);
    return args;
}
/** 检测工程 CMakeLists 是否设置了 CMAKE_TOOLCHAIN_FILE（内容级判断） */
async function cmakeListsDeclaresToolchain(cmakeListsPath) {
    const content = await (0, path_1.readTextFile)(cmakeListsPath);
    if (!content) {
        return false;
    }
    return /CMAKE_TOOLCHAIN_FILE/i.test(content);
}
/**
 * 清理失败的 configure 留下的缓存残留（CMakeCache.txt / CMakeFiles）。
 * 仅应在插件专用构建目录中使用；重试注入工具链前调用，
 * 避免 NOTFOUND 编译器条目残留在缓存中导致重试继续失败。
 */
async function clearCMakeConfigureResidue(buildDir) {
    const fs = await Promise.resolve().then(() => __importStar(require('fs')));
    const errors = [];
    for (const target of ['CMakeCache.txt', 'CMakeFiles']) {
        const full = path.join(buildDir, target);
        try {
            await fs.promises.rm(full, { recursive: true, force: true });
        }
        catch (e) {
            errors.push(`${target}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return errors.length > 0 ? errors.join('; ') : undefined;
}
async function configureProject(input) {
    const { log } = input;
    // 1. 前置检查：cmake 可用性
    if (!input.cmakePath) {
        return { ok: false, reason: '未找到 CMake。请安装 STM32CubeCLT 或在设置中指定 cmake 路径。' };
    }
    // 2. 生成器检查：Ninja 不可用时明确提示（调用方 UI 负责提供切换选项）
    if (/^ninja$/i.test(input.generator) && !input.ninjaAvailable) {
        return {
            ok: false,
            reason: '生成器 Ninja 未检测到。请安装 STM32CubeCLT（含 Ninja），' +
                '或将设置 autoCmakeFlash.generator 改为已安装的生成器（如 "MinGW Makefiles"）。',
        };
    }
    // 3. 构建目录策略：不覆盖用户目录
    const buildDir = input.buildDir;
    let fsmod;
    try {
        fsmod = await Promise.resolve().then(() => __importStar(require('fs')));
    }
    catch {
        return { ok: false, reason: '无法加载文件系统模块' };
    }
    const stat = await fsmod.promises.stat(buildDir).catch(() => undefined);
    if (stat?.isDirectory()) {
        const marker = await (0, artifacts_1.readPersistedState)(buildDir);
        const cacheExists = await fsmod.promises
            .stat(path.join(buildDir, 'CMakeCache.txt'))
            .then(() => true)
            .catch(() => false);
        const entries = await fsmod.promises.readdir(buildDir).catch(() => []);
        if (entries.length > 0 && !marker && !cacheExists && !entries.includes(artifacts_1.BUILD_STATE_FILE)) {
            const okToUse = await input.confirmReuseForeignBuildDir(buildDir);
            if (!okToUse) {
                return {
                    ok: false,
                    reason: `目录 ${buildDir} 已存在且不是 Auto CMake Flash 创建的，用户取消了操作。` +
                        '可修改设置 autoCmakeFlash.buildDir 换一个目录。',
                };
            }
            log(`用户确认使用已存在的目录 ${buildDir}`);
            await (0, artifacts_1.writePersistedState)(buildDir, {
                version: 1,
                createdByAutoCmakeFlash: true,
            });
        }
    }
    // 4. 工具链文件决策
    let toolchainFile;
    if (input.toolchainFile) {
        toolchainFile = input.toolchainFile;
        log(`使用用户设置中的工具链文件: ${toolchainFile}`);
    }
    else if (input.hasExistingToolchain) {
        log('工程已自带工具链配置，不再注入 CMAKE_TOOLCHAIN_FILE（避免冲突）。');
    }
    else if (input.generatedToolchainFile) {
        toolchainFile = input.generatedToolchainFile;
        log(`使用插件生成的工具链文件: ${toolchainFile}`);
    }
    else {
        log('警告: 没有任何工具链配置。若 CMakeLists 未设置编译器，configure 可能失败。');
    }
    // 5. 组装并执行
    const args = buildConfigureArgs({
        root: input.root,
        buildDir,
        generator: input.generator,
        buildType: input.buildType,
        toolchainFile,
        extraArgs: input.extraArgs,
    });
    const result = await (0, process_1.execFileSafe)(input.cmakePath, args, {
        cwd: input.root,
        timeoutMs: input.timeoutMs ?? 300_000,
        token: input.token ?? process_1.NULL_CANCEL_TOKEN,
    });
    log(`cmake 配置退出码: ${result.exitCode}${result.timedOut ? '（超时）' : ''}${result.cancelled ? '（已取消）' : ''}`);
    if (result.exitCode === 0) {
        // 写入/刷新插件标记
        const state = await (0, artifacts_1.readPersistedState)(buildDir);
        await (0, artifacts_1.writePersistedState)(buildDir, {
            version: 1,
            createdByAutoCmakeFlash: true,
            lastBuild: state?.lastBuild,
        });
        return { ok: true, result, args };
    }
    return { ok: false, result, args };
}
//# sourceMappingURL=configure.js.map