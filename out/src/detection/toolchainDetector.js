"use strict";
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
exports.toolSpec = toolSpec;
exports.defaultDetectionEnv = defaultDetectionEnv;
exports.resolveArmToolchainSetting = resolveArmToolchainSetting;
exports.detectToolchain = detectToolchain;
exports.missingToolAdvice = missingToolAdvice;
const path = __importStar(require("path"));
const types_1 = require("../types");
const process_1 = require("../util/process");
const path_1 = require("../util/path");
const isWin = () => process.platform === 'win32';
function exeName(base) {
    return isWin() ? `${base}.exe` : base;
}
const TOOL_SPECS = [
    {
        name: 'cmake',
        exe: exeName('cmake'),
        versionArgs: ['--version'],
        versionRegex: /cmake version (\d+\.\d+(?:\.\d+)?)/i,
        cubeCltSubDirs: [path.join('CMake', 'bin')],
        fixedDirs: (platform) => platform === 'win32'
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
        fixedDirs: (platform) => platform === 'win32'
            ? ['C:\\Program Files (x86)\\GNU Arm Embedded Toolchain\\bin', 'C:\\Program Files\\GNU Arm Embedded Toolchain\\bin']
            : ['/usr/bin'],
    },
    {
        name: 'armGpp',
        exe: exeName('arm-none-eabi-g++'),
        versionArgs: ['--version'],
        versionRegex: /(\d+\.\d+\.\d+)/,
        cubeCltSubDirs: [path.join('GNU-tools-for-STM32', 'bin')],
        fixedDirs: (platform) => platform === 'win32'
            ? ['C:\\Program Files (x86)\\GNU Arm Embedded Toolchain\\bin', 'C:\\Program Files\\GNU Arm Embedded Toolchain\\bin']
            : ['/usr/bin'],
    },
    {
        name: 'objcopy',
        exe: exeName('arm-none-eabi-objcopy'),
        versionArgs: ['--version'],
        versionRegex: /(\d+\.\d+\.\d+)/,
        cubeCltSubDirs: [path.join('GNU-tools-for-STM32', 'bin')],
        fixedDirs: (platform) => platform === 'win32'
            ? ['C:\\Program Files (x86)\\GNU Arm Embedded Toolchain\\bin']
            : ['/usr/bin'],
    },
    {
        name: 'size',
        exe: exeName('arm-none-eabi-size'),
        versionArgs: ['--version'],
        versionRegex: /(\d+\.\d+\.\d+)/,
        cubeCltSubDirs: [path.join('GNU-tools-for-STM32', 'bin')],
        fixedDirs: (platform) => platform === 'win32'
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
        fixedDirs: (platform) => platform === 'win32'
            ? [
                'C:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeProgrammer\\bin',
                'C:\\Program Files (x86)\\STMicroelectronics\\STM32Cube\\STM32CubeProgrammer\\bin',
            ]
            : ['/usr/local/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin'],
    },
];
function toolSpec(name) {
    const spec = TOOL_SPECS.find((s) => s.name === name);
    if (!spec) {
        throw new Error(`未知工具: ${name}`);
    }
    return spec;
}
/** 默认检测环境：真实文件系统 + 真实进程调用 */
function defaultDetectionEnv() {
    return {
        async pathLookup(name) {
            const cmd = isWin() ? 'where.exe' : 'which';
            const r = await (0, process_1.execFileSafe)(cmd, [name], { timeoutMs: 10_000 });
            if (r.exitCode !== 0 && !r.stdout.trim()) {
                return [];
            }
            return r.stdout
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => l.length > 0);
        },
        exists: path_1.exists,
        async listDirs(dir) {
            try {
                const fs = await Promise.resolve().then(() => __importStar(require('fs')));
                const entries = await fs.promises.readdir(dir, { withFileTypes: true });
                return entries.filter((e) => e.isDirectory()).map((e) => e.name);
            }
            catch {
                return [];
            }
        },
        async runVersion(file, args, regex, timeoutMs) {
            const opts = { timeoutMs };
            const r = await (0, process_1.execFileSafe)(file, args, opts);
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
async function discoverCubeCltRoots(env, extraRoots) {
    const roots = [];
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
        }
        catch {
            /* 目录不可读 */
        }
    }
    return [...new Set(roots)];
}
/**
 * 将 armToolchainPath 设置解析为具体候选：
 * - 指向 .exe 文件 → 直接使用
 * - 指向目录 → 目录下的 arm-none-eabi-*.exe
 * - 空字符串/undefined → 无覆盖
 */
function resolveArmToolchainSetting(setting) {
    const out = {};
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
        }
        else {
            // 目录形式
            out.armGcc = path.join(p, exeName('arm-none-eabi-gcc'));
            out.armGpp = path.join(p, exeName('arm-none-eabi-g++'));
            out.objcopy = path.join(p, exeName('arm-none-eabi-objcopy'));
            out.size = path.join(p, exeName('arm-none-eabi-size'));
        }
    }
    return out;
}
async function detectToolchain(env, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const cltRoots = await discoverCubeCltRoots(env, opts.extraCltRoots ?? []);
    const overrideBySetting = resolveArmToolchainSetting(opts.overrides?.armGcc);
    const tools = {};
    for (const spec of TOOL_SPECS) {
        const overrideRaw = opts.overrides?.[spec.name] ?? overrideBySetting[spec.name];
        const info = await detectOneTool(env, spec, overrideRaw, cltRoots, timeoutMs);
        tools[spec.name] = info;
    }
    const missing = types_1.ALL_TOOL_NAMES.filter((n) => !tools[n].found);
    return {
        tools,
        complete: missing.length === 0,
        missing,
        detectedAt: new Date().toISOString(),
    };
}
async function detectOneTool(env, spec, override, cltRoots, timeoutMs) {
    const info = {
        name: spec.name,
        label: types_1.TOOL_LABELS[spec.name],
        found: false,
        versionConfirmed: false,
        searched: [],
    };
    // 组装候选（去重、保持优先级）：覆盖 → PATH → CubeCLT → 固定目录
    const candidates = [];
    const push = (p) => {
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
    let firstExisting;
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
function missingToolAdvice(missing) {
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
                return `缺少 ${types_1.TOOL_LABELS[name]}: 随 ARM GNU 工具链一起安装（bin 目录）。`;
            case 'programmerCli':
                return '缺少 STM32CubeProgrammer CLI: 请安装 STM32CubeCLT 或单独安装 STM32CubeProgrammer，或在设置 autoCmakeFlash.programmerCliPath 中指定 STM32_Programmer_CLI.exe 路径。';
            default:
                return `缺少组件: ${name}`;
        }
    });
}
//# sourceMappingURL=toolchainDetector.js.map