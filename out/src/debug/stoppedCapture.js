"use strict";
/**
 * 变量监控的「断点捕获」：目标暂停（断点/复位停机）时走一遍 DAP 变量作用域
 * （threads → stackTrace → scopes → variables），按名字匹配监控条目并记下
 * memoryReference——继续运行后即可对该地址旁路直读（局部变量也能监控）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureTopFrameVariables = captureTopFrameVariables;
/** 走一遍顶层栈帧的变量作用域，返回 name → 捕获信息 */
async function captureTopFrameVariables(session) {
    const out = new Map();
    try {
        const th = (await session.customRequest('threads'));
        const threadId = th?.threads?.[0]?.id;
        if (threadId === undefined) {
            return out;
        }
        const st = (await session.customRequest('stackTrace', {
            threadId,
            levels: 1,
        }));
        const frameId = st?.stackFrames?.[0]?.id;
        if (frameId === undefined) {
            return out;
        }
        const scopes = (await session.customRequest('scopes', { frameId }));
        for (const scope of scopes?.scopes ?? []) {
            if (!scope.variablesReference) {
                continue;
            }
            try {
                const vars = (await session.customRequest('variables', {
                    variablesReference: scope.variablesReference,
                }));
                for (const v of vars?.variables ?? []) {
                    if (v.name && !out.has(v.name)) {
                        out.set(v.name, { memoryReference: v.memoryReference, value: v.value });
                    }
                }
            }
            catch {
                // 单个作用域失败不影响其他
            }
        }
    }
    catch {
        // 目标不可用
    }
    return out;
}
//# sourceMappingURL=stoppedCapture.js.map