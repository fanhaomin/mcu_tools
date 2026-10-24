const fs = require('fs');
const f = 'src/ui/watchView.ts';
let s = fs.readFileSync(f, 'utf8');
let n = 0;

function rep(a, b) {
  if (!s.includes(a)) { console.log('MISS:', JSON.stringify(a.slice(0, 80))); process.exit(1); }
  s = s.replace(a, b, 1);
  n++;
}

// 1. 导入符号表模块
rep(`import { toHexLE } from '../debug/dapHelpers';`,
    `import { toHexLE } from '../debug/dapHelpers';\nimport { readSymbolTable, SymbolInfo } from '../debug/symbols';\nimport * as fs from 'fs';`);

// 2. deps 增加 getElf / getNm
rep(`export interface WatchDeps {
  getSession(): vscode.DebugSession | undefined;
  log(msg: string): void;
  memento: vscode.Memento;
}`,
`export interface WatchDeps {
  getSession(): vscode.DebugSession | undefined;
  log(msg: string): void;
  memento: vscode.Memento;
  /** 最近一次构建的 ELF（符号表来源），无则 undefined */
  getElf(): string | undefined;
  /** arm-none-eabi-nm 路径（与 ARM GCC 同目录），无则 undefined */
  getNm(): string | undefined;
}`);

// 3. 符号表缓存（按 ELF + mtime）
rep(`export class WatchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autoCmakeFlash.watch';
  private view?: vscode.WebviewView;
  private visible = false;
  private entries: WatchEntry[] = [];`,
`export class WatchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autoCmakeFlash.watch';
  private view?: vscode.WebviewView;
  private visible = false;
  private entries: WatchEntry[] = [];
  private symCache: { elf: string; mtimeMs: number; map: Map<string, SymbolInfo> } | undefined;
  private symLoading: Promise<void> | undefined;

  /** 加载 ELF 符号表（按 mtime 缓存；nm 失败返回空表不报错） */
  private async ensureSymbols(): Promise<Map<string, SymbolInfo>> {
    const elf = this.deps.getElf();
    const nm = this.deps.getNm();
    if (!elf || !nm) {
      return new Map();
    }
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(elf).mtimeMs;
    } catch {
      return new Map();
    }
    if (this.symCache?.elf === elf && this.symCache.mtimeMs === mtimeMs) {
      return this.symCache.map;
    }
    if (!this.symLoading) {
      this.symLoading = readSymbolTable(nm, elf).then((map) => {
        this.symCache = { elf, mtimeMs, map };
        this.symLoading = undefined;
      });
    }
    await this.symLoading;
    return this.symCache?.map ?? new Map();
  }`);

// 4. 符号表解析优先：未解析条目先查符号表（无停顿、双引擎通用）
rep(`    // 2. 未解析的：尝试 evaluate 解析（probe-rs 运行中不支持 evaluate，
    //    失败持续 2 秒后自动微停机一次完成解析——只停一次，之后纯旁路）
    const unresolved = this.entries.filter((e) => e.addr === undefined);
    if (unresolved.length > 0) {`,
`    // 2. 未解析的：优先查 ELF 符号表（离线、零停顿、双引擎通用）
    const unresolved = this.entries.filter((e) => e.addr === undefined);
    if (unresolved.length > 0) {
      const sym = await this.ensureSymbols();
      for (const e of unresolved) {
        const name = e.expr.replace(/^&/, '').trim();
        const hit = sym.get(name);
        if (hit) {
          e.addr = hit.addr;
          e.bytes = Math.max(1, Math.min(256, hit.size));
          e.resolveFailed = false;
          this.deps.log('变量监控: ' + e.expr + ' @ 0x' + hit.addr.toString(16) + ' (' + e.bytes + 'B，来自 ELF 符号表)');
        }
      }
      const bySym = this.entries.filter((e) => e.addr !== undefined && unresolved.includes(e));
      await Promise.all(
        bySym.map(async (e) => {
          const buf = await readBlock(s, e.addr!, e.bytes);
          if (buf) {
            results[e.expr] = {
              hex: toHexLE(buf, e.bytes * 8),
              ok: true,
              bytes: e.bytes,
              addr: e.addr!,
            };
          }
        }),
      );
    }
    if (unresolved.length > 0) {`);

fs.writeFileSync(f, s);
console.log('applied', n, 'edits');
