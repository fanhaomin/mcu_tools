"use strict";
/**
 * 调试功能测试：cortex-debug launch 配置字段 / CMakeCache 构建类型解析 /
 * 可调试构建类型判定 / 调试工具为可选组件（不参与 complete 判定）。
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const path = __importStar(require("path"));
const debugConfig_1 = require("../src/debug/debugConfig");
const toolchainDetector_1 = require("../src/detection/toolchainDetector");
// ---------- cortex-debug 配置生成 ----------
const baseSpec = {
    root: 'D:\\work\\proj',
    elfPath: 'D:\\work\\proj\\build-auto\\fw.elf',
    device: 'STM32F103C8',
    interface: 'SWD',
    gdbPath: 'C:\\ST\\CLT\\GNU-tools-for-STM32\\bin\\arm-none-eabi-gdb.exe',
    gdbServerPath: 'C:\\ST\\CLT\\STM32CubeProgrammer\\bin\\ST-LINK_gdbserver.exe',
};
(0, node_test_1.test)('launch 配置：cortex-debug + stlink，字段完整并停在 main', () => {
    const c = (0, debugConfig_1.buildCortexDebugLaunch)({ ...baseSpec, request: 'launch' });
    strict_1.default.equal(c.type, 'cortex-debug');
    strict_1.default.equal(c.servertype, 'stlink');
    strict_1.default.equal(c.request, 'launch');
    strict_1.default.equal(c.cwd, baseSpec.root);
    strict_1.default.equal(c.executable, baseSpec.elfPath);
    strict_1.default.equal(c.device, 'STM32F103C8');
    strict_1.default.equal(c.interface, 'swd', 'interface 应转为小写');
    strict_1.default.equal(c.gdbPath, baseSpec.gdbPath);
    strict_1.default.equal(c.serverpath, baseSpec.gdbServerPath);
    strict_1.default.equal(c.runToEntryPoint, 'main');
    strict_1.default.equal(!('svdFile' in c), true, '未提供 SVD 时不应出现该字段');
});
(0, node_test_1.test)('launch 配置：提供 SVD 时包含 svdFile；JTAG 转小写；CubeProgrammer 路径钉死版本', () => {
    const c = (0, debugConfig_1.buildCortexDebugLaunch)({
        ...baseSpec,
        interface: 'JTAG',
        svdFile: 'D:\\svd\\STM32F103.svd',
        cubeProgrammerPath: 'C:\\ST\\CLT\\STM32CubeProgrammer\\bin',
        request: 'launch',
    });
    strict_1.default.equal(c.svdFile, 'D:\\svd\\STM32F103.svd');
    strict_1.default.equal(c.interface, 'jtag');
    strict_1.default.equal(c.stm32cubeprogrammer, 'C:\\ST\\CLT\\STM32CubeProgrammer\\bin');
});
(0, node_test_1.test)('attach 配置：不写 runToEntryPoint（不下载固件）', () => {
    const c = (0, debugConfig_1.buildCortexDebugLaunch)({ ...baseSpec, request: 'attach' });
    strict_1.default.equal(c.request, 'attach');
    strict_1.default.equal(!('runToEntryPoint' in c), true);
});
(0, node_test_1.test)('cortex-debug 扩展 ID 正确', () => {
    strict_1.default.equal(debugConfig_1.CORTEX_DEBUG_EXTENSION_ID, 'marus25.cortex-debug');
});
// ---------- 构建类型检查 ----------
(0, node_test_1.test)('解析 CMakeCache 中的 CMAKE_BUILD_TYPE', () => {
    const cache = [
        '# This is the CMakeCache file.',
        '//: 5',
        'CMAKE_GENERATOR:INTERNAL=Ninja',
        'CMAKE_BUILD_TYPE:STRING=Debug',
        'CMAKE_PROJECT_NAME:STATIC=blink',
    ].join('\n');
    strict_1.default.equal((0, debugConfig_1.parseBuildTypeFromCMakeCache)(cache), 'Debug');
    const cacheRel = 'CMAKE_BUILD_TYPE:STRING=Release';
    strict_1.default.equal((0, debugConfig_1.parseBuildTypeFromCMakeCache)(cacheRel), 'Release');
    // 多配置生成器：值为空
    strict_1.default.equal((0, debugConfig_1.parseBuildTypeFromCMakeCache)('CMAKE_BUILD_TYPE:STRING='), '');
    // 不存在该行
    strict_1.default.equal((0, debugConfig_1.parseBuildTypeFromCMakeCache)('CMAKE_GENERATOR:INTERNAL=Ninja'), undefined);
});
(0, node_test_1.test)('可调试构建类型判定：Debug/RelWithDebInfo 可调试，Release/MinSizeRel 不可', () => {
    strict_1.default.equal((0, debugConfig_1.isDebuggableBuildType)('Debug'), true);
    strict_1.default.equal((0, debugConfig_1.isDebuggableBuildType)('RelWithDebInfo'), true);
    strict_1.default.equal((0, debugConfig_1.isDebuggableBuildType)('Release'), false);
    strict_1.default.equal((0, debugConfig_1.isDebuggableBuildType)('MinSizeRel'), false);
    // 未知/多配置（空）不阻止调试
    strict_1.default.equal((0, debugConfig_1.isDebuggableBuildType)(undefined), true);
    strict_1.default.equal((0, debugConfig_1.isDebuggableBuildType)(''), true);
});
// ---------- 调试工具检测：可选组件 ----------
/** 与 toolchainDetector.test 相同结构的可编程假检测环境 */
function fakeEnv(opts) {
    const existing = new Set(opts.existing ?? []);
    for (const paths of Object.values(opts.pathResults ?? {})) {
        for (const p of paths) {
            existing.add(p);
        }
    }
    const cltRoots = opts.cltRoots ?? [];
    for (const r of cltRoots) {
        existing.add(r);
        existing.add(path.dirname(r));
    }
    return {
        async pathLookup(name) {
            return opts.pathResults?.[name] ?? [];
        },
        async exists(p) {
            return existing.has(p);
        },
        async listDirs(dir) {
            const names = [];
            for (const r of cltRoots) {
                if (path.dirname(r) === dir) {
                    names.push(path.basename(r));
                }
            }
            return names;
        },
        async runVersion(file, _args, regex) {
            const output = opts.versions?.[file];
            if (output) {
                const m = regex.exec(output);
                if (m) {
                    return { ok: true, version: m[1] };
                }
                return { ok: false, error: '版本命令输出与预期正则不匹配' };
            }
            return { ok: false, error: '版本命令执行失败 (退出码 1)' };
        },
    };
}
const CLT = 'C:\\ST\\STM32CubeCLT_1.16.0';
const GDB = path.join(CLT, 'GNU-tools-for-STM32', 'bin', 'arm-none-eabi-gdb.exe');
const GDBSVR = path.join(CLT, 'STM32CubeProgrammer', 'bin', 'ST-LINK_gdbserver.exe');
const GCC = path.join(CLT, 'GNU-tools-for-STM32', 'bin', 'arm-none-eabi-gcc.exe');
const GPP = path.join(CLT, 'GNU-tools-for-STM32', 'bin', 'arm-none-eabi-g++.exe');
const OBJCOPY = path.join(CLT, 'GNU-tools-for-STM32', 'bin', 'arm-none-eabi-objcopy.exe');
const SIZE = path.join(CLT, 'GNU-tools-for-STM32', 'bin', 'arm-none-eabi-size.exe');
const CMAKE = path.join(CLT, 'CMake', 'bin', 'cmake.exe');
const NINJA = path.join(CLT, 'Ninja', 'bin', 'ninja.exe');
const CLI = path.join(CLT, 'STM32CubeProgrammer', 'bin', 'STM32_Programmer_CLI.exe');
const FULL_VERSIONS = {
    [CMAKE]: 'cmake version 3.28.1',
    [NINJA]: '1.11.1',
    [GCC]: 'arm-none-eabi-gcc (GNU Arm Embedded) 13.2.0',
    [GPP]: 'arm-none-eabi-g++ (GNU Arm Embedded) 13.2.0',
    [OBJCOPY]: 'GNU objcopy 2.41.0',
    [SIZE]: 'GNU size 2.41.0',
    [CLI]: 'STM32CubeProgrammer v2.17.0',
    [GDB]: 'GNU gdb (GNU Arm Embedded Toolchain 13.3.Rel1) 13.3.1 20240705-git',
    [GDBSVR]: 'ST-LINK GDB Server version 2.1.0',
};
(0, node_test_1.test)('调试工具找到：gdb 与 GDB Server 从 CubeCLT 目录识别并确认版本', async () => {
    const env = fakeEnv({
        cltRoots: [CLT],
        existing: [GDB, GDBSVR, GCC, GPP, OBJCOPY, SIZE, CMAKE, NINJA, CLI],
        versions: FULL_VERSIONS,
    });
    const tc = await (0, toolchainDetector_1.detectToolchain)(env);
    strict_1.default.equal(tc.tools.armGdb.found, true);
    strict_1.default.equal(tc.tools.armGdb.version, '13.3.1');
    strict_1.default.equal(tc.tools.stlinkGdbServer.found, true);
    strict_1.default.equal(tc.tools.stlinkGdbServer.version, '2.1.0');
    strict_1.default.equal(tc.tools.stlinkGdbServer.path, GDBSVR);
});
(0, node_test_1.test)('调试工具缺失不影响环境完整性：complete=true 且不出现在 missing', async () => {
    const env = fakeEnv({
        cltRoots: [CLT],
        existing: [GCC, GPP, OBJCOPY, SIZE, CMAKE, NINJA, CLI],
        versions: FULL_VERSIONS,
    });
    const tc = await (0, toolchainDetector_1.detectToolchain)(env);
    strict_1.default.equal(tc.complete, true);
    strict_1.default.deepEqual(tc.missing, []);
    strict_1.default.equal(tc.tools.armGdb.found, false, '调试工具缺失只影响调试功能');
});
(0, node_test_1.test)('armToolchainPath 目录形式同时推导 gdb 路径', () => {
    const s = (0, toolchainDetector_1.resolveArmToolchainSetting)('C:\\ARM\\bin');
    strict_1.default.equal(s.armGdb, 'C:\\ARM\\bin\\arm-none-eabi-gdb.exe');
    const s2 = (0, toolchainDetector_1.resolveArmToolchainSetting)('C:\\ARM\\bin\\arm-none-eabi-gcc.exe');
    strict_1.default.equal(s2.armGdb, 'C:\\ARM\\bin\\arm-none-eabi-gdb.exe');
});
//# sourceMappingURL=debugConfig.test.js.map