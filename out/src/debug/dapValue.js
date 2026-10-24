"use strict";
/**
 * DAP 变量值/类型解析：DAP 的 value 形如 "(volatile uint16_t) 84" 或 "3.5"。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDapValue = parseDapValue;
exports.normalizeType = normalizeType;
exports.scalarNumber = scalarNumber;
const typed_1 = require("./typed");
/** 从 "(volatile uint32_t) 87" 解析类型与标量值 */
function parseDapValue(valueStr) {
    const s = String(valueStr ?? '').trim();
    const out = { scalar: s };
    const m = /^\(([^)]+)\)\s*(.*)$/.exec(s);
    if (!m) {
        return out;
    }
    const rawType = m[1]
        .replace(/\b(volatile|const|static)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    out.scalar = m[2].trim();
    const spec = normalizeType(rawType);
    if (spec) {
        out.typeLabel = spec.label;
        out.kind = spec.kind;
        out.bytes = spec.bytes;
    }
    return out;
}
/** 归一化 C 类型名（unsigned int → uint32_t 等），未知返回 undefined */
function normalizeType(rawType) {
    const t = rawType.toLowerCase().replace(/\s+/g, ' ').trim();
    const direct = typed_1.TYPE_TABLE[t];
    if (direct) {
        return direct;
    }
    const unsigned = /\bunsigned\b/.test(t);
    const m = /(?:^|\s)(char|short|int|long|long long)(?:\s|$)/.exec(t);
    if (!m) {
        return undefined;
    }
    const base = m[1];
    const sizeChars = (t.match(/long/g) || []).length;
    if (base === 'char') {
        return unsigned ? { kind: 'u8', bytes: 1, label: 'uint8_t' } : { kind: 'i8', bytes: 1, label: 'int8_t' };
    }
    if (base === 'short') {
        return unsigned ? { kind: 'u16', bytes: 2, label: 'uint16_t' } : { kind: 'i16', bytes: 2, label: 'int16_t' };
    }
    if (base === 'int') {
        return unsigned ? { kind: 'u32', bytes: 4, label: 'uint32_t' } : { kind: 'i32', bytes: 4, label: 'int32_t' };
    }
    // long / long long
    const bits = base === 'long long' || sizeChars >= 2 ? 64 : 32;
    if (bits === 64) {
        return unsigned ? { kind: 'u64', bytes: 8, label: 'uint64_t' } : { kind: 'i64', bytes: 8, label: 'int64_t' };
    }
    return unsigned ? { kind: 'u32', bytes: 4, label: 'uint32_t' } : { kind: 'i32', bytes: 4, label: 'int32_t' };
}
/** 从 DAP 标量值文本提取数值字面量（如 "87"、"-7"、"3.5"、"0x1 '\001'"） */
function scalarNumber(valueStr) {
    const hex = /-?0x[0-9a-fA-F]+/.exec(valueStr);
    if (hex) {
        const n = parseInt(hex[0], 16);
        return Number.isFinite(n) ? n : undefined;
    }
    const dec = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/i.exec(valueStr);
    if (dec) {
        const n = Number(dec[0]);
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}
//# sourceMappingURL=dapValue.js.map