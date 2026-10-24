"use strict";
/**
 * 内存 hexdump 格式化（纯函数）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatHexDump = formatHexDump;
exports.parseEvalHexAddress = parseEvalHexAddress;
exports.parseEvalInt = parseEvalInt;
const PER_ROW = 16;
function formatHexDump(data, baseAddr, perRow = PER_ROW) {
    const rows = [];
    const total = Math.max(data.length, 1);
    for (let off = 0; off < total; off += perRow) {
        const bytes = [];
        let ascii = '';
        for (let i = 0; i < perRow; i++) {
            if (off + i < data.length) {
                const b = data[off + i];
                bytes.push(b.toString(16).toUpperCase().padStart(2, '0'));
                ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·';
            }
            else {
                bytes.push('');
                ascii += ' ';
            }
        }
        rows.push({
            addr: `0x${(baseAddr + off).toString(16).toUpperCase().padStart(8, '0')}`,
            bytes,
            ascii,
        });
    }
    return rows;
}
/** 解析 GDB/DAP evaluate 结果中的第一个十六进制地址（如 "$1 = 0x20000000 <led>"） */
function parseEvalHexAddress(result) {
    const m = /0x[0-9a-fA-F]+/.exec(String(result ?? ''));
    if (!m) {
        return undefined;
    }
    const n = parseInt(m[0], 16);
    return Number.isFinite(n) ? n : undefined;
}
/** 解析 evaluate 结果中的十进制值（GDB 输出形如 "$2 = 4"，优先取 = 后面的数字） */
function parseEvalInt(result) {
    const str = String(result ?? '');
    const eq = /=\s*(-?\d+)/.exec(str);
    const m = eq ? eq[1] : (/(-?\d+)/.exec(str)?.[0] ?? '');
    if (!m) {
        return undefined;
    }
    const n = parseInt(m, 10);
    return Number.isFinite(n) ? n : undefined;
}
//# sourceMappingURL=hexdump.js.map