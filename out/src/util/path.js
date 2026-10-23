"use strict";
/**
 * 文件系统与路径工具：跨平台、处理空格/中文/不同盘符。
 * 纯 Node 实现，不依赖 vscode。
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
exports.existsSync = existsSync;
exports.exists = exists;
exports.statSafe = statSafe;
exports.abs = abs;
exports.isInside = isInside;
exports.splitArgs = splitArgs;
exports.walk = walk;
exports.readTextFile = readTextFile;
exports.ensureDir = ensureDir;
exports.isDirNonEmpty = isDirNonEmpty;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function existsSync(p) {
    try {
        fs.accessSync(p);
        return true;
    }
    catch {
        return false;
    }
}
async function exists(p) {
    try {
        await fs.promises.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function statSafe(p) {
    try {
        return await fs.promises.stat(p);
    }
    catch {
        return undefined;
    }
}
/** 归一化为绝对路径（不解析符号链接） */
function abs(p) {
    return path.resolve(p);
}
/** 判断 child 是否位于 root 内部（按路径前缀，兼容盘符大小写差异） */
function isInside(root, child) {
    const r = path.resolve(root);
    const c = path.resolve(child);
    const rel = path.relative(r, c);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
/**
 * 手工拆分参数行：支持双/单引号内的空格。
 * 例如 `-DDEF="a b" -DX=1` -> ['-DDEF=a b', '-DX=1']
 */
function splitArgs(line) {
    const out = [];
    let cur = '';
    let quote = '';
    for (const ch of line) {
        if (quote) {
            if (ch === quote) {
                quote = '';
            }
            else {
                cur += ch;
            }
        }
        else if (ch === '"' || ch === "'") {
            quote = ch;
        }
        else if (/\s/.test(ch)) {
            if (cur) {
                out.push(cur);
                cur = '';
            }
        }
        else {
            cur += ch;
        }
    }
    if (cur) {
        out.push(cur);
    }
    return out;
}
const DEFAULT_SKIP_DIRS = [
    /^\.git$/i,
    /^\.vs$/i,
    /^\.vscode$/i,
    /^\.idea$/i, // CLion 项目元数据
    /^CMakeFiles$/i,
];
/**
 * 有界深度优先遍历目录。回调返回 'skip' 表示跳过该目录（不递归）。
 * 符号链接一律不跟随，避免循环。
 */
async function walk(root, visit, opts = {}) {
    const maxDepth = opts.depth ?? 4;
    const maxEntries = opts.maxEntries ?? 20000;
    const skipDirs = [...(opts.skipDirs ?? []), ...DEFAULT_SKIP_DIRS];
    let visited = 0;
    const rec = async (dir, depth) => {
        if (depth > maxDepth || visited >= maxEntries) {
            return;
        }
        let entries;
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const ent of entries) {
            if (visited >= maxEntries) {
                return;
            }
            visited++;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                if (skipDirs.some((re) => re.test(ent.name))) {
                    continue;
                }
                const r = await visit(full, ent.name, depth, true);
                if (r !== 'skip') {
                    await rec(full, depth + 1);
                }
            }
            else if (ent.isFile()) {
                if (opts.skipFiles?.some((re) => re.test(ent.name))) {
                    continue;
                }
                await visit(full, ent.name, depth, false);
            }
            // 符号链接与其他类型一律忽略
        }
    };
    await rec(root, 0);
}
/** 读取文件（文本，限制大小），失败返回 undefined */
async function readTextFile(p, maxBytes = 2 * 1024 * 1024) {
    try {
        const st = await fs.promises.stat(p);
        if (st.size > maxBytes) {
            return undefined;
        }
        return await fs.promises.readFile(p, 'utf8');
    }
    catch {
        return undefined;
    }
}
/** 确保目录存在（递归创建），失败返回错误消息 */
async function ensureDir(dir) {
    try {
        await fs.promises.mkdir(dir, { recursive: true });
        return undefined;
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}
/** 目录是否非空 */
async function isDirNonEmpty(dir) {
    try {
        const entries = await fs.promises.readdir(dir);
        return entries.length > 0;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=path.js.map