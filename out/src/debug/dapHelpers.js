"use strict";
/**
 * DAP 访问共享工具：线程获取、微停机采样、内存块读取。
 * 供外设/变量监控/内存视图三个面板复用。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delay = delay;
exports.isEngineSession = isEngineSession;
exports.tryThreadId = tryThreadId;
exports.sampleWhileRunning = sampleWhileRunning;
exports.readBlock = readBlock;
exports.toHexLE = toHexLE;
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isEngineSession(s) {
    return !!s && (s.type === 'cortex-debug' || s.type === 'probe-rs-debug');
}
async function tryThreadId(s) {
    try {
        const th = (await s.customRequest('threads'));
        return th?.threads && th.threads.length > 0 ? th.threads[0].id : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * 微停机采样：暂停目标 → 执行 fn → 立即恢复。
 * 仅 cortex-debug 停机式引擎需要（probe-rs 运行中可旁路直读，禁止调用——会导致程序顿挫）。
 */
async function sampleWhileRunning(s, log, fn) {
    try {
        const pre = await tryThreadId(s);
        await s.customRequest('pause', pre !== undefined ? { threadId: pre } : {});
    }
    catch {
        return false;
    }
    await delay(20);
    let threadId = await tryThreadId(s);
    if (threadId === undefined) {
        await delay(100);
        threadId = await tryThreadId(s);
    }
    let ok = true;
    try {
        await fn();
    }
    catch {
        ok = false;
    }
    if (threadId === undefined) {
        log('微停机采样: 无法获取线程 ID，目标保持暂停 — 请手动点继续（F5）');
        return ok;
    }
    try {
        await s.customRequest('continue', { threadId });
    }
    catch {
        await delay(60);
        const tid2 = await tryThreadId(s);
        try {
            if (tid2 === undefined) {
                throw new Error('未获取到线程');
            }
            await s.customRequest('continue', { threadId: tid2 });
        }
        catch (e2) {
            log(`微停机采样: 恢复运行失败，目标保持暂停 — 请手动点继续（F5）— ${e2 instanceof Error ? e2.message : String(e2)}`);
        }
    }
    return ok;
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