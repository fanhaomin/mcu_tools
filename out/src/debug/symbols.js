"use strict";
/**
 * ELF 符号表解析：变量监控的地址解析不依赖 GDB evaluate——
 * 用 arm-none-eabi-nm 离线读取 ELF 符号表（地址 + 大小），
 * 运行中/暂停均可，两个调试引擎通用，零停顿。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseNmOutput = parseNmOutput;
exports.readSymbolTable = readSymbolTable;
const process_1 = require("../util/process");
/** 解析 nm --defined-only -S 的输出（行格式：ADDR [SIZE] TYPE NAME） */
function parseNmOutput(text) {
    const map = new Map();
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const m = /^([0-9a-fA-F]{6,16})\s+([0-9a-fA-F]+)?\s+[a-zA-Z]\s+(.+)$/.exec(raw.trim());
        if (!m) {
            continue;
        }
        const name = m[3].trim();
        if (!name || map.has(name)) {
            continue;
        }
        const addr = parseInt(m[1], 16);
        if (!Number.isFinite(addr)) {
            continue;
        }
        map.set(name, {
            addr,
            size: m[2] ? Math.max(1, Math.min(4096, parseInt(m[2], 16))) : 4,
        });
    }
    return map;
}
/** 运行 nm 读取 ELF 符号表（nm 不存在或失败返回空表） */
async function readSymbolTable(nmPath, elfPath, timeoutMs = 15_000) {
    try {
        const r = await (0, process_1.execFileSafe)(nmPath, ['--defined-only', '-S', elfPath], { timeoutMs });
        if (r.exitCode !== 0 && !r.stdout.trim()) {
            return new Map();
        }
        return parseNmOutput(r.stdout);
    }
    catch {
        return new Map();
    }
}
//# sourceMappingURL=symbols.js.map