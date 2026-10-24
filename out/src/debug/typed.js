"use strict";
/**
 * 类型化取值解码（变量监控用）：uint/int 8-64 位（小端）、float/double、hex。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TYPE_TABLE = void 0;
exports.splitTypeSuffix = splitTypeSuffix;
exports.kindByBytes = kindByBytes;
exports.decodeTyped = decodeTyped;
/** 支持的类型名 → 解码方式（全部小写匹配） */
exports.TYPE_TABLE = {
    'uint8_t': { kind: 'u8', bytes: 1, label: 'uint8_t' },
    uint8: { kind: 'u8', bytes: 1, label: 'uint8_t' },
    u8: { kind: 'u8', bytes: 1, label: 'uint8_t' },
    'uint16_t': { kind: 'u16', bytes: 2, label: 'uint16_t' },
    uint16: { kind: 'u16', bytes: 2, label: 'uint16_t' },
    u16: { kind: 'u16', bytes: 2, label: 'uint16_t' },
    'uint32_t': { kind: 'u32', bytes: 4, label: 'uint32_t' },
    uint32: { kind: 'u32', bytes: 4, label: 'uint32_t' },
    u32: { kind: 'u32', bytes: 4, label: 'uint32_t' },
    'uint64_t': { kind: 'u64', bytes: 8, label: 'uint64_t' },
    uint64: { kind: 'u64', bytes: 8, label: 'uint64_t' },
    u64: { kind: 'u64', bytes: 8, label: 'uint64_t' },
    'int8_t': { kind: 'i8', bytes: 1, label: 'int8_t' },
    int8: { kind: 'i8', bytes: 1, label: 'int8_t' },
    i8: { kind: 'i8', bytes: 1, label: 'int8_t' },
    'int16_t': { kind: 'i16', bytes: 2, label: 'int16_t' },
    int16: { kind: 'i16', bytes: 2, label: 'int16_t' },
    i16: { kind: 'i16', bytes: 2, label: 'int16_t' },
    'int32_t': { kind: 'i32', bytes: 4, label: 'int32_t' },
    int32: { kind: 'i32', bytes: 4, label: 'int32_t' },
    i32: { kind: 'i32', bytes: 4, label: 'int32_t' },
    'int64_t': { kind: 'i64', bytes: 8, label: 'int64_t' },
    int64: { kind: 'i64', bytes: 8, label: 'int64_t' },
    i64: { kind: 'i64', bytes: 8, label: 'int64_t' },
    float: { kind: 'f32', bytes: 4, label: 'float' },
    float32: { kind: 'f32', bytes: 4, label: 'float' },
    f32: { kind: 'f32', bytes: 4, label: 'float' },
    double: { kind: 'f64', bytes: 8, label: 'double' },
    float64: { kind: 'f64', bytes: 8, label: 'double' },
    f64: { kind: 'f64', bytes: 8, label: 'double' },
};
/** 解析 “:类型” 后缀（如 led:uint32_t → { name: 'led', spec }）；无类型返回 undefined */
function splitTypeSuffix(input) {
    const idx = input.lastIndexOf(':');
    if (idx <= 0) {
        return { name: input.trim() };
    }
    const spec = exports.TYPE_TABLE[input.slice(idx + 1).trim().toLowerCase()];
    if (!spec) {
        return { name: input.trim() };
    }
    return { name: input.slice(0, idx).trim(), spec };
}
/** 按字节大小推测整数解码（符号表无类型信息时用） */
function kindByBytes(bytes) {
    switch (bytes) {
        case 1: return 'u8';
        case 2: return 'u16';
        case 8: return 'u64';
        default: return 'u32';
    }
}
/** 小端解码为展示字符串（十进制 / 浮点 / hex） */
function decodeTyped(buf, kind) {
    if (buf.length < 1) {
        return '—';
    }
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    switch (kind) {
        case 'u8': return String(dv.getUint8(0));
        case 'u16': return String(dv.getUint16(0, true));
        case 'u32': return String(dv.getUint32(0, true));
        case 'u64': return dv.getBigUint64(0, true).toString();
        case 'i8': return String(dv.getInt8(0));
        case 'i16': return String(dv.getInt16(0, true));
        case 'i32': return String(dv.getInt32(0, true));
        case 'i64': return dv.getBigInt64(0, true).toString();
        case 'f32': return (Math.round(dv.getFloat32(0, true) * 1e6) / 1e6).toString();
        case 'f64': return (Math.round(dv.getFloat64(0, true) * 1e9) / 1e9).toString();
        default: {
            let hex = '';
            for (let i = buf.length - 1; i >= 0; i--) {
                hex += buf[i].toString(16).padStart(2, '0');
            }
            return '0x' + hex.toUpperCase();
        }
    }
}
//# sourceMappingURL=typed.js.map