/**
 * 「变量监控」WebviewView：Keil Watch 风格的树形实时变量观察窗。
 *
 * 解析优先级：
 * 1. ELF 符号表（全局/静态，离线零停顿）；
 * 2. 0x 地址直填；
 * 3. 断点捕获（局部变量/数组/结构体：目标暂停时走 DAP 变量作用域，
 *    按名字匹配并记下 memoryReference / variablesReference，数组同时
 *    捕获元素子节点）。
 *
 * 树形展开：数组/结构体条目可展开元素（捕获自 DAP variables），元素值实时刷新
 * （数组按基址整块读后切片；结构体成员逐个读）。
 * 读取：probe-rs 运行中旁路直读；cortex-debug 停机式引擎自动微停机采样。
 * 条目与子节点持久化在 workspaceState（每个工程独立）。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { readBlock, sampleWhileRunning } from '../debug/dapHelpers';
import { parseEvalHexAddress, parseEvalInt } from '../debug/hexdump';
import { toHexLE } from '../debug/dapHelpers';
import { readSymbolTable, SymbolInfo } from '../debug/symbols';
import { splitTypeSuffix, decodeTyped, kindByBytes, ValueKind } from '../debug/typed';
import { captureTopFrameVariables } from '../debug/stoppedCapture';
import { parseDapValue, scalarNumber } from '../debug/dapValue';

export interface WatchDeps {
  getSession(): vscode.DebugSession | undefined;
  log(msg: string): void;
  memento: vscode.Memento;
  /** 最近一次构建的 ELF（符号表来源），无则 undefined */
  getElf(): Promise<string | undefined>;
  /** arm-none-eabi-nm 路径（与 ARM GCC 同目录），无则 undefined */
  getNm(): string | undefined;
  /** 调试面板统一刷新间隔 ms */
  getInterval(): number;
}

interface WatchChild {
  name: string;
  memRef?: string;
  kind: ValueKind;
  typeLabel: string;
  bytes: number;
  /** 暂停时的捕获值（无 memRef 时显示） */
  capturedValue?: string;
}

interface WatchEntry {
  expr: string;
  kind: ValueKind;
  typeLabel: string;
  bytes: number;
  explicitType?: boolean;
  addr?: number;
  memRef?: string;
  /** DAP variablesReference（数组/结构体展开） */
  varRef?: number;
  /** 子节点（数组元素/结构体成员） */
  children?: WatchChild[];
  expanded?: boolean;
  lastResolve?: number;
  resolveTries?: number;
  resolveFailed?: boolean;
}

const STORE_KEY = 'acf.watch.entries';
const WATCH_FMT_KEY = 'acf.watch.fmt';
const MAX_ENTRIES = 16;
const MAX_CHILDREN = 32;

function kindLabelOf(k: ValueKind): string {
  switch (k) {
    case 'u8': return 'uint8_t';
    case 'u16': return 'uint16_t';
    case 'u64': return 'uint64_t';
    case 'i8': return 'int8_t';
    case 'i16': return 'int16_t';
    case 'i32': return 'int32_t';
    case 'i64': return 'int64_t';
    case 'f32': return 'float';
    case 'f64': return 'double';
    default: return 'uint32_t';
  }
}

