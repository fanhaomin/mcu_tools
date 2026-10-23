/**
 * 文件系统与路径工具：跨平台、处理空格/中文/不同盘符。
 * 纯 Node 实现，不依赖 vscode。
 */

import * as fs from 'fs';
import * as path from 'path';

export function existsSync(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function statSafe(p: string): Promise<fs.Stats | undefined> {
  try {
    return await fs.promises.stat(p);
  } catch {
    return undefined;
  }
}

/** 归一化为绝对路径（不解析符号链接） */
export function abs(p: string): string {
  return path.resolve(p);
}

/** 判断 child 是否位于 root 内部（按路径前缀，兼容盘符大小写差异） */
export function isInside(root: string, child: string): boolean {
  const r = path.resolve(root);
  const c = path.resolve(child);
  const rel = path.relative(r, c);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * 手工拆分参数行：支持双/单引号内的空格。
 * 例如 `-DDEF="a b" -DX=1` -> ['-DDEF=a b', '-DX=1']
 */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string = '';
  for (const ch of line) {
    if (quote) {
      if (ch === quote) {
        quote = '';
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) {
    out.push(cur);
  }
  return out;
}

export interface WalkOptions {
  maxDepth?: number;
  maxEntries?: number;
  /** 目录名匹配则整个跳过（不递归） */
  skipDirs?: RegExp[];
  /** 文件名匹配则跳过 */
  skipFiles?: RegExp[];
  /** 递归深度，默认 4 */
  depth?: number;
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
export async function walk(
  root: string,
  visit: (p: string, name: string, depth: number, isDir: boolean) => void | 'skip' | Promise<void | 'skip'>,
  opts: WalkOptions = {},
): Promise<void> {
  const maxDepth = opts.depth ?? 4;
  const maxEntries = opts.maxEntries ?? 20000;
  const skipDirs = [...(opts.skipDirs ?? []), ...DEFAULT_SKIP_DIRS];
  let visited = 0;

  const rec = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth || visited >= maxEntries) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
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
      } else if (ent.isFile()) {
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
export async function readTextFile(p: string, maxBytes = 2 * 1024 * 1024): Promise<string | undefined> {
  try {
    const st = await fs.promises.stat(p);
    if (st.size > maxBytes) {
      return undefined;
    }
    return await fs.promises.readFile(p, 'utf8');
  } catch {
    return undefined;
  }
}

/** 确保目录存在（递归创建），失败返回错误消息 */
export async function ensureDir(dir: string): Promise<string | undefined> {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** 目录是否非空 */
export async function isDirNonEmpty(dir: string): Promise<boolean> {
  try {
    const entries = await fs.promises.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}
