"use strict";
/**
 * STM32 芯片型号识别与证据聚合。
 *
 * 设计原则：
 * - 芯片型号由多条证据加权聚合得出，绝不只凭文件夹名称判断。
 * - 家族级证据（如 Drivers/STM32G4xx_HAL_Driver）只能确定家族，
 *   不能得出精确型号；此时 model/base 为空，界面显示“芯片型号待确认”。
 * - 证据冲突（不同型号）会降级可信度并输出警告。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVIDENCE_WEIGHTS = void 0;
exports.parseChipToken = parseChipToken;
exports.extractChipTokens = extractChipTokens;
exports.familyFromHalDir = familyFromHalDir;
exports.confidenceText = confidenceText;
exports.combineEvidence = combineEvidence;
exports.describeMcu = describeMcu;
exports.familyCpuFlags = familyCpuFlags;
const types_1 = require("../types");
const FAMILIES = [
    'STM32C0', 'STM32F0', 'STM32F1', 'STM32F2', 'STM32F3', 'STM32F4', 'STM32F7',
    'STM32G0', 'STM32G4', 'STM32H5', 'STM32H7',
    'STM32L0', 'STM32L1', 'STM32L4', 'STM32L5',
    'STM32U0', 'STM32U5',
    'STM32WB', 'STM32WL', 'STM32MP1',
];
/**
 * 从任意文本片段解析 STM32 芯片型号。
 * 匹配 STM32 前缀 + 已知家族 + 后续行号/封装字符。
 */
function parseChipToken(token) {
    const upper = token.toUpperCase();
    let family;
    let restStart = -1;
    for (const fam of FAMILIES) {
        if (upper.startsWith(fam)) {
            family = fam;
            restStart = fam.length;
            break;
        }
    }
    if (!family) {
        return undefined;
    }
    // 家族后的部分：取 [0-9A-Z_xX] 组成的连续段作为行号+封装描述
    let rest = '';
    for (let i = restStart; i < upper.length; i++) {
        const ch = upper[i];
        if (/[0-9A-Z]/.test(ch)) {
            rest += ch;
        }
        else {
            break;
        }
    }
    if (!rest) {
        return undefined;
    }
    // 基础型号 = 家族 + 2~3 位数字行号（G431 / F407 / H743 / WB55）。
    // 仅含通配符（如 STM32G4xx）或无数字行号（如 H7A3）时退化为家族级：base = family，
    // 此时不能当作精确型号参与烧录门禁。
    const noWildcard = rest.replace(/X+$/, '');
    const digits = /^(\d{2,3})/.exec(noWildcard) ?? /^(\d{2,3})/.exec(rest);
    const base = digits ? family + digits[1] : family;
    const raw = family + rest;
    return { raw, base, family, macro: `${base}xx` };
}
/** 从文本中提取全部芯片型号 token（宏定义、型号字符串等） */
function extractChipTokens(text) {
    const results = [];
    const seen = new Set();
    const re = /STM32[A-Z0-9_]{3,20}/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
        const chip = parseChipToken(m[0]);
        if (chip && !seen.has(chip.base + '|' + chip.raw)) {
            seen.add(chip.base + '|' + chip.raw);
            results.push(chip);
        }
        if (m.index === re.lastIndex) {
            re.lastIndex++;
        }
    }
    return results;
}
/** 从 HAL 驱动目录名提取家族：STM32G4xx_HAL_Driver -> STM32G4 */
function familyFromHalDir(dirName) {
    const m = /^STM32(WB|WL|MP1|[A-Z]\d{1,2})xx_HAL_Driver$/i.exec(dirName);
    if (!m) {
        return undefined;
    }
    return 'STM32' + m[1].toUpperCase();
}
/** 各证据来源权重（同一来源对同一基础型号只计一次，取最大权重） */
exports.EVIDENCE_WEIGHTS = {
    ioc: 5,
    compileDefine: 4,
    cmakeCache: 4,
    toolchainFile: 4,
    linkerScript: 3,
    startupFile: 3,
    cmakeLists: 2,
    halDriver: 1,
    userSelection: 5,
};
function confidenceLabel(conf) {
    switch (conf) {
        case 'high':
            return '高';
        case 'medium':
            return '中';
        case 'low':
            return '低';
        default:
            return '无法判断';
    }
}
function confidenceText(conf) {
    return confidenceLabel(conf);
}
function familyOf(base) {
    for (const fam of FAMILIES) {
        if (base.startsWith(fam)) {
            return fam;
        }
    }
    return base.replace(/\d+$/, '');
}
/**
 * 聚合证据得到芯片型号结论。
 * - userSelectedModel: 用户手动选择的型号（最高优先级）。
 */