export class WatchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autoCmakeFlash.watch';
  private view?: vscode.WebviewView;
  private visible = false;
  private fmt: 'dec' | 'hex' = 'dec';
  private entries: WatchEntry[] = [];
  private symCache: { elf: string; mtimeMs: number; map: Map<string, SymbolInfo> } | undefined;
  private symLoading: Promise<void> | undefined;
  private lastProbeSample = 0;
  private lastEmptySymLog = 0;

  constructor(private readonly deps: WatchDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.visible = true;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((m) => void this.onMessage(m));
    view.onDidChangeVisibility(() => {
      this.visible = view.visible;
      void this.view?.webview.postMessage({ cmd: 'run', on: view.visible });
      if (view.visible) {
        this.postEntries();
      }
    });
    const restored = this.deps.memento.get<WatchEntry[]>(STORE_KEY, []) || [];
    this.entries = restored.map((e) => {
      const kind = e.kind ?? (e.bytes === 2 ? 'u16' : e.bytes === 1 ? 'u8' : e.bytes === 8 ? 'u64' : 'u32');
      return {
        ...e,
        bytes: e.bytes ?? 4,
        kind,
        typeLabel: e.typeLabel ?? kindLabelOf(kind),
        explicitType: e.explicitType ?? false,
      };
    });
    this.fmt = this.deps.memento.get<string>(WATCH_FMT_KEY, 'dec') === 'hex' ? 'hex' : 'dec';
    this.postEntries();
    void this.view?.webview.postMessage({ cmd: 'interval', ms: this.deps.getInterval() });
    void this.view?.webview.postMessage({ cmd: 'run', on: view.visible });
  }

  /** 切换值显示进制（持久化） */
  async setFmt(fmt: 'dec' | 'hex'): Promise<void> {
    this.fmt = fmt;
    await this.deps.memento.update(WATCH_FMT_KEY, fmt);
    this.postEntries();
  }

  /** 推送统一刷新间隔（设置变更时调用） */
  setIntervalMs(ms: number): void {
    void this.view?.webview.postMessage({ cmd: 'interval', ms });
  }

  private async persist(): Promise<void> {
    await this.deps.memento.update(STORE_KEY, this.entries);
  }

  /** 目标暂停（断点/复位停机）时由扩展调用：按名捕获 memoryReference / varRef / 子节点 */
  async onTargetStopped(session: vscode.DebugSession): Promise<void> {
    if (this.entries.length === 0) {
      return;
    }
    const captured = await captureTopFrameVariables(session);
    if (captured.size === 0) {
      return;
    }
    let hit = 0;
    for (const e of this.entries) {
      if (e.memRef || e.addr !== undefined || e.varRef !== undefined) {
        continue;
      }
      const c = captured.get(e.expr.replace(/^&/, '').trim()) ?? captured.get(e.expr);
      if (!c) {
        continue;
      }
      hit++;
      if (c.memoryReference) {
        e.memRef = c.memoryReference;
      }
      e.resolveFailed = false;
      e.resolveTries = 0;
      const info = parseDapValue(c.value ?? '');
      if (info.typeLabel && !e.explicitType) {
        e.typeLabel = info.typeLabel;
        e.kind = info.kind ?? kindByBytes(info.bytes ?? 4);
        e.bytes = info.bytes ?? e.bytes;
      }
      if (c.variablesReference) {
        e.varRef = c.variablesReference;
        e.children = (await this.fetchChildren(session, c.variablesReference)) ?? [];
      }
    }
    if (hit > 0) {
      const hasKids = this.entries.some((x) => x.children && x.children.length > 0);
      this.deps.log('变量监控: 已从断点变量作用域捕获 ' + hit + ' 个条目' + (hasKids ? '（含数组/结构体子节点）' : ''));
      await this.persist();
      this.postEntries();
    }
  }

  /** 展开：读取 DAP variables（数组元素/结构体成员，最多 32 个） */
  private async fetchChildren(
    session: vscode.DebugSession,
    varRef: number,
  ): Promise<WatchChild[] | undefined> {
    try {
      const r = (await session.customRequest('variables', {
        variablesReference: varRef,
        start: 0,
        count: MAX_CHILDREN,
      })) as {
        variables?: { name?: string; value?: string; memoryReference?: string }[];
      };
      const children: WatchChild[] = [];
      for (const v of r?.variables ?? []) {
        if (!v.name || children.length >= MAX_CHILDREN) {
          break;
        }
        const info = parseDapValue(v.value ?? '');
        children.push({
          name: v.name,
          memRef: v.memoryReference,
          kind: info.kind ?? 'u32',
          typeLabel: info.typeLabel ?? 'uint32_t',
          bytes: info.bytes ?? 4,
          capturedValue: info.scalar,
        });
      }
      return children;
    } catch {
      return undefined;
    }
  }

  private async onMessage(m: {
    cmd?: string;
    expr?: string;
    interval?: number;
    fmt?: string;
  }): Promise<void> {
    switch (m.cmd) {
      case 'ready':
        this.postEntries();
        break;
      case 'setFmt':
        await this.setFmt(m.fmt === 'hex' ? 'hex' : 'dec');
        break;
      case 'add': {
        const expr = (m.expr ?? '').trim();
        if (!expr || this.entries.some((e) => e.expr === expr)) {
          return;
        }
        if (this.entries.length >= MAX_ENTRIES) {
          void vscode.window.showWarningMessage(`变量监控最多 ${MAX_ENTRIES} 个条目。`);
          return;
        }
        const { name, spec } = splitTypeSuffix(expr);
        const addrMatch = /^0x[0-9a-fA-F]{1,8}$/.exec(name);
        if (addrMatch) {
          const spec2 = spec ?? { kind: 'u32' as ValueKind, bytes: 4, label: 'uint32_t' };
          this.entries.push({
            expr,
            addr: parseInt(name, 16),
            bytes: spec2.bytes,
            kind: spec2.kind,
            typeLabel: spec2.label,
            explicitType: !!spec,
          });
        } else {
          this.entries.push({
            expr: name,
            bytes: spec?.bytes ?? 4,
            kind: spec?.kind ?? 'u32',
            typeLabel: spec?.label ?? 'uint32_t',
            explicitType: !!spec,
          });
        }
        await this.persist();
        this.postEntries();
        break;
      }
      case 'remove': {
        this.entries = this.entries.filter((e) => e.expr !== m.expr);
        await this.persist();
        this.postEntries();
        break;
      }
      case 'expand': {
        const e = this.entries.find((x) => x.expr === m.expr);
        if (!e) {
          return;
        }
        e.expanded = !e.expanded;
        if (e.expanded && !e.children && e.varRef) {
          const s = this.deps.getSession();
          if (s) {
            e.children = (await this.fetchChildren(s, e.varRef)) ?? [];
          }
        }
        this.postEntries();
        break;
      }
      case 'read': {
        if (this.visible) {
          await this.refresh(this.deps.getInterval());
        }
        break;
      }
      default:
        break;
    }
  }

  private postEntries(): void {
    void this.view?.webview.postMessage({
      cmd: 'entries',
      entries: this.entries,
      fmt: this.fmt,
    });
  }

  /** 解析 &表达式 → 地址，sizeof → 字节数（限频；失败保持旧值继续重试） */
  private async resolveEntry(
    s: vscode.DebugSession,
    e: WatchEntry,
    inSample: boolean,
  ): Promise<void> {
    if (e.addr !== undefined && Date.now() - (e.lastResolve ?? 0) < 5_000) {
      return;
    }
    const now = Date.now();
    if (!inSample && e.lastResolve !== undefined && now - e.lastResolve < 1_000) {
      return;
    }
    e.lastResolve = now;
    if (inSample) {
      e.resolveTries = (e.resolveTries ?? 0) + 1;
    }
    try {
      const addrR = (await s.customRequest('evaluate', {
        expression: `&(${e.expr})`,
        context: 'repl',
      })) as { result?: string };
      const addr = parseEvalHexAddress(addrR?.result ?? '');
      if (addr === undefined) {
        if (inSample && (e.resolveTries ?? 0) >= 3) {
          e.resolveFailed = true;
          this.deps.log(`变量监控: ${e.expr} 无法解析（CMSIS 宏需 -g3？）——请改用 0x 地址`);
        }
        return;
      }
      e.addr = addr;
      const sizeR = (await s.customRequest('evaluate', {
        expression: `sizeof(${e.expr})`,
        context: 'repl',
      })) as { result?: string };
      const size = parseEvalInt(sizeR?.result ?? '');
      if (size && size > 0 && size <= 256 && !e.explicitType) {
        e.bytes = size;
      }
      this.deps.log(`变量监控: ${e.expr} @ 0x${addr.toString(16)} (${e.bytes} bytes)`);
    } catch {
      // 目标运行中（cortex-debug）无法 evaluate：留给微停机窗口处理
    }
  }

  private async refresh(intervalMs: number): Promise<void> {
    const s = this.deps.getSession();
    if (!s || this.entries.length === 0) {
      return;
    }
    const nonIntrusive = s.type === 'probe-rs-debug';
    const results: Record<
      string,
      { hex: string; ok: boolean; bytes: number; addr: number; value: string }
    > = {};
    const childVals: Record<
      string,
      Record<string, { hex?: string; value?: string; ok: boolean }>
    > = {};
    const failed: WatchEntry[] = [];
    const readOne = async (e: WatchEntry) => {
      const ref = e.memRef ?? (e.addr !== undefined ? `0x${e.addr.toString(16)}` : undefined);
      if (!ref) {
        return;
      }
      try {
        const r = (await s.customRequest('readMemory', {
          memoryReference: ref,
          count: e.bytes,
        })) as { data?: string };
        const buf = Buffer.from(r?.data ?? '', 'base64');
        if (buf.length > 0) {
          results[e.expr] = {
            hex: toHexLE(buf, e.bytes * 8),
            value: decodeTyped(buf, e.kind),
            ok: true,
            bytes: e.bytes,
            addr: e.addr ?? 0,
          };
          return;
        }
      } catch {
        // 目标运行中不可读（cortex-debug）
      }
      failed.push(e);
      results[e.expr] = { hex: '…', ok: false, bytes: e.bytes, addr: e.addr ?? 0, value: '' };
    };
    await Promise.all(
      this.entries.filter((e) => e.addr !== undefined || e.memRef).map((e) => readOne(e)),
    );

    // 展开条目的子节点：数组按基址整块读后切片；独立 memRef 逐个读
    for (const e of this.entries) {
      if (!e.expanded || !e.children || e.children.length === 0) {
        continue;
      }
      childVals[e.expr] = {};
      const contig =
        e.memRef && /^0x[0-9a-fA-F]+$/.test(e.memRef) ? parseInt(e.memRef, 16) : e.addr;
      if (contig !== undefined && e.children.every((c) => /^\[\d+\]$/.test(c.name))) {
        // 数组：元素连续，整块读一次
        const total = e.children.reduce((a, c) => a + c.bytes, 0);
        const buf = await readBlock(s, contig, Math.max(1, total));
        let off = 0;
        for (const c of e.children) {
          const b = buf ? buf.subarray(off, off + c.bytes) : undefined;
          off += c.bytes;
          if (b && b.length >= c.bytes) {
            childVals[e.expr][c.name] = {
              hex: toHexLE(b, c.bytes * 8),
              value: decodeTyped(b, c.kind),
              ok: true,
            };
          }
        }
      } else {
        await Promise.all(
          e.children.map(async (c) => {
            if (!c.memRef) {
              return;
            }
            try {
              const r = (await s.customRequest('readMemory', {
                memoryReference: c.memRef,
                count: c.bytes,
              })) as { data?: string };
              const b = Buffer.from(r?.data ?? '', 'base64');
              if (b.length > 0) {
                childVals[e.expr][c.name] = {
                  hex: toHexLE(b, c.bytes * 8),
                  value: decodeTyped(b, c.kind),
                  ok: true,
                };
              }
            } catch {
              // 读取失败
            }
          }),
        );
      }
    }

    // 未解析：优先 ELF 符号表（离线、零停顿、双引擎通用）
    const unresolved = this.entries.filter(
      (e) => e.addr === undefined && !e.memRef && e.resolveFailed !== true,
    );
    if (unresolved.length > 0) {
      const sym = await this.ensureSymbols();
      if (sym.size === 0) {
        const now = Date.now();
        if (!this.lastEmptySymLog || now - this.lastEmptySymLog > 10_000) {
          this.lastEmptySymLog = now;
          this.deps.log('变量监控: 无法离线解析（缺 ELF 构建产物或 nm 工具）——请先编译一次；也可直接监控 0x 地址');
        }
      }
      for (const e of unresolved) {
        const name = e.expr.replace(/^&/, '').trim();
        const hit = sym.get(name);
        if (hit) {
          e.addr = hit.addr;
          if (!e.explicitType) {
            e.bytes = Math.max(1, Math.min(256, hit.size));
            e.kind = kindByBytes(e.bytes);
          }
          e.resolveFailed = false;
          this.deps.log(`变量监控: ${e.expr} @ 0x${hit.addr.toString(16)} (${e.bytes}B，来自 ELF 符号表)`);
        }
      }
      const bySym = this.entries.filter((e) => e.addr !== undefined && unresolved.includes(e));
      await Promise.all(
        bySym.map(async (e) => {
          const buf = await readBlock(s, e.addr!, e.bytes);
          if (buf) {
            results[e.expr] = {
              hex: toHexLE(buf, e.bytes * 8),
              value: decodeTyped(buf, e.kind),
              ok: true,
              bytes: e.bytes,
              addr: e.addr!,
            };
          }
        }),
      );
    }
    if (unresolved.length > 0 && !nonIntrusive) {
      // cortex-debug：微停机窗口 evaluate 解析（上限 3 次）
      const stillUnresolved = this.entries.filter(
        (e) =>
          e.addr === undefined && !e.memRef && !e.resolveFailed && (e.resolveTries ?? 0) < 3,
      );
      if (stillUnresolved.length > 0 && Date.now() - this.lastProbeSample > 2_000) {
        this.lastProbeSample = Date.now();
        this.deps.log('变量监控: 运行中无法解析符号，微停机一次完成解析（之后纯旁路读取）');
        await sampleWhileRunning(s, this.deps.log, async () => {
          await Promise.all(
            stillUnresolved.map(async (e) => {
              await this.resolveEntry(s, e, true);
              if (e.addr !== undefined) {
                const buf = await readBlock(s, e.addr, e.bytes);
                if (buf) {
                  results[e.expr] = {
                    hex: toHexLE(buf, e.bytes * 8),
                    value: decodeTyped(buf, e.kind),
                    ok: true,
                    bytes: e.bytes,
                    addr: e.addr,
                  };
                }
              }
            }),
          );
        });
      }
    }

    void this.view?.webview.postMessage({
      cmd: 'values',
      values: results,
      childVals,
    });
  }

  private async ensureSymbols(): Promise<Map<string, SymbolInfo>> {
    const elf = await this.deps.getElf();
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
      const isNew =
        !this.symCache || this.symCache.elf !== elf || this.symCache.mtimeMs !== mtimeMs;
      this.symLoading = readSymbolTable(nm, elf).then((map) => {
        this.symCache = { elf, mtimeMs, map };
        if (isNew && map.size > 0) {
          for (const e of this.entries) {
            e.resolveFailed = false;
            e.resolveTries = 0;
          }
        }
        this.symLoading = undefined;
      });
    }
    await this.symLoading;
    return this.symCache?.map ?? new Map();
  }

  private html(): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: var(--vscode-font-family); font-size: 12.5px;
             color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
             margin: 0; padding: 8px 10px 20px; }
      :root { --ac: #58b6f8; --ok: #4ec994; }
      .row { display: flex; gap: 6px; margin-bottom: 8px; }
      input[type=text] { flex: 1; min-width: 0; padding: 5px 9px; border-radius: 6px;
        border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35));
        background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
      input[type=text]:focus { outline: none; border-color: var(--ac); }
      button { font-family: inherit; font-size: 12px; padding: 4px 12px; border-radius: 6px;
        cursor: pointer; border: 1px solid transparent;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      button.ghost { background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground); }
      .wtable { width: 100%; border-collapse: collapse;
        border: 1px solid rgba(128,128,128,.3); }
      .wtable th, .wtable td { border: 1px solid rgba(128,128,128,.22);
        padding: 4px 8px; text-align: left; vertical-align: middle; }
      .wtable th { font-size: 10.5px; color: var(--vscode-descriptionForeground);
        background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent); font-weight: 600; }
      .wtable tr:hover td { background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent); }
      .caret { cursor: pointer; color: var(--vscode-descriptionForeground); display: inline-block;
        width: 12px; transition: transform .12s; user-select: none; }
      .caret.open { transform: rotate(90deg); }
      .name { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .child .name { padding-left: 16px; font-weight: 400; color: var(--vscode-descriptionForeground); }
      .ty { font-size: 11px; color: var(--vscode-descriptionForeground); }
      .val { font-family: var(--vscode-editor-font-family, monospace); font-size: 13px;
        font-weight: 700; color: var(--ac); }
      .val.stale { color: var(--vscode-descriptionForeground); font-weight: 400; }
      .ad { font-family: var(--vscode-editor-font-family, monospace); font-size: 10.5px;
        color: var(--vscode-descriptionForeground); }
      .del { cursor: pointer; color: var(--vscode-descriptionForeground); text-align: center; }
      .del:hover { color: #f14c4c; }
      .empty { padding: 14px 6px; color: var(--vscode-descriptionForeground);
        text-align: center; line-height: 1.7; }
      .row2 { display: flex; align-items: center; gap: 6px; margin: 8px 0 4px;
        font-size: 10.5px; color: var(--vscode-descriptionForeground); }
      #toast { position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%);
        padding: 7px 18px; border-radius: 8px; font-size: 12px; opacity: 0;
        transition: opacity .25s; pointer-events: none;
        background: color-mix(in srgb, var(--ok) 16%, var(--vscode-sideBar-background));
        border: 1px solid var(--ok); color: var(--ok); }
      #toast.show { opacity: 1; }
      #toast.err { border-color: #f14c4c; color: #f14c4c;
        background: color-mix(in srgb, #f14c4c 12%, var(--vscode-sideBar-background)); }
    </style></head><body>
      <div class="row">
        <input id="expr" type="text" placeholder="变量:类型 或 0x地址:类型（回车添加，如 uwTick:uint32_t、arr:uint16_t）">
        <button id="add">添加</button>
      </div>
      <div id="list"><div class="empty">添加要实时监控的变量<br>全局/静态：直接填变量名（ELF 符号表解析）<br>局部变量/数组：打一个断点即自动捕获，可展开元素</div></div>
      <div class="row2">进制
        <button id="fmt" class="ghost" title="切换值的显示进制">十进制</button>
        · 刷新间隔在侧边栏「调试」分组设置
      </div>
      <div id="toast"></div>
      <script>
        const vscode = acquireVsCodeApi();
        const state = { entries: [], vals: {}, childVals: {}, timer: null, interval: 200, fmt: 'dec', paused: false };
        const $ = (id) => document.getElementById(id);
        const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
        function post(m) { vscode.postMessage(m); }
        function toast(msg, err) {
          const t = $('toast');
          t.textContent = msg;
          t.className = err ? 'err show' : 'show';
          clearTimeout(t._h);
          t._h = setTimeout(() => { t.className = err ? 'err' : ''; }, 2600);
        }

        function valText(e, v) {
          if (!v || !v.ok) return '…';
          if (state.fmt === 'hex') return v.hex;
          return v.value && v.value !== '' ? v.value : v.hex;
        }

        function render() {
          const list = $('list');
          if (state.entries.length === 0) {
            list.innerHTML = '<div class="empty">添加要实时监控的变量<br>全局/静态：直接填变量名（ELF 符号表解析）<br>局部变量/数组：打一个断点即自动捕获，可展开元素</div>';
            return;
          }
          let h = '<table class="wtable"><thead><tr>' +
            '<th>变量名</th><th>类型</th><th>值</th><th>地址</th><th></th></tr></thead><tbody>';
          for (const e of state.entries) {
            const v = state.vals[e.expr] || {};
            const hasKids = (e.children && e.children.length > 0) || e.varRef;
            const caret = hasKids
              ? '<span class="caret' + (e.expanded ? ' open' : '') + '" data-x="' + esc(e.expr) + '">▶</span>'
              : '';
            const addrShown = e.addr !== undefined
              ? '0x' + e.addr.toString(16).toUpperCase()
              : (e.memRef ? '已捕获' : (e.resolveFailed ? '无法解析' : '解析中…'));
            h += '<tr data-e="' + esc(e.expr) + '">' +
              '<td class="name">' + caret + ' ' + esc(e.expr) + '</td>' +
              '<td class="ty">' + esc(e.typeLabel) + '</td>' +
              '<td class="val' + (v.ok ? '' : ' stale') + '">' + esc(valText(e, v)) + '</td>' +
              '<td class="ad">' + esc(addrShown) + '</td>' +
              '<td class="del" data-del="' + esc(e.expr) + '" title="移除">✕</td></tr>';
            if (e.expanded && e.children) {
              for (const c of e.children) {
                const cv = (state.childVals[e.expr] || {})[c.name] || {};
                const shown = cv.ok
                  ? (state.fmt === 'hex' ? cv.hex : (cv.value || cv.hex))
                  : esc(c.capturedValue || '…');
                const isArr = /^\\[\\d+\\]$/.test(c.name);
                const nm = isArr ? esc(e.expr) + esc(c.name) : esc(e.expr) + '.' + esc(c.name);
                h += '<tr class="child"><td class="name">' + nm + '</td>' +
                  '<td class="ty">' + esc(c.typeLabel) + '</td>' +
                  '<td class="val">' + shown + '</td>' +
                  '<td class="ad">' + (c.memRef && /^0x/.test(c.memRef) ? esc(c.memRef.toUpperCase()) : '⏸') + '</td>' +
                  '<td></td></tr>';
              }
            }
          }
          h += '</tbody></table>';
          list.innerHTML = h;
          list.querySelectorAll('.caret').forEach((el) => {
            el.onclick = () => post({ cmd: 'expand', expr: el.getAttribute('data-x') });
          });
          list.querySelectorAll('.del').forEach((el) => {
            el.onclick = () => post({ cmd: 'remove', expr: el.getAttribute('data-del') });
          });
        }

        function tick() {
          if (state.entries.length === 0) return;
          post({ cmd: 'read', interval: state.interval });
        }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.cmd === 'entries') {
            state.entries = m.entries || [];
            state.fmt = m.fmt || 'dec';
            $('fmt').textContent = state.fmt === 'dec' ? '十进制' : '十六进制';
            render();
          } else if (m.cmd === 'values') {
            state.vals = m.values || {};
            state.childVals = m.childVals || {};
            render();
          }
        });

        function add() {
          const v = $('expr').value.trim();
          if (v) { post({ cmd: 'add', expr: v }); $('expr').value = ''; }
        }
        $('add').addEventListener('click', add);
        $('expr').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') add(); });
        $('fmt').addEventListener('click', () => {
          post({ cmd: 'setFmt', fmt: state.fmt === 'dec' ? 'hex' : 'dec' });
        });
        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (!state.paused) { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } } });
        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'run') { state.paused = !e0.data.on; if (state.paused) { if (state.timer) clearInterval(state.timer); state.timer = null; } else { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, state.interval); } } });
        state.timer = setInterval(tick, state.interval);

        post({ cmd: 'ready' });
      </script>
    </body></html>`;
  }
}
