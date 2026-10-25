"use strict";
/**
 * DAP 访问共享工具：会话判定、内存块读取。
 * 供外设/变量监控/内存视图/调用栈面板复用（probe-rs 引擎，运行中旁路直读）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delay = delay;
exports.isEngineSession = isEngineSession;
exports.readBlock = readBlock;
exports.toHexLE = toHexLE;
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isEngineSession(s) {
    return !!s && s.type === 'probe-rs-debug';
}
/** 读一块内存（失败返回 undefined，含目标运行中/探针瞬断） */
async function readBlock(s, addr, len) {
    try {
        const r = (await s.customRequest('readMemory', {
            memoryReference: `0x${addr.toString(16)}`,
            count: len,
        }));
        const buf = Buffer.from(r?.data ?? '', 'base64');
        return buf.length > 0 ? buf : undefined;
    }
    catch {
        return undefined;
    }
}
/** 小端 hex（如 0x08000179） */
function toHexLE(buf, bits) {
    const bytes = Math.max(1, Math.min(8, Math.ceil(bits / 8)));
    let v = 0n;
    for (let i = 0; i < bytes && i < buf.length; i++) {
        v |= BigInt(buf[i]) << BigInt(8 * i);
    }
    return `0x${v.toString(16).toUpperCase().padStart(bytes * 2, '0')}`;
}
//# sourceMappingURL=dapHelpers.js.map