function combineEvidence(evidence, userSelectedModel) {
    if (userSelectedModel) {
        const chip = parseChipToken(userSelectedModel);
        if (chip) {
            return {
                model: chip.raw,
                base: chip.base,
                family: chip.family,
                macro: chip.macro,
                confidence: 'high',
                confirmedByUser: true,
                evidence: [
                    ...evidence,
                    {
                        source: 'userSelection',
                        detail: `用户手动确认型号 ${chip.raw}`,
                        model: chip.raw,
                        base: chip.base,
                        family: chip.family,
                        weight: exports.EVIDENCE_WEIGHTS.userSelection,
                    },
                ],
                warnings: [],
            };
        }
    }
    const mcu = (0, types_1.unknownMcu)();
    mcu.evidence = evidence;
    if (evidence.length === 0) {
        return mcu;
    }
    // 家族证据
    const familyScores = new Map();
    for (const ev of evidence) {
        if (ev.family) {
            familyScores.set(ev.family, (familyScores.get(ev.family) ?? 0) + ev.weight);
        }
    }
    // 精确型号证据：按 base 聚合，同一来源只取最大权重。
    // base === family 的证据（如 -DSTM32G4xx、STM32G4xx.ld）是家族级证据，
    // 不得当作精确型号，只计入家族得分。
    const byBase = new Map();
    for (const ev of evidence) {
        if (!ev.base || (ev.family && ev.base === ev.family)) {
            continue;
        }
        const cur = byBase.get(ev.base);
        if (!cur) {
            byBase.set(ev.base, { score: ev.weight, sources: new Set([ev.source]), sample: ev });
        }
        else if (!cur.sources.has(ev.source)) {
            cur.sources.add(ev.source);
            cur.score += ev.weight;
            if (ev.model && (!cur.sample.model || ev.model.length >= cur.sample.model.length)) {
                cur.sample = ev;
            }
        }
    }
    const sorted = [...byBase.entries()].sort((a, b) => b[1].score - a[1].score);
    if (sorted.length > 0) {
        const [topBase, top] = sorted[0];
        mcu.base = topBase;
        mcu.model = top.sample.model ?? topBase;
        mcu.family = top.sample.family ?? familyOf(topBase);
        mcu.macro = `${topBase}xx`;
        let score = top.score;
        if (score >= 8) {
            mcu.confidence = 'high';
        }
        else if (score >= 5) {
            mcu.confidence = 'medium';
        }
        else {
            mcu.confidence = 'low';
        }
        // 证据冲突检查：第二名得分达到一半即视为存在竞争证据，封顶 medium 并警告
        if (sorted.length > 1 && sorted[1][1].score >= Math.max(3, Math.floor(score / 2))) {
            mcu.confidence = mcu.confidence === 'high' ? 'medium' : mcu.confidence;
            mcu.warnings.push(`存在多个候选型号: ${sorted.map(([b, v]) => `${b}(权重${v.score})`).join('、')}，请人工确认`);
        }
        return mcu;
    }
    // 无精确型号：只有家族级证据（例如仅有 HAL 驱动目录）
    const topFamily = [...familyScores.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topFamily) {
        mcu.family = topFamily[0];
        mcu.confidence = 'low';
        mcu.warnings.push('只有家族级证据，芯片型号待确认');
    }
    return mcu;
}
function describeMcu(mcu) {
    if (mcu.confirmedByUser) {
        return `${mcu.model}（用户已确认）`;
    }
    if (mcu.model) {
        return `${mcu.model}（可信度: ${confidenceLabel(mcu.confidence)}）`;
    }
    if (mcu.family) {
        return `芯片型号待确认（家族 ${mcu.family}，可信度: ${confidenceLabel(mcu.confidence)}）`;
    }
    return '未识别到 STM32 芯片';
}
/** STM32 家族 → 内核 编译选项（-mcpu），用于补齐缺失的 CPU 编译选项 */
const FAMILY_CPU = {
    STM32C0: '-mcpu=cortex-m0plus',
    STM32F0: '-mcpu=cortex-m0',
    STM32G0: '-mcpu=cortex-m0plus',
    STM32L0: '-mcpu=cortex-m0plus',
    STM32F1: '-mcpu=cortex-m3',
    STM32F2: '-mcpu=cortex-m3',
    STM32L1: '-mcpu=cortex-m3',
    STM32F3: '-mcpu=cortex-m4',
    STM32F4: '-mcpu=cortex-m4',
    STM32L4: '-mcpu=cortex-m4',
    STM32G4: '-mcpu=cortex-m4',
    STM32WB: '-mcpu=cortex-m4',
    STM32WL: '-mcpu=cortex-m4',
    STM32F7: '-mcpu=cortex-m7',
    STM32H7: '-mcpu=cortex-m7',
    STM32H5: '-mcpu=cortex-m33',
    STM32L5: '-mcpu=cortex-m33',
    STM32U5: '-mcpu=cortex-m33',
};
/**
 * 由家族推导 CPU 编译选项（-mcpu=xxx -mthumb）。
 * 用于自愈"工程未提供任何 -mcpu 选项"的 CubeMX/CLion 工程
 * （典型症状：selected processor does not support `wfe' in ARM mode）。
 * 未知家族（如 MP1 双核）返回 undefined，不盲目注入。
 */
function familyCpuFlags(family) {
    const cpu = FAMILY_CPU[family.toUpperCase()];
    return cpu ? `${cpu} -mthumb` : undefined;
}
//# sourceMappingURL=stm32Detector.js.map