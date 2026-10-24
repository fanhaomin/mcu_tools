"use strict";
/**
 * 构建产物识别与烧录前置条件检查。
 *
 * 核心安全规则：
 * - 每次构建生成独立的 BuildRecord（成功/失败、时间戳），持久化到插件构建目录。
 * - 烧录前必须确认：最近一次构建成功、产物 mtime 晚于本次构建开始时间，
 *   否则视为“旧固件”，默认阻止烧录。
 * - BIN 文件必须确认烧录地址（无重定位信息，烧错地址会变砖/写飞）。
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
exports.FRESHNESS_TOLERANCE_MS = exports.BUILD_STATE_FILE = void 0;
exports.findArtifacts = findArtifacts;
exports.selectFirmware = selectFirmware;
exports.isValidHexAddress = isValidHexAddress;
exports.isArtifactFresh = isArtifactFresh;
exports.checkFlashPreconditions = checkFlashPreconditions;
exports.readPersistedState = readPersistedState;
exports.writePersistedState = writePersistedState;
const path = __importStar(require("path"));
const path_1 = require("../util/path");
exports.BUILD_STATE_FILE = 'buildstate.json';
/** mtime 与构建开始时间比较的容差（毫秒），容忍文件系统时间粒度误差 */
exports.FRESHNESS_TOLERANCE_MS = 2000;
/** 递归查找构建目录中的固件产物（跳过 CMakeFiles 内部） */
async function findArtifacts(dir, maxDepth = 3) {
    const found = [];
    await (0, path_1.walk)(dir, async (p) => {
        const ext = path.extname(p).toLowerCase().slice(1);
        if (ext !== 'elf' && ext !== 'hex' && ext !== 'bin') {
            return;
        }
        const st = await (0, path_1.statSafe)(p);
        if (!st || !st.isFile()) {
            return;
        }
        found.push({
            path: p,
            format: ext,
            mtimeMs: st.mtimeMs,
            sizeBytes: st.size,
        });
    }, { depth: maxDepth, skipDirs: [/^CMakeFiles$/i] });
    return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
/**
 * 按格式偏好选择烧录文件。默认 ELF > HEX > BIN。
 * ELF 含调试信息与加载地址，最可靠；HEX 自带地址；BIN 需要额外地址。
 */
function selectFirmware(artifacts, preference = ['elf', 'hex', 'bin']) {
    for (const fmt of preference) {
        const hit = artifacts.find((a) => a.format === fmt);
        if (hit) {
            return hit;
        }
    }
    return undefined;
}
/** 校验十六进制烧录地址，如 0x08000000 */
function isValidHexAddress(v) {
    if (!v) {
        return false;
    }
    const m = /^0x[0-9a-f]{1,8}$/i.exec(v.trim());
    if (!m) {
        return false;
    }
    const n = parseInt(v.trim(), 16);
    return Number.isFinite(n) && n > 0 && n <= 0xffffffff;
}
/**
 * 产物是否属于本次构建。
 * 两种情况视为新鲜：
 * 1. mtime 不早于构建开始时间（本次构建实际生成/更新了该文件）；
 * 2. 构建记录本身就指向该文件（Ninja 判定"无需重做"时不会重写 ELF，
 *    但构建成功即表示该 ELF 与本次源码状态一致，属于本次构建的产物）。
 */
function isArtifactFresh(a, rec) {
    if (a.mtimeMs >= rec.startedAt - exports.FRESHNESS_TOLERANCE_MS) {
        return true;
    }
    if (rec.success && rec.elfPath && pathsSame(a.path, rec.elfPath)) {
        return true;
    }
    return false;
}
function pathsSame(a, b) {
    const norm = (p) => p.replace(/\//g, '\\').toLowerCase();
    return norm(path.resolve(a)) === norm(path.resolve(b));
}
function checkFlashPreconditions(input) {
    const requireFresh = input.requireFreshBuild ?? true;
    const blockers = [];
    const warnings = [];
    const pre = { ok: false, blockers, warnings, stale: false };
    // 1. 编译门禁：防止编译失败后误烧旧固件
    if (requireFresh) {
        if (!input.lastBuild) {
            blockers.push('尚未执行过编译，没有本次构建记录。请先执行“编译工程”。');
        }
        else if (!input.lastBuild.success) {
            blockers.push(`最近一次编译失败（${new Date(input.lastBuild.endedAt).toLocaleString()}），` +
                '已阻止烧录，避免误烧上一次生成的旧固件。请修复编译错误后重试。');
        }
    }
    else if (input.lastBuild && !input.lastBuild.success) {
        warnings.push('注意: 最近一次编译失败，即将烧录的文件不是最近一次构建的产物。');
    }
    // 2. 产物存在性
    if (input.artifacts.length === 0) {
        blockers.push('未找到任何固件产物（.elf/.hex/.bin）。请先成功编译工程。');
        return finish();
    }
    // 3. 选择产物（调用方显式指定时以调用方为准，如按目标名选择的固件）
    const artifact = input.artifact ?? selectFirmware(input.artifacts);
    if (!artifact) {
        blockers.push('固件产物格式无法识别。');
        return finish();
    }
    pre.artifact = artifact;
    // 4. 新鲜度检查：产物必须晚于本次构建开始时间
    if (requireFresh) {
        if (!input.lastBuild) {
            pre.stale = true;
        }
        else if (!isArtifactFresh(artifact, input.lastBuild)) {
            pre.stale = true;
            blockers.push(`选中的固件 ${path.basename(artifact.path)} 的修改时间早于最近一次成功构建的开始时间，` +
                '属于旧产物，已阻止烧录。');
        }
    }
    else {
        if (input.lastBuild && input.lastBuild.success && isArtifactFresh(artifact, input.lastBuild)) {
            // 正常
        }
        else {
            pre.stale = true;
            warnings.push(`即将烧录的 ${path.basename(artifact.path)} 不是最近一次成功构建的产物，请自行确认其来源。`);
        }
    }
    // 5. BIN 地址门禁
    if (artifact.format === 'bin') {
        if (!isValidHexAddress(input.binAddress)) {
            blockers.push('烧录 BIN 文件必须先确认烧录地址（BIN 不含地址信息）。' +
                '请在设置 autoCmakeFlash.binFlashAddress 中配置，或在弹出的输入框中输入（如 0x08000000）。');
        }
        else {
            pre.binAddress = input.binAddress.trim();
        }
    }
    // 6. 芯片型号门禁：型号不确定时禁止烧录
    if (!input.mcu.confirmedByUser && !input.mcu.base) {
        blockers.push('芯片型号待确认（证据不足），无法安全烧录。请执行“手动选择芯片型号”或补充工程信息后重新扫描。');
    }
    else if (!input.mcu.confirmedByUser && input.mcu.confidence === 'low' && input.mcu.model) {
        warnings.push(`芯片型号 ${input.mcu.model} 可信度较低，请在确认窗口中核对。`);
    }
    return finish();
    function finish() {
        pre.ok = blockers.length === 0;
        return pre;
    }
}
/** 读取构建目录中的持久化状态（同时作为“插件创建目录”的标记） */
async function readPersistedState(buildDir) {
    const raw = await (0, path_1.readTextFile)(path.join(buildDir, exports.BUILD_STATE_FILE), 256 * 1024);
    if (!raw) {
        return undefined;
    }
    try {
        const obj = JSON.parse(raw);
        if (obj && obj.version === 1) {
            return obj;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
async function writePersistedState(buildDir, state) {
    const err = await (0, path_1.ensureDir)(buildDir);
    if (err) {
        return;
    }
    try {
        await fsWriteFile(path.join(buildDir, exports.BUILD_STATE_FILE), JSON.stringify(state, null, 2));
    }
    catch {
        /* 写状态文件失败不应中断主流程 */
    }
}
const fsMod = __importStar(require("fs"));
function fsWriteFile(p, data) {
    return fsMod.promises.writeFile(p, data, 'utf8');
}
//# sourceMappingURL=artifacts.js.map