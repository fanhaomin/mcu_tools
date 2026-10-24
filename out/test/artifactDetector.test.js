"use strict";
/**
 * 构建产物与烧录门禁测试：
 * ELF/HEX/BIN 识别与选择、新鲜度判定、BIN 地址校验、
 * 编译失败阻止烧录、型号不确定阻止烧录。
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
const artifacts_1 = require("../src/cmake/artifacts");
const types_1 = require("../src/types");
const fixtures_1 = require("./helpers/fixtures");
const NOW = Date.now();
function freshRecord(success, startedAt = NOW - 10_000) {
    return {
        id: 'b-test',
        root: 'C:\\proj',
        buildDir: 'C:\\proj\\cmake-build-debug',
        buildType: 'Debug',
        success,
        exitCode: success ? 0 : 1,
        startedAt,
        endedAt: NOW - 5_000,
        durationMs: 5_000,
    };
}
function artifact(fmt, mtimeMs, name = `firmware.${fmt}`) {
    return { path: `C:\\proj\\cmake-build-debug\\${name}`, format: fmt, mtimeMs, sizeBytes: 1024 };
}
(0, node_test_1.test)('ELF/HEX/BIN 文件识别：从构建目录真实扫描', async () => {
    const tmp = (0, fixtures_1.makeTempDir)();
    try {
        (0, fixtures_1.write)(tmp, 'CMakeFiles/scratch/main.elf', 'x');
        const elf = (0, fixtures_1.write)(tmp, 'project.elf', 'elf');
        const hex = (0, fixtures_1.write)(tmp, 'project.hex', 'hex');
        const bin = (0, fixtures_1.write)(tmp, 'out/project.bin', 'bin');
        (0, fixtures_1.utime)(elf, NOW - 60_000);
        (0, fixtures_1.utime)(hex, NOW - 30_000);
        (0, fixtures_1.utime)(bin, NOW);
        const found = await (0, artifacts_1.findArtifacts)(tmp);
        strict_1.default.equal(found.length, 3, 'CMakeFiles 内的文件不应计入');
        const formats = new Set(found.map((f) => f.format));
        strict_1.default.deepEqual([...formats].sort(), ['bin', 'elf', 'hex']);
        // 默认按 mtime 降序
        strict_1.default.equal(found[0].path.toLowerCase(), bin.toLowerCase());
    }
    finally {
        (0, fixtures_1.cleanup)(tmp);
    }
});
(0, node_test_1.test)('产物选择：优先 ELF > HEX > BIN', () => {
    const elf = artifact('elf', NOW);
    const hex = artifact('hex', NOW);
    const bin = artifact('bin', NOW);
    strict_1.default.equal((0, artifacts_1.selectFirmware)([bin, hex, elf]), elf);
    strict_1.default.equal((0, artifacts_1.selectFirmware)([bin, hex]), hex);
    strict_1.default.equal((0, artifacts_1.selectFirmware)([bin]), bin);
    strict_1.default.equal((0, artifacts_1.selectFirmware)([]), undefined);
});
(0, node_test_1.test)('HEX 地址校验函数', () => {
    strict_1.default.equal((0, artifacts_1.isValidHexAddress)('0x08000000'), true);
    strict_1.default.equal((0, artifacts_1.isValidHexAddress)('0x8000000'), true);
    strict_1.default.equal((0, artifacts_1.isValidHexAddress)('0X0800FF00'), true);
    strict_1.default.equal((0, artifacts_1.isValidHexAddress)('08000000'), false, '缺少 0x 前缀');
    strict_1.default.equal((0, artifacts_1.isValidHexAddress)('0xZZZZ'), false);
    strict_1.default.equal((0, artifacts_1.isValidHexAddress)(''), false);
    strict_1.default.equal((0, artifacts_1.isValidHexAddress)(undefined), false);
});
(0, node_test_1.test)('烧录门禁：编译失败时阻止烧录（防误烧旧固件）', () => {
    const pre = (0, artifacts_1.checkFlashPreconditions)({
        lastBuild: freshRecord(false),
        artifacts: [artifact('elf', NOW)],
        mcu: { ...(0, types_1.unknownMcu)(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' },
    });
    strict_1.default.equal(pre.ok, false);
    strict_1.default.ok(pre.blockers.some((b) => b.includes('编译失败')));
    strict_1.default.ok(pre.blockers.some((b) => b.includes('旧固件')));
});
(0, node_test_1.test)('烧录门禁：从未编译过时阻止烧录', () => {
    const pre = (0, artifacts_1.checkFlashPreconditions)({
        artifacts: [artifact('elf', NOW)],
        mcu: { ...(0, types_1.unknownMcu)(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' },
    });
    strict_1.default.equal(pre.ok, false);
    strict_1.default.ok(pre.blockers.some((b) => b.includes('尚未执行过编译')));
});
(0, node_test_1.test)('烧录门禁：产物早于构建开始时间视为旧产物并阻止', () => {
    const rec = freshRecord(true);
    const stale = artifact('elf', rec.startedAt - 60_000);
    const pre = (0, artifacts_1.checkFlashPreconditions)({
        lastBuild: rec,
        artifacts: [stale],
        mcu: { ...(0, types_1.unknownMcu)(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' },
    });
    strict_1.default.equal(pre.ok, false);
    strict_1.default.equal(pre.stale, true);
    strict_1.default.ok(pre.blockers.some((b) => b.includes('旧产物')));
    // 构建期间生成的新产物应通过
    const fresh = artifact('elf', rec.startedAt + 1_000);
    const pre2 = (0, artifacts_1.checkFlashPreconditions)({
        lastBuild: rec,
        artifacts: [fresh],
        mcu: { ...(0, types_1.unknownMcu)(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' },
    });
    strict_1.default.equal(pre2.ok, true);
    strict_1.default.equal(pre2.stale, false);
    // Ninja "无需重做" 场景：ELF 未被重写（mtime 仍为旧值），
    // 但构建记录本身指向该 ELF —— 视为本次构建的产物
    const unchangedElf = artifact('elf', rec.startedAt - 60_000, 'firmware.elf');
    const recPointingAtIt = { ...rec, elfPath: unchangedElf.path, elfMtimeMs: unchangedElf.mtimeMs };
    const pre3 = (0, artifacts_1.checkFlashPreconditions)({
        lastBuild: recPointingAtIt,
        artifacts: [unchangedElf],
        mcu: { ...(0, types_1.unknownMcu)(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' },
    });
    strict_1.default.equal(pre3.ok, true, '构建记录指向的 ELF 应视为本次构建产物');
    strict_1.default.equal(pre3.stale, false);
});
(0, node_test_1.test)('烧录门禁：芯片型号待确认时阻止烧录', () => {
    const rec = freshRecord(true);
    const pre = (0, artifacts_1.checkFlashPreconditions)({
        lastBuild: rec,
        artifacts: [artifact('elf', NOW)],
        mcu: { ...(0, types_1.unknownMcu)(), family: 'STM32L4' }, // 只有家族级证据
    });
    strict_1.default.equal(pre.ok, false);
    strict_1.default.ok(pre.blockers.some((b) => b.includes('芯片型号待确认')));
    // 用户确认家族级型号后允许（确认窗口仍会展示）
    const pre2 = (0, artifacts_1.checkFlashPreconditions)({
        lastBuild: rec,
        artifacts: [artifact('elf', NOW)],
        mcu: { ...(0, types_1.unknownMcu)(), family: 'STM32L4', confirmedByUser: true, base: 'STM32L431', model: 'STM32L431xx', macro: 'STM32L431xx' },
    });
    strict_1.default.equal(pre2.ok, true);
});
(0, node_test_1.test)('烧录门禁：BIN 文件必须确认地址', () => {
    const mcu = { ...(0, types_1.unknownMcu)(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' };
    const rec = freshRecord(true);
    const noAddr = (0, artifacts_1.checkFlashPreconditions)({
        lastBuild: rec,
        artifacts: [artifact('bin', NOW)],
        mcu,
    });
    strict_1.default.equal(noAddr.ok, false);
    strict_1.default.ok(noAddr.blockers.some((b) => b.includes('BIN')));
    const badAddr = (0, artifacts_1.checkFlashPreconditions)({
        lastBuild: rec,
        artifacts: [artifact('bin', NOW)],
        mcu,
        binAddress: 'not-an-address',
    });
    strict_1.default.equal(badAddr.ok, false);
    const okAddr = (0, artifacts_1.checkFlashPreconditions)({
        lastBuild: rec,
        artifacts: [artifact('bin', NOW)],
        mcu,
        binAddress: '0x08000000',
    });
    strict_1.default.equal(okAddr.ok, true);
    strict_1.default.equal(okAddr.binAddress, '0x08000000');
    // ELF 不需要地址
    const elfPre = (0, artifacts_1.checkFlashPreconditions)({
        lastBuild: rec,
        artifacts: [artifact('elf', NOW)],
        mcu,
    });
    strict_1.default.equal(elfPre.ok, true);
    strict_1.default.equal(elfPre.binAddress, undefined);
});
(0, node_test_1.test)('烧录现有固件模式（requireFreshBuild=false）：产物可用但标记 stale', () => {
    const mcu = { ...(0, types_1.unknownMcu)(), base: 'STM32G431', model: 'STM32G431RBTx', family: 'STM32G4', macro: 'STM32G431xx' };
    const old = artifact('hex', NOW - 3_600_000, 'release.hex');
    const pre = (0, artifacts_1.checkFlashPreconditions)({
        artifacts: [old],
        mcu,
        requireFreshBuild: false,
    });
    strict_1.default.equal(pre.ok, true, '显式烧录现有固件不要求构建记录');
    strict_1.default.equal(pre.stale, true, '但必须标记为非本次构建产物');
    strict_1.default.ok(pre.warnings.some((w) => w.includes('不是最近一次成功构建的产物')));
});
(0, node_test_1.test)('构建状态持久化：写入后可读回（含上次构建记录）', async () => {
    const tmp = (0, fixtures_1.makeTempDir)();
    try {
        const before = await (0, artifacts_1.readPersistedState)(tmp);
        strict_1.default.equal(before, undefined, '尚无状态文件');
        const rec = freshRecord(true);
        await (0, artifacts_1.writePersistedState)(tmp, { version: 1, createdByAutoCmakeFlash: true, lastBuild: rec });
        const after = await (0, artifacts_1.readPersistedState)(tmp);
        strict_1.default.ok(after);
        strict_1.default.equal(after.createdByAutoCmakeFlash, true);
        strict_1.default.equal(after.lastBuild.id, 'b-test');
        strict_1.default.equal(path.basename(after?.lastBuild.buildDir ?? ''), 'cmake-build-debug');
    }
    finally {
        (0, fixtures_1.cleanup)(tmp);
    }
});
(0, node_test_1.test)('BUILD_STATE_FILE 位于构建目录根部', () => {
    strict_1.default.equal(artifacts_1.BUILD_STATE_FILE, 'buildstate.json');
});
(0, node_test_1.test)('配置判定：只有 CMakeCache 而无 build.ninja 时不得视为已配置（防跳过配置直接编译）', async () => {
    const { isConfigured, readCMakeCacheInfo } = await Promise.resolve().then(() => __importStar(require('../src/cmake/build')));
    const tmp = (0, fixtures_1.makeTempDir)();
    try {
        // 尚未配置
        strict_1.default.equal(await isConfigured(tmp), false);
        // 失败的 configure：残留 CMakeCache.txt（含生成器）但没有 build.ninja
        (0, fixtures_1.write)(tmp, 'CMakeCache.txt', 'CMAKE_GENERATOR:INTERNAL=Ninja\nCMAKE_BUILD_TYPE:STRING=Debug');
        const info = await readCMakeCacheInfo(tmp);
        strict_1.default.equal(info.generator, 'Ninja');
        strict_1.default.equal(await isConfigured(tmp), false, '缺少 build.ninja 必须重新配置');
        // 完成配置后
        (0, fixtures_1.write)(tmp, 'build.ninja', '# generated');
        strict_1.default.equal(await isConfigured(tmp), true);
        // Makefile 生成器同理
        const tmp2 = (0, fixtures_1.makeTempDir)();
        try {
            (0, fixtures_1.write)(tmp2, 'CMakeCache.txt', 'CMAKE_GENERATOR:INTERNAL=MinGW Makefiles');
            strict_1.default.equal(await isConfigured(tmp2), false);
            (0, fixtures_1.write)(tmp2, 'Makefile', '# generated');
            strict_1.default.equal(await isConfigured(tmp2), true);
        }
        finally {
            (0, fixtures_1.cleanup)(tmp2);
        }
    }
    finally {
        (0, fixtures_1.cleanup)(tmp);
    }
});
//# sourceMappingURL=artifactDetector.test.js.map