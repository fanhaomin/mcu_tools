/**
 * 「变量监控」WebviewView：Keil Watch 风格的树形实时变量观察窗。
 *
 * 解析优先级：
 * 1. ELF DWARF（全局/静态的完整类型：数组/结构体/枚举/指针，含成员偏移，
 *    离线零停顿——数组结构体可逐层展开，元素按类型精确解码）；
 * 2. ELF 符号表（无 DWARF 时退化为地址+大小，类型按字节推测）；
 * 3. 0x 地址直填；
 * 4. 断点捕获（局部变量：目标暂停时走 DAP 变量作用域，按名字匹配并记下
 *    memoryReference / variablesReference）。
 *
 * 树形展开：DWARF 路径按类型描述物化子节点（数组元素/结构体成员/嵌套递归），
 * 一次整块读取后按偏移切片解码；DAP 捕获路径展开 elements via variables。
 * 读取：probe-rs 运行中旁路直读。
 * 条目与子节点持久化在 workspaceState（每个工程独立）。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { readBlock } from '../debug/dapHelpers';
import { parseEvalHexAddress, parseEvalInt } from '../debug/hexdump';
import { toHexLE } from '../debug/dapHelpers';
import { readSymbolTable, SymbolInfo } from '../debug/symbols';
import { splitTypeSuffix, decodeTyped, kindByBytes, ValueKind } from '../debug/typed';
import { captureTopFrameVariables } from '../debug/stoppedCapture';
import { parseDapValue, scalarNumber } from '../debug/dapValue';
import {
  DwarfCatalog,
  DwarfVar,
  TypeDesc,
  decodeByType,
  encodeValueText,
  matrixSpecOf,
  readDwarfCatalog,
  materializeChildren,
  decodeTypedSubtree,
  legacyFieldsOf,
  resolveExprPath,
} from '../debug/dwarf';

export interface WatchDeps {
  getSession(): vscode.DebugSession | undefined;
  log(msg: string): void;
  memento: vscode.Memento;
  /** 最近一次构建的 ELF（符号表来源），无则 undefined */
  getElf(): Promise<string | undefined>;
  /** arm-none-eabi-nm 路径（与 ARM GCC 同目录），无则 undefined */
  getNm(): string | undefined;
  /** arm-none-eabi-readelf 路径（与 nm 同目录），无则 undefined */
  getReadelf(): string | undefined;
  /** 调试面板统一刷新间隔 ms */
  getInterval(): number;
  /** 条目变化（波形/数组面板同步列表用）；matrix 为二维+标量数组的热图规格 */
  onEntries?(list: {
    expr: string;
    typeLabel: string;
    scalar: boolean;
    colorIdx: number;
    matrix?: {
      dims: number[];
      bytes: number;
      addr?: number;
      elemBytes: number;
      kind: ValueKind;
    };
  }[]): void;
  /** 每轮采样的数值快照（波形面板） */
  onSample?(t: number, vals: Record<string, number>): void;
}

interface WatchChild {
  /** 显示后缀（[2] / scale / inner） */
  name: string;
  /** 相对根的路径（''、'[2]'、'.scale'、'[0].inner'），DAP 捕获旧数据为 name */
  path: string;
  memRef?: string;
  kind: ValueKind;
  typeLabel: string;
  bytes: number;
  /** 显示进制覆盖（auto=跟随面板；子节点 auto 时继承最近的祖先设置） */
  fmt?: 'auto' | 'dec' | 'hex' | 'bin' | 'char' | 'multi';
  /** 暂停时的捕获值（无 memRef 时显示） */
  capturedValue?: string;
  // ---- DWARF 类型路径 ----
  type?: TypeDesc;
  addr?: number;
  /** 嵌套子节点（数组元素/结构体成员，按需物化） */
  children?: WatchChild[];
  expanded?: boolean;
  /** 元素超出展示上限 */
  truncated?: boolean;
  /** 指针解引用节点：地址 = 父指针的运行时值（读取周期解析，静态 addr 无效） */
  deref?: boolean;
}

interface WatchEntry {
  expr: string;
  kind: ValueKind;
  typeLabel: string;
  bytes: number;
  explicitType?: boolean;
  /** 显示进制覆盖（右键菜单设置；子元素继承） */
  fmt?: 'auto' | 'dec' | 'hex' | 'bin' | 'char' | 'multi';
  addr?: number;
  memRef?: string;
  /** DAP variablesReference（数组/结构体展开） */
  varRef?: number;
  /** DWARF 解析出的完整类型 */
  type?: TypeDesc;
  /** 所属源文件 / 作用域（DWARF） */
  srcFile?: string;
  scope?: string;
  /** 断点捕获/旧版本遗留的暂存值（变量被删除时清除） */
  capturedValue?: string;
  children?: WatchChild[];
  expanded?: boolean;
  lastResolve?: number;
  resolveTries?: number;
  resolveFailed?: boolean;
}

const STORE_KEY = 'acf.watch.entries';
const WATCH_FMT_KEY = 'acf.watch.fmt';
const COLW_KEY = 'acf.watch.colw';
/** 默认列宽（%）：变量名 | 类型 | 值 | 地址（删除列固定 26px） */
const DEF_COLW = [34, 20, 30, 16];
const MAX_ENTRIES = 32;
const MAX_CHILDREN = 32;
/** DWARF 展开每层物化子节点上限（行 DOM 全量建，数值只读视口内的行） */
const MAX_DWARF_CHILDREN = 2048;
/** 聚合变量（数组/结构体）整块读取的字节上限（一次 DAP readMemory） */
const AGG_READ_CAP = 256;

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

/** DWARF 类型 → 一层子节点（数组元素/结构体成员/嵌套递归）在 dwarf.ts 中实现（纯函数可测） */

export class WatchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autoCmakeFlash.watch';
  private view?: vscode.WebviewView;
  private visible = false;
  private fmt: 'dec' | 'hex' = 'dec';
  private entries: WatchEntry[] = [];

  private symCache: { elf: string; mtimeMs: number; map: Map<string, SymbolInfo> } | undefined;
  private symLoading: Promise<void> | undefined;
  private dwarfCache:
    | { elf: string; mtimeMs: number; cat: DwarfCatalog }
    | undefined;
  private dwarfLoading: Promise<void> | undefined;
  private lastEmptySymLog = 0;
  private lastDwarfApply = 0;
  /** webview 视口内可见的子节点行（expr#path）：大数组/结构体只补读可见部分 */
  private visKeys = new Set<string>();
  /** 上次存在性核验的 ELF 标识（路径+mtime）：同 ELF 只核验一次，重编译后重跑 */
  private membershipElf?: string;
  /** 用户拖拽的列宽（%，4 列），持久化 */
  private colw: number[] = [...DEF_COLW];
  /** 并发闸：上一次刷新未完成时跳过本轮 tick（读取堆积表现为值跳变/迟滞） */
  private refreshing = false;
  /** 上次发送的 values JSON：完全相同则不再发送（webview 侧零 DOM 写） */
  private lastValuesJson = '';
  /** 条目恢复是否已完成（幂等；resolve 与 syncChart 共用） */
  private restored = false;
  /** 上次通知 webview 的会话状态（变化才发） */
  private lastSessionOn: boolean | undefined;

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
    this.ensureRestored();
    this.postEntries();
    this.pushSessionState(!!this.deps.getSession());
    // 打开面板/开调试即核验：持久化的过期地址（变量已删除）立即标红，不显示脏值
    void this.applyDwarf()
      .then(() => this.enforceElfMembership())
      .then((r) => {
        if (r) {
          this.postEntries();
        }
      });
    void this.view?.webview.postMessage({ cmd: 'interval', ms: this.deps.getInterval() });
    void this.view?.webview.postMessage({ cmd: 'run', on: view.visible });
  }

  /** 从 workspaceState 恢复条目/进制/列宽（幂等；resolve 与 syncChart 共用） */
  private ensureRestored(): void {
    if (this.restored) {
      return;
    }
    this.restored = true;
    const restored = this.deps.memento.get<WatchEntry[]>(STORE_KEY, []) || [];
    this.entries = restored.map((e) => {
      const kind = e.kind ?? (e.bytes === 2 ? 'u16' : e.bytes === 1 ? 'u8' : e.bytes === 8 ? 'u64' : 'u32');
      const fixChildren = (cs: WatchChild[] | undefined): WatchChild[] | undefined =>
        cs?.map((c) => ({
          ...c,
          path: c.path || c.name || '',
          kind: c.kind ?? 'u32',
          bytes: c.bytes ?? 4,
          typeLabel: c.typeLabel ?? kindLabelOf(c.kind ?? 'u32'),
          children: fixChildren(c.children),
        }));
      return {
        ...e,
        bytes: e.bytes ?? 4,
        kind,
        typeLabel: e.typeLabel ?? kindLabelOf(kind),
        explicitType: e.explicitType ?? false,
        children: fixChildren(e.children),
      };
    });
    this.fmt = this.deps.memento.get<string>(WATCH_FMT_KEY, 'dec') === 'hex' ? 'hex' : 'dec';
    const savedW = this.deps.memento.get<number[]>(COLW_KEY, []);
    if (
      Array.isArray(savedW) &&
      savedW.length === 4 &&
      savedW.every((x) => Number.isFinite(x) && x >= 5 && x <= 85)
    ) {
      this.colw = savedW;
    }
  }

  /** 切换值显示进制（持久化） */
  async setFmt(fmt: 'dec' | 'hex'): Promise<void> {
    this.fmt = fmt;
    await this.deps.memento.update(WATCH_FMT_KEY, fmt);
    this.postEntries();
  }

  /** 推送统一刷新间隔（设置变更时调用） */
  setIntervalMs(ms: number): void {
    void this.view?.webview.postMessage({ cmd: 'interval', ms: ms });
  }

  private async persist(): Promise<void> {
    await this.deps.memento.update(STORE_KEY, this.entries);
  }

  /** 右键「设置值…」：按类型编码写入目标内存（整数小端 / IEEE754 浮点 / 布尔 0-1 / 枚举名） */
  private async handleSetValue(expr: string, path: string, cur: string): Promise<void> {
    const s = this.deps.getSession();
    const e = this.entries.find((x) => x.expr === expr);
    if (!e || !s) {
      return;
    }
    const node = path ? this.findChild(e, path) : e;
    if (!node) {
      return;
    }
    const ref = node.memRef ?? (node.addr !== undefined ? `0x${node.addr.toString(16)}` : undefined);
    if (!ref) {
      void vscode.window.showWarningMessage('变量监控: 该条目尚未解析出地址，无法写入（局部变量请先断点捕获）。');
      return;
    }
    const bytes = node.bytes ?? 4;
    if (bytes > 8) {
      void vscode.window.showWarningMessage('变量监控: 仅支持写入标量（≤8 字节）；数组/结构体请在内存视图中修改。');
      return;
    }
    const input = await vscode.window.showInputBox({
      title: `设置 ${expr}${path || ''}`,
      prompt: `${node.typeLabel} @ ${ref.startsWith('0x') ? ref.toUpperCase() : '已捕获地址'} — 支持十进制 / 0x十六进制 / true / false / 枚举名`,
      value: cur === '…' ? '' : cur,
      ignoreFocusOut: true,
    });
    if (input === undefined || input.trim() === '') {
      return;
    }
    const buf = encodeValueText(input.trim(), node.type, node.kind, bytes);
    if (!buf) {
      void vscode.window.showErrorMessage(`变量监控: 无法按 ${node.typeLabel} 解析输入 "${input.trim()}"。`);
      return;
    }
    const ok = await this.writeMemory(s, ref, buf);
    if (ok) {
      this.deps.log(`变量监控: 写入 ${expr}${path || ''} = ${input.trim()}（${node.typeLabel}，${buf.length}B）`);
      void this.refresh(this.deps.getInterval());
    } else {
      void vscode.window.showErrorMessage(`变量监控: 写入 ${expr}${path || ''} 失败（引擎不支持或目标运行中且无法暂停，详见日志）。`);
    }
  }

  /** 写内存：DAP writeMemory（probe-rs 运行中可写） */
  private async writeMemory(s: vscode.DebugSession, ref: string, buf: Buffer): Promise<boolean> {
    try {
      await s.customRequest('writeMemory', {
        memoryReference: ref,
        count: buf.length,
        data: buf.toString('base64'),
      });
      return true;
    } catch (e) {
      this.deps.log(`变量监控: writeMemory 失败（${s.type}）: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
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
      // 已判定「不在 ELF 中」（被优化消除/已删除）的条目不再捕获——
      // 调试器作用域里即使能按名找到，读出来的也是无效句柄/垃圾值
      if (e.resolveFailed) {
        continue;
      }
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
          path: v.name,
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

  /** 在条目的子树中按路径找节点 */
  private findChild(entry: WatchEntry, path: string): WatchChild | undefined {
    let found: WatchChild | undefined;
    const walk = (cs: WatchChild[] | undefined): void => {
      for (const c of cs ?? []) {
        if (c.path === path) {
          found = c;
          return;
        }
        walk(c.children);
        if (found) {
          return;
        }
      }
    };
    walk(entry.children);
    return found;
  }

  private async onMessage(m: {
    cmd?: string;
    expr?: string;
    path?: string;
    fmt?: string;
    cur?: string;
    w?: number[];
    interval?: number;
    keys?: string[];
  }): Promise<void> {
    switch (m.cmd) {
      case 'ready':
        this.postEntries();
        break;
      case 'setFmt':
        await this.setFmt(m.fmt === 'hex' ? 'hex' : 'dec');
        break;
      case 'browse':
        await this.browseAndAdd();
        break;
      case 'setvalue': {
        await this.handleSetValue(m.expr ?? '', m.path ?? '', m.cur ?? '');
        break;
      }
      case 'colw': {
        // 表头拖拽后的列宽（%，4 列）：校验后持久化
        const w = Array.isArray(m.w) ? m.w.map(Number) : [];
        if (w.length === 4 && w.every((x) => Number.isFinite(x) && x >= 4 && x <= 90)) {
          this.colw = w;
          await this.deps.memento.update(COLW_KEY, w);
        }
        break;
      }
      case 'fmt': {
        // 右键菜单：单条目显示进制覆盖（auto/dec/hex/bin/char），随条目持久化
        const e = this.entries.find((x) => x.expr === m.expr);
        if (!e) {
          return;
        }
        const fmt =
          m.fmt === 'dec' || m.fmt === 'hex' || m.fmt === 'bin' || m.fmt === 'char' || m.fmt === 'multi'
            ? m.fmt
            : 'auto';
        const path = m.path ?? '';
        if (!path) {
          e.fmt = fmt;
        } else {
          const c = this.findChild(e, path);
          if (c) {
            c.fmt = fmt;
          }
        }
        await this.persist();
        this.postEntries();
        break;
      }
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
          // 静态表达式（test_array[1] / cfg.speed / sa[2].x）：DWARF 类型树算地址，
          // 直接监控该元素。explicitType 免存在性门禁按名误杀（表达式非符号名）。
          const cat = await this.ensureDwarf();
          const r = cat.byName.size > 0 ? resolveExprPath(cat.byName, name) : undefined;
          if (r && r.addr > 0) {
            const lf = legacyFieldsOf(r.type, AGG_READ_CAP);
            this.entries.push({
              expr: name,
              addr: r.addr,
              bytes: spec?.bytes ?? lf.bytes,
              kind: spec?.kind ?? lf.kind,
              typeLabel: spec?.label ?? r.type.label,
              type: r.type,
              explicitType: true,
            });
            this.deps.log(
              `变量监控: ${name} @ 0x${r.addr.toString(16).toUpperCase()} ${r.type.label} — 表达式解析`,
            );
          } else {
            this.entries.push({
              expr: name,
              bytes: spec?.bytes ?? 4,
              kind: spec?.kind ?? 'u32',
              typeLabel: spec?.label ?? 'uint32_t',
              explicitType: !!spec,
            });
          }
        }
        await this.persist();
        this.postEntries();
        // 立即尝试 DWARF 解析（无需调试会话，类型/地址马上可见）+ 存在性门禁
        void this.applyDwarf()
          .then(() => this.enforceElfMembership())
          .then(() => this.postEntries());
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
        const path = m.path ?? '';
        if (!path) {
          e.expanded = !e.expanded;
          if (e.expanded && !e.children) {
            if (e.type && e.type.cat === 'ptr' && e.type.elem) {
              e.children = [this.derefChild(e.type, '')];
            } else if (e.type && e.addr !== undefined) {
              e.children = materializeChildren(e.addr, e.type, '', MAX_DWARF_CHILDREN) ?? [];
            } else if (e.varRef) {
              const s = this.deps.getSession();
              if (s) {
                e.children = (await this.fetchChildren(s, e.varRef)) ?? [];
              }
            }
          }
        } else {
          const c = this.findChild(e, path);
          if (c) {
            c.expanded = !c.expanded;
            if (c.expanded && !c.children && c.type) {
              if (c.type.cat === 'ptr' && c.type.elem) {
                c.children = [this.derefChild(c.type, path)];
              } else if (c.addr !== undefined || c.deref) {
                // deref 节点静态地址未知：子节点按偏移物化（读取时以运行时地址为基）
                c.children = materializeChildren(c.addr ?? 0, c.type, path, MAX_DWARF_CHILDREN) ?? [];
              }
            }
          }
        }
        await this.persist();
        this.postEntries();
        break;
      }
      case 'vis': {
        // 视口内可见行（expr#path）：下一轮刷新只补读这些行（大数组滚动到哪读到哪）
        const next = new Set(m.keys ?? []);
        const same =
          next.size === this.visKeys.size && [...next].every((k) => this.visKeys.has(k));
        if (!same) {
          this.visKeys = next;
          if (this.visible && !this.refreshing && this.deps.getSession()) {
            this.refreshing = true;
            void this.refresh(this.deps.getInterval()).finally(() => {
              this.refreshing = false;
            });
          }
        }
        break;
      }
      case 'read': {
        if (this.visible && !this.refreshing) {
          this.refreshing = true;
          try {
            await this.refresh(this.deps.getInterval());
          } finally {
            this.refreshing = false;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  /** 数组面板用矩阵规格（二维+标量数组），含读取所需的地址/元素解码信息 */
  private matrixInfo(e: WatchEntry):
    | { dims: number[]; bytes: number; addr?: number; elemBytes: number; kind: ValueKind }
    | undefined {
    const ms = e.type ? matrixSpecOf(e.type) : undefined;
    if (!ms) {
      return undefined;
    }
    let total = ms.elemBytes;
    for (const d of ms.dims) {
      total *= d;
    }
    return {
      dims: ms.dims,
      bytes: total,
      addr: e.addr,
      elemBytes: ms.elemBytes,
      kind: ms.kind,
    };
  }

  private postEntries(): void {
    this.notifyChart();
    void this.view?.webview.postMessage({
      cmd: 'entries',
      entries: this.entries,
      fmt: this.fmt,
      colw: this.colw,
    });
  }

  /** 波形面板同步：条目列表（含是否标量、曲线颜色序） */
  private notifyChart(): void {
    this.deps.onEntries?.(
      this.entries.map((e, i) => ({
        expr: e.expr,
        typeLabel: e.typeLabel,
        scalar: this.isNumericEntry(e),
        colorIdx: i,
        matrix: this.matrixInfo(e),
      })),
    );
  }

  /** 波形面板就绪时回填条目（含仅打开波形标签、监控标签从未打开的场景） */
  syncChart(): void {
    this.ensureRestored();
    this.notifyChart();
  }

  private isNumericEntry(e: WatchEntry): boolean {
    if (e.type) {
      return e.type.cat === 'scalar' || e.type.cat === 'bool' || e.type.cat === 'enum';
    }
    return true; // 旧路径条目按 kind 解码，均为标量
  }

  private numericOf(e: WatchEntry, text: string): number | null {
    if (e.type?.cat === 'bool') {
      return /^true/i.test(text) ? 1 : 0;
    }
    const n = scalarNumber(text);
    return n === undefined ? null : n;
  }

  /** 波形面板可见而监控标签隐藏时，由其宿主定时器驱动采样 */
  forceSample(): void {
    const s = this.deps.getSession();
    if (!s || this.refreshing) {
      return;
    }
    void this.refresh(this.deps.getInterval());
  }

  /** 编辑器右键 / QuickPick 浏览添加：在 DWARF 目录中验证后加入监控 */
  async addFromEditor(
    name: string,
  ): Promise<{ status: 'added' | 'exists' | 'full' | 'notfound' | 'noelf'; var?: DwarfVar }> {
    this.ensureRestored();
    name = name.trim();
    if (this.entries.some((e) => e.expr === name)) {
      return { status: 'exists' };
    }
    if (this.entries.length >= MAX_ENTRIES) {
      return { status: 'full' };
    }
    const cat = await this.ensureDwarf();
    if (cat.byName.size === 0) {
      return { status: 'noelf' };
    }
    const v = cat.byName.get(name);
    if (!v) {
      return { status: 'notfound' };
    }
    this.entries.push({ expr: name, bytes: 4, kind: 'u32', typeLabel: 'uint32_t' });
    await this.applyDwarf();
    await this.persist();
    this.postEntries();
    return { status: 'added', var: v };
  }

  /** ELF 全部静态变量（浏览 QuickPick 用，按名称排序） */
  async listVars(): Promise<DwarfVar[]> {
    const cat = await this.ensureDwarf();
    return [...cat.vars].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 浏览全部变量并添加（监控面板「浏览」按钮 / 命令面板共用） */
  async browseAndAdd(): Promise<void> {
    this.ensureRestored();
    const vars = await this.listVars();
    if (vars.length === 0) {
      void vscode.window.showWarningMessage(
        '变量监控: ELF 中没有可浏览的变量（先完成一次 Debug 构建生成调试信息）。',
      );
      return;
    }
    const picks = await vscode.window.showQuickPick(
      vars.map((v) => ({
        label: v.name,
        description: v.type.label,
        detail:
          `0x${v.addr.toString(16).toUpperCase()} · ${v.file ?? ''}` +
          (v.scope ? ` · ${v.scope}()` : v.external ? ' · 全局' : ' · static'),
        name: v.name,
      })),
      {
        title: 'Embedded Debug — 浏览 ELF 变量（选中即加入监控，可多选）',
        placeHolder: '输入名称过滤',
        canPickMany: true,
        ignoreFocusOut: true,
      },
    );
    if (!picks || picks.length === 0) {
      return;
    }
    let added = 0;
    for (const p of picks) {
      const r = await this.addFromEditor(p.name);
      if (r.status === 'added') {
        added++;
      }
    }
    if (added > 0) {
      this.deps.log(`变量监控: 从变量浏览添加 ${added} 个条目`);
      this.postEntries();
      void vscode.window.showInformationMessage(`Embedded Debug: 已添加 ${added} 个变量到监控。`);
    }
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
      // evaluate 不可用/失败：走 ELF 符号表 + DWARF 离线解析兜底
    }
  }

  /** DWARF 目录（按 ELF+mtime 缓存）；无 readelf / 无调试信息返回空目录 */
  private async ensureDwarf(): Promise<DwarfCatalog> {
    const elf = await this.deps.getElf();
    const readelf = this.deps.getReadelf();
    const empty: DwarfCatalog = { vars: [], byName: new Map() };
    if (!elf || !readelf) {
      return empty;
    }
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(elf).mtimeMs;
    } catch {
      return empty;
    }
    if (this.dwarfCache?.elf === elf && this.dwarfCache.mtimeMs === mtimeMs) {
      return this.dwarfCache.cat;
    }
    if (!this.dwarfLoading) {
      const isNew = !this.dwarfCache || this.dwarfCache.elf !== elf || this.dwarfCache.mtimeMs !== mtimeMs;
      this.dwarfLoading = readDwarfCatalog(readelf, elf).then((cat) => {
        if (cat && isNew) {
          for (const e of this.entries) {
            e.resolveFailed = false;
            e.resolveTries = 0;
          }
          const agg = cat.vars.filter(
            (v) => v.type.cat === 'array' || v.type.cat === 'struct',
          ).length;
          this.deps.log(
            `变量监控: DWARF 已解析 ${cat.vars.length} 个静态变量（含 ${agg} 个数组/结构体，可展开）${elf}`,
          );
        }
        this.dwarfCache = cat
          ? { elf, mtimeMs, cat }
          : { elf, mtimeMs, cat: { vars: [], byName: new Map(), note: 'readelf 解析失败' } };
        this.dwarfLoading = undefined;
      });
    }
    await this.dwarfLoading;
    return this.dwarfCache?.cat ?? empty;
  }

  /** 用 DWARF 目录解析未定条目（地址+完整类型），返回是否有变化 */
  /**
   * 用 DWARF 目录解析条目。除未解析条目外，**已解析条目也会刷新类型**——
   * 旧版本持久化的 type 可能是历史 bug（如 8 位类型落 opaque）的产物，
   * 类型变化时重建子节点（展开状态重置一次属预期）。
   */
  private async applyDwarf(): Promise<boolean> {
    // 已判定「不在 ELF 中」的条目不再尝试解析——除非重编译后门禁解除标红
    const pending = this.entries.filter(
      (e) => e.addr === undefined && !e.memRef && e.resolveFailed !== true,
    );
    // memRef 条目（断点捕获）若 DWARF 按名命中静态地址，同样以 DWARF 为准（memRef 句柄会过期）
    const refreshable = this.entries.filter(
      (e) => !e.explicitType && (e.addr !== undefined || e.memRef),
    );
    if (pending.length === 0 && refreshable.length === 0) {
      return false;
    }
    const cat = await this.ensureDwarf();
    if (cat.byName.size === 0) {
      const now = Date.now();
      if (!this.lastEmptySymLog || now - this.lastEmptySymLog > 10_000) {
        this.lastEmptySymLog = now;
        this.deps.log(
          cat.note
            ? `变量监控: ${cat.note}——全局/静态/数组将无法按名解析`
            : '变量监控: 无 DWARF 变量可用（缺 ELF/readelf？）',
        );
      }
      return false;
    }
    let changed = false;
    let refreshed = 0;
    for (const e of pending) {
      const v = cat.byName.get(e.expr.replace(/^&/, '').trim());
      if (!v) {
        continue;
      }
      // DWARF 里地址为 0 = 未实例化（extern 无定义/被消除，链接器填 0）：
      // 读 0 读到向量表全是乱码。直接判「不在 ELF 中」，不给地址不读取。
      if (v.addr === 0) {
        e.resolveFailed = true;
        e.resolveTries = 3;
        e.addr = undefined;
        e.capturedValue = undefined;
        e.memRef = undefined;
        e.varRef = undefined;
        e.children = undefined;
        changed = true;
        this.deps.log(`变量监控: ${e.expr} 的 DWARF 地址为 0（未实例化/被优化消除），视为不存在`);
        continue;
      }
      e.addr = v.addr;
      e.srcFile = v.file;
      e.scope = v.scope;
      if (!e.explicitType) {
        e.type = v.type;
        e.typeLabel = v.type.label;
        const lf = legacyFieldsOf(v.type, AGG_READ_CAP);
        e.kind = lf.kind;
        e.bytes = lf.bytes;
      }
      e.resolveFailed = false;
      e.resolveTries = 0;
      changed = true;
      const agg =
        v.type.cat === 'array'
          ? `，数组 ${(v.type as { count?: number }).count ?? '?'} 项，可展开`
          : v.type.cat === 'struct'
            ? `，结构体 ${(v.type as { members?: unknown[] }).members?.length ?? 0} 成员，可展开`
            : '';
      this.deps.log(
        `变量监控: ${e.expr} @ 0x${v.addr.toString(16).toUpperCase()} ${v.type.label} (${v.size}B${agg}) — 来自 DWARF`,
      );
    }
    // 已解析条目：类型与目录不一致（旧版本遗留错误解析）时刷新并重建子节点
    for (const e of refreshable) {
      const v = cat.byName.get(e.expr.replace(/^&/, '').trim());
      if (!v) {
        // 挂着持久化地址但 DWARF 查无此名：再对 nm 符号表兜底确认。
        // nm 也查无 = 已删除。nm 命中 = static/汇编符号（nm 视角不同），保留。
        if (e.addr !== undefined && !e.explicitType && !e.memRef) {
          const sym = await this.ensureSymbols();
          if ((cat.byName.size > 0 || sym.size > 0) && !sym.get(e.expr.replace(/^&/, '').trim())) {
            e.resolveFailed = true;
            e.resolveTries = 3;
            e.addr = undefined;
            e.children = undefined;
            e.capturedValue = undefined;
            e.memRef = undefined;
            e.varRef = undefined;
            changed = true;
            this.deps.log(`变量监控: ${e.expr} 已不在 ELF 中（重编译后被删除），停止读取旧地址`);
          }
        }
        continue;
      }
      // 按名命中：清早前的失败标记——除非 DWARF 地址为 0（未实例化，见下）
      if ((e.resolveFailed || e.resolveTries) && v.addr !== 0) {
        e.resolveFailed = false;
        e.resolveTries = 0;
      }
      // DWARF 地址为 0 = 未实例化（extern 无定义/被优化消除，链接器填 0）：
      // 读取会得到向量表乱码。清地址、标红，不再读取。
      if (v.addr === 0) {
        if (e.addr !== undefined || e.resolveFailed !== true) {
          e.resolveFailed = true;
          e.resolveTries = 3;
          e.addr = undefined;
          e.capturedValue = undefined;
          e.memRef = undefined;
          e.varRef = undefined;
          e.children = undefined;
          changed = true;
          this.deps.log(`变量监控: ${e.expr} 的 DWARF 地址为 0（未实例化/被优化消除），视为不存在`);
        }
        continue;
      }
      // 地址变了也要刷新：重编译后符号在 Flash/RAM 里的位置会移动，
      // 旧地址读出来全是乱码（类型对、数据错就是这种）
      // 指针缺被指类型（旧版解析遗留）也算过期，否则解引用展不开
      const stale =
        !e.type ||
        e.type.cat !== v.type.cat ||
        e.typeLabel !== v.type.label ||
        e.bytes !== legacyFieldsOf(v.type, AGG_READ_CAP).bytes ||
        e.addr !== v.addr ||
        (e.type.cat === 'ptr' && v.type.cat === 'ptr' && !e.type.elem && !!v.type.elem);
      if (!stale) {
        continue;
      }
      const addrMoved = e.addr !== v.addr;
      e.type = v.type;
      e.typeLabel = v.type.label;
      const lf = legacyFieldsOf(v.type, AGG_READ_CAP);
      e.kind = lf.kind;
      e.bytes = lf.bytes;
      // DWARF 静态地址是权威：清掉过期的断点捕获句柄，读取走 DWARF 地址
      if (e.memRef || e.varRef) {
        e.memRef = undefined;
        e.varRef = undefined;
        changed = true;
      }
      if (addrMoved) {
        if (e.addr !== undefined) {
          this.deps.log(
            `变量监控: ${e.expr} 地址已更新 0x${e.addr.toString(16)} → 0x${v.addr.toString(16)}（重编译后符号移动）`,
          );
        }
        e.addr = v.addr;
        e.children = undefined; // 子节点地址随父节点重建（保留展开状态）
      } else {
        e.children = undefined;
        e.expanded = false;
      }
      refreshed++;
      changed = true;
    }
    if (refreshed > 0) {
      this.deps.log(`变量监控: 已刷新 ${refreshed} 个条目的类型（旧版本解析遗留修正）`);
      void this.persist();
    }
    return changed;
  }

  /** 会话状态变化时通知 webview（显示/隐藏「未在调试中」提示） */
  private pushSessionState(on: boolean): void {
    if (this.lastSessionOn === on) {
      return;
    }
    this.lastSessionOn = on;
    void this.view?.webview.postMessage({ cmd: 'session', on });
  }

  /** 指针解引用子节点：地址 = 父指针的运行时值（读取周期解析，静态 addr 无效） */
  private derefChild(t: TypeDesc, parentPath: string): WatchChild {
    const elem = (t as { elem?: TypeDesc }).elem!;
    const lf = legacyFieldsOf(elem, AGG_READ_CAP);
    return {
      name: '→ ' + elem.label,
      path: (parentPath ? parentPath + '.' : '') + '*',
      kind: lf.kind,
      typeLabel: elem.label,
      bytes: lf.bytes,
      type: elem,
      deref: true,
    };
  }

  /**
   * 存在性门禁（事件触发，不进读取周期）：
   * - 打开面板/开调试时一次；添加变量时一次；重编译后（ELF mtime 变化）一次。
   * 挂地址的具名条目逐个对照 nm 符号表，ELF 查无此名 → 清地址、标红「不在 ELF 中」；
   * 符号恢复 → 解除标红重新解析。手动 0x地址 与断点捕获条目不受影响。
   */
  private async enforceElfMembership(): Promise<boolean> {
    const elf = await this.deps.getElf();
    if (!elf) {
      return false; // ELF 未就绪：跳过，不误杀
    }
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(elf).mtimeMs;
    } catch {
      return false;
    }
    // ELF 未变化且本会话已核验过：不重复跑（闪烁根因就是周期性反复判定）
    if (this.membershipElf === elf + '|' + mtimeMs) {
      return false;
    }
    this.membershipElf = elf + '|' + mtimeMs;
    const named = this.entries.filter(
      (e) => !e.explicitType && !e.memRef && e.resolveFailed !== true,
    );
    if (named.length === 0) {
      return false;
    }
    const sym = await this.ensureSymbols();
    if (sym.size === 0) {
      return false; // 无符号表可用：无法判定，跳过
    }
    let changed = false;
    for (const e of named) {
      const name = e.expr.replace(/^&/, '').trim();
      if (sym.has(name)) {
        continue;
      }
      // nm 查无 ≠ 一定不存在：static 变量默认不出现在 nm --defined-only 输出。
      // 再查 DWARF 目录——DWARF 命中且地址有效（≠0）则放行（交由 DWARF 重对管理），
      // DWARF 也查无（或地址为 0）才判死。
      const cat = await this.ensureDwarf();
      const dv = cat.byName.get(name);
      if (dv && dv.addr !== 0) {
        continue;
      }
      e.resolveFailed = true;
      e.resolveTries = 3;
      e.addr = undefined;
      e.capturedValue = undefined;
      e.memRef = undefined;
      e.varRef = undefined;
      e.children = undefined;
      changed = true;
      this.deps.log(`变量监控: ${e.expr} 不在 ELF 中（已删除/未编译/未实例化），停止读取`);
    }
    if (changed) {
      await this.persist();
      this.postEntries();
    }
    return changed;
  }

  private async refresh(intervalMs: number): Promise<void> {
    const s = this.deps.getSession();
    this.pushSessionState(!!s);
    if (!s || this.entries.length === 0) {
      return;
    }
    // DWARF 优先解析（离线，零停顿）；新解析出类型/地址时同步条目（类型/地址列即时更新）。
    // 已解析条目也要周期性重对：重编译后符号地址会移动（类型对、数据乱码就是这种）
    if (
      this.entries.some((e) => e.addr === undefined && !e.memRef) ||
      Date.now() - this.lastDwarfApply > 5000
    ) {
      this.lastDwarfApply = Date.now();
      if (await this.applyDwarf()) {
        this.postEntries();
      }
    }
    const results: Record<
      string,
      { hex: string; ok: boolean; bytes: number; addr: number; value: string }
    > = {};
    const childVals: Record<
      string,
      Record<string, { hex?: string; value?: string; ok: boolean }>
    > = {};

    // ---- 数值地址条目：相邻地址合并成段读 ----
    // DAP 每请求的往返开销 ~1-3ms，远大于字节传输本身（SWD 8MHz 传 1KB 才 ~1ms）；
    // 同一编译单元的全局量通常相邻，N 个条目常能并成 1-2 次请求读完
    const SPAN_GAP = 64;
    const SPAN_MAX = 1024;
    const spanEntries = this.entries.filter((e) => e.addr !== undefined && (e.type || !e.memRef));
    const spans: { start: number; end: number; items: WatchEntry[] }[] = [];
    for (const e of [...spanEntries].sort((a, b) => a.addr! - b.addr!)) {
      const want = e.type ? Math.max(4, Math.min(e.bytes, AGG_READ_CAP)) : e.bytes;
      const end = e.addr! + want;
      const last = spans[spans.length - 1];
      if (last && e.addr! - last.end <= SPAN_GAP && end - last.start <= SPAN_MAX) {
        last.end = Math.max(last.end, end);
        last.items.push(e);
      } else {
        spans.push({ start: e.addr!, end, items: [e] });
      }
    }
    const decodeFrom = (e: WatchEntry, block: Buffer | undefined): void => {
      if (e.type) {
        childVals[e.expr] = {};
        if (block) {
          const want = Math.min(e.bytes, AGG_READ_CAP);
          const needBytes = e.type.cat === 'array' || e.type.cat === 'struct' ? 1 : e.bytes;
          const d = decodeByType(block.subarray(0, Math.min(block.length, e.bytes)), e.type);
          results[e.expr] = {
            hex: d.hex,
            value: d.value,
            ok: block.length >= Math.min(needBytes, want),
            bytes: e.bytes,
            addr: e.addr!,
          };
          if (e.expanded && e.children) {
            decodeTypedSubtree(block, e.addr!, e.children, childVals[e.expr]);
          }
        } else {
          results[e.expr] = { hex: '…', ok: false, bytes: e.bytes, addr: e.addr!, value: '' };
        }
        return;
      }
      if (block && block.length > 0) {
        results[e.expr] = {
          hex: toHexLE(block, e.bytes * 8),
          value: decodeTyped(block, e.kind),
          ok: true,
          bytes: e.bytes,
          addr: e.addr ?? 0,
        };
      } else {
        results[e.expr] = { hex: '…', ok: false, bytes: e.bytes, addr: e.addr ?? 0, value: '' };
      }
    };
    await Promise.all(
      spans.map(async (sp) => {
        const buf = await readBlock(s, sp.start, sp.end - sp.start);
        for (const e of sp.items) {
          decodeFrom(e, buf ? buf.subarray(e.addr! - sp.start) : undefined);
        }
      }),
    );

    // ---- memRef 通路（断点捕获的局部变量句柄，无法按地址合并，逐个读） ----
    const readOne = async (e: WatchEntry) => {
      if (!e.memRef) {
        return;
      }
      try {
        const r = (await s.customRequest('readMemory', {
          memoryReference: e.memRef,
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
        // 读取失败（探针瞬断等）：该条目本轮显示 …
      }
      results[e.expr] = { hex: '…', ok: false, bytes: e.bytes, addr: e.addr ?? 0, value: '' };
    };
    await Promise.all(
      this.entries.filter((e) => !e.type && e.memRef).map((e) => readOne(e)),
    );

    // 展开条目的子节点（DAP 捕获路径）：数组按基址整块读后切片；独立 memRef 逐个读
    for (const e of this.entries) {
      if (e.type || !e.expanded || !e.children || e.children.length === 0) {
        continue;
      }
      childVals[e.expr] = childVals[e.expr] ?? {};
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
            childVals[e.expr][c.path || c.name] = {
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
                childVals[e.expr][c.path || c.name] = {
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

    // ---- 可见子节点按需补读（大数组/结构体：只读视口内的行，滚动到哪读到哪） ----
    // 根块前 256B 已解出的行跳过；指针解引用子节点走 derefTarget 通路，这里不重复
    if (this.visKeys.size > 0) {
      const pend: { e: WatchEntry; c: WatchChild; t: TypeDesc }[] = [];
      for (const k of this.visKeys) {
        const sep = k.indexOf('#');
        if (sep <= 0) {
          continue;
        }
        const e = this.entries.find((x) => x.expr === k.slice(0, sep));
        if (!e || !e.type || !e.expanded || !e.children) {
          continue;
        }
        const path = k.slice(sep + 1);
        if (!path || (childVals[e.expr]?.[path]?.ok)) {
          continue; // 根块已覆盖：本轮已有新值，不重复读
        }
        const c = this.findChild(e, path);
        if (!c || c.deref || c.addr === undefined || !c.type) {
          continue;
        }
        // 已展开的聚合行不整块读：可见的叶子行会各自请求
        if (c.expanded && c.children && c.children.length > 0) {
          continue;
        }
        pend.push({ e, c, t: c.type });
      }
      const vspans: { start: number; end: number; items: { e: WatchEntry; c: WatchChild; t: TypeDesc }[] }[] = [];
      for (const p of [...pend].sort((a, b) => a.c.addr! - b.c.addr!)) {
        const agg = p.t.cat === 'array' || p.t.cat === 'struct';
        const want = agg ? Math.min(p.c.bytes, AGG_READ_CAP) : p.c.bytes;
        const end = p.c.addr! + Math.max(1, want);
        const last = vspans[vspans.length - 1];
        if (last && p.c.addr! - last.end <= SPAN_GAP && end - last.start <= SPAN_MAX) {
          last.end = Math.max(last.end, end);
          last.items.push(p);
        } else {
          vspans.push({ start: p.c.addr!, end, items: [p] });
        }
      }
      await Promise.all(
        vspans.map(async (sp) => {
          const buf = await readBlock(s, sp.start, sp.end - sp.start);
          for (const p of sp.items) {
            const agg = p.t.cat === 'array' || p.t.cat === 'struct';
            const want = agg ? Math.min(p.c.bytes, AGG_READ_CAP) : p.c.bytes;
            const off = p.c.addr! - sp.start;
            const slice = buf ? buf.subarray(off, off + want) : undefined;
            const d = decodeByType(slice, p.t);
            const need = agg ? 1 : p.c.bytes;
            childVals[p.e.expr] = childVals[p.e.expr] ?? {};
            childVals[p.e.expr][p.c.path || p.c.name] = {
              hex: d.hex,
              value: d.value,
              ok: !!slice && slice.length >= Math.min(need, Math.max(1, want)),
            };
          }
        }),
      );
    }

    // ---- 指针解引用：目标地址 = 父指针的运行时值（旁路读，零停机） ----
    const derefTarget = async (
      addr: number,
      dc: WatchChild,
      out: Record<string, { hex?: string; value?: string; ok: boolean }>,
    ): Promise<void> => {
      if (!Number.isFinite(addr) || addr <= 0) {
        out[dc.path] = { value: addr === 0 ? 'NULL' : '…', ok: addr === 0 };
        return;
      }
      const t = dc.type;
      const charish = !!t && t.cat === 'scalar' && (t.kind === 'u8' || t.kind === 'i8');
      const want = charish ? 128 : Math.min(Math.max(4, dc.bytes), AGG_READ_CAP);
      const buf = await readBlock(s, addr, want);
      if (!buf) {
        out[dc.path] = { value: '…', ok: false };
        return;
      }
      if (charish) {
        // char*：NUL 截止字符串（不可打印字节转 \xNN）
        let str = '';
        for (const b of buf) {
          if (b === 0) {
            break;
          }
          str += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '\\x' + b.toString(16).padStart(2, '0');
        }
        out[dc.path] = { value: '"' + (str.length > 96 ? str.slice(0, 96) + '…' : str) + '"', ok: true };
        return;
      }
      const d = decodeByType(buf, t);
      out[dc.path] = { hex: d.hex, value: d.value, ok: true };
      // deref 节点再展开（结构体成员/数组元素）：子树按偏移物化，以 0 为基解码
      if (dc.expanded && dc.children) {
        decodeTypedSubtree(buf, 0, dc.children, out);
      }
    };
    const derefWalk = async (
      out: Record<string, { hex?: string; value?: string; ok: boolean }>,
      nodes?: WatchChild[],
    ): Promise<void> => {
      for (const c of nodes ?? []) {
        if (c.type?.cat === 'ptr' && c.expanded && c.children) {
          const dc = c.children.find((x) => x.deref);
          const pv = out[c.path];
          if (dc && pv) {
            const addr = parseInt((pv.hex || pv.value || '0').replace(/^0x/i, ''), 16) || 0;
            await derefTarget(addr, dc, out);
          }
        }
        if (c.children) {
          await derefWalk(out, c.children);
        }
      }
    };
    for (const e of this.entries) {
      const out = (childVals[e.expr] = childVals[e.expr] ?? {});
      if (e.type?.cat === 'ptr' && e.expanded && e.children) {
        const dc = e.children.find((x) => x.deref);
        const rv = results[e.expr];
        if (dc) {
          const addr = parseInt((rv?.hex || rv?.value || '0').replace(/^0x/i, ''), 16) || 0;
          await derefTarget(addr, dc, out);
        }
        await derefWalk(out, dc?.children);
      } else {
        await derefWalk(out, e.children);
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

    const payload = JSON.stringify([results, childVals]);
    if (payload !== this.lastValuesJson) {
      this.lastValuesJson = payload;
      void this.view?.webview.postMessage({
        cmd: 'values',
        values: results,
        childVals,
      });
    }
    // 波形采样：数值快照始终推送（平坦曲线也需要连续时间轴；与显示无关）
    const sampleT = Date.now();
    const sampleVals: Record<string, number> = {};
    for (const e of this.entries) {
      const v = results[e.expr];
      if (!v || !v.ok || !this.isNumericEntry(e)) {
        continue;
      }
      const num = this.numericOf(e, v.value);
      if (num !== null && Number.isFinite(num)) {
        sampleVals[e.expr] = num;
      }
    }
    this.deps.onSample?.(sampleT, sampleVals);
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
      :root { --ac: #58b6f8; --ok: #4ec994; --fl: #e5c07b; --en: #c586c0; --pt: #4ec9b0; --dim: rgba(128,128,128,.3); }
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
      .wtable { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
      .wtable th { position: sticky; top: 0; z-index: 1; font-size: 10px; font-weight: 600;
        text-transform: uppercase; letter-spacing: .07em; text-align: left;
        color: var(--vscode-descriptionForeground); background: var(--vscode-sideBar-background);
        padding: 6px 8px 5px; border-bottom: 1px solid var(--dim); }
      th .rz { position: absolute; top: 0; right: 0; width: 9px; height: 100%;
        cursor: col-resize; user-select: none; z-index: 2; }
      th .rz::after { content: ''; position: absolute; top: 22%; bottom: 22%; right: 3px;
        width: 2px; border-radius: 1px; background: transparent; transition: background .12s; }
      th .rz:hover::after, th .rz.on::after { background: var(--ac); }
      .wtable td { padding: 4px 8px; text-align: left; vertical-align: middle;
        overflow: hidden; border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 9%, transparent); }
      .wtable tr:last-child td { border-bottom: none; }
      .wtable tbody tr:hover td { background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent); }
      .caret { cursor: pointer; color: var(--vscode-descriptionForeground); display: inline-block;
        width: 12px; transition: transform .12s; user-select: none; }
      .caret:hover { color: var(--ac); }
      .caret.open { transform: rotate(90deg); }
      .name { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        color: var(--vscode-symbolIcon-variableForeground, #9cdcfe); }
      .child .name { padding-left: 16px; font-weight: 400; opacity: .92; }
      .child2 .name { padding-left: 34px; font-weight: 400; opacity: .85; }
      .child3 .name { padding-left: 52px; font-weight: 400; opacity: .78; }
      .nk.scalar { color: var(--ac); }
      .nk.float { color: var(--fl); }
      .nk.enum { color: var(--en); }
      .nk.ptr { color: var(--pt); }
      .nk.bool { color: var(--ok); }
      .nk.array { color: #ce9178; }
      .nk.struct { color: #dcdcaa; }
      .nk.other { color: var(--vscode-symbolIcon-variableForeground, #9cdcfe); }
      .ty { font-family: var(--vscode-editor-font-family, monospace); font-size: 10.5px;
        color: var(--vscode-descriptionForeground); }
      .val { font-family: var(--vscode-editor-font-family, monospace); font-size: 13px;
        font-weight: 700; color: var(--ac); overflow-wrap: anywhere; }
      .val.fl { color: var(--fl); }
      .val.en { color: var(--en); }
      .val.pt { color: var(--pt); }
      .val.bo.true { color: var(--ok); }
      .val.bo.false { color: var(--vscode-descriptionForeground); }
      .val.err { color: #f14c4c; font-weight: 600; }
      .val.stale { color: var(--vscode-descriptionForeground); font-weight: 400; }
      .ad { font-family: var(--vscode-editor-font-family, monospace); font-size: 10.5px;
        color: var(--vscode-descriptionForeground); }
      @keyframes chgflash { from { background: color-mix(in srgb, var(--ac) 32%, transparent); }
        to { background: transparent; } }
      td.chg { animation: chgflash .8s ease-out; }
      .del { cursor: pointer; color: var(--vscode-descriptionForeground); text-align: center; }
      .del:hover { color: #f14c4c; }
      .empty { padding: 18px 6px; color: var(--vscode-descriptionForeground);
        text-align: center; line-height: 1.8; font-size: 12px; }
      .empty .glyph { display: block; font-size: 22px; margin-bottom: 6px; opacity: .6; }
      .nosess { position: fixed; inset: 0; z-index: 5; display: none;
        align-items: center; justify-content: center; text-align: center;
        background: color-mix(in srgb, var(--vscode-sideBar-background) 86%, transparent);
        color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.9; }
      .nosess.show { display: flex; }
      .ctx { position: fixed; z-index: 50; min-width: 176px; padding: 4px; border-radius: 8px;
        background: var(--vscode-editorWidget-background, #252526);
        border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.35));
        box-shadow: 0 6px 22px rgba(0,0,0,.4); font-size: 12px; display: none; }
      .ctx.show { display: block; }
      .ctxh { padding: 5px 8px 5px; font-family: var(--vscode-editor-font-family, monospace);
        font-weight: 700; color: var(--vscode-symbolIcon-variableForeground, #9cdcfe);
        border-bottom: 1px solid rgba(128,128,128,.22); margin-bottom: 3px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ctxi { padding: 5px 10px; border-radius: 5px; cursor: pointer;
        color: var(--vscode-foreground); display: flex; align-items: center; gap: 8px; }
      .ctxi:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.16)); }
      .ctxi.on { color: var(--ac); }
      .ctxi .mk { width: 12px; text-align: center; color: inherit; opacity: .8; }
      .ctxi.danger:hover { background: rgba(241,76,76,.14); color: #f14c4c; }
      .ctxs { height: 1px; background: rgba(128,128,128,.22); margin: 3px 6px; }
    </style></head><body>
      <div class="row">
        <input id="expr" type="text" placeholder="变量名（支持数组/结构体，ELF DWARF 自动识别类型）或 0x地址:类型，回车添加">
        <button id="add">添加</button>
        <button id="browse" class="ghost" title="浏览 ELF 全部变量（搜索/多选添加）">浏览</button>
      </div>
      <div id="list"><div class="empty"><span class="glyph">⌖</span>添加要实时监控的变量<br>全局/静态/数组/结构体：直接填变量名<br>（ELF DWARF 解析类型，可展开）<br>局部变量：打一个断点即自动捕获</div></div>
      <div class="nosess" id="nosess">未在调试中<br>启动调试后这里显示变量值</div>
      <div class="ctx" id="ctx">
        <div class="ctxh" id="ctxName"></div>
        <div class="ctxi" data-f="auto"><span class="mk">○</span>自动（跟随面板）</div>
        <div class="ctxi" data-f="dec"><span class="mk">10</span>十进制</div>
        <div class="ctxi" data-f="hex"><span class="mk">16</span>十六进制</div>
        <div class="ctxi" data-f="multi"><span class="mk">=</span>同时显示（10 = 16）</div>
        <div class="ctxi" data-f="bin"><span class="mk">01</span>二进制</div>
        <div class="ctxi" data-f="char"><span class="mk">A</span>字符</div>
        <div class="ctxs"></div>
        <div class="ctxi" id="ctxSet"><span class="mk">✎</span>设置值…</div>
        <div class="ctxi danger" id="ctxDel"><span class="mk">✕</span>移除此变量</div>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        const state = { entries: [], vals: {}, childVals: {}, timer: null, interval: 200, fmt: 'dec', paused: false,
                        colw: [34, 20, 30, 16] };
        const $ = (id) => document.getElementById(id);
        const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
        function post(m) { vscode.postMessage(m); }

        // —— 增量渲染：结构只在条目变化时重建；周期刷新仅写发生变化的单元格 ——
        // （此前每次刷新 innerHTML 整表重建：点击落在重建瞬间被吞掉——删除/展开
        //   "点不动"的根源，且全量重绘开销大）
        const cells = new Map();      // 'v:key' / 'a:key' → 单元格元素
        const cellText = new Map();   // 'v:key' / 'a:key' → 上次写入的 text|class

        function rowKey(expr, path) { return expr + '#' + (path || ''); }

        function nodeExpandable(n) {
          if (n.children && n.children.length > 0) return true;
          if (n.type) return n.type.cat === 'array' ? n.type.count > 0
            : n.type.cat === 'struct' ? n.type.members.length > 0
            : n.type.cat === 'ptr' ? !!n.type.elem : false;
          return false;
        }
        function rootExpandable(e) {
          return !!(e.children && e.children.length > 0) || !!e.varRef || nodeExpandable(e);
        }
        /** 值颜色：整数蓝 / 浮点琥珀 / 枚举紫 / 指针青 / 布尔绿灰（按 DWARF 类型） */
        function kindSuffix(node, text) {
          const t = node && node.type;
          if (t) {
            if (t.cat === 'enum') return ' en';
            if (t.cat === 'bool') return ' bo' + (text === 'false' ? ' false' : ' true');
            if (t.cat === 'ptr') return ' pt';
            if (t.cat === 'scalar' && (t.kind === 'f32' || t.kind === 'f64')) return ' fl';
            return '';
          }
          if (node && (node.kind === 'f32' || node.kind === 'f64')) return ' fl';
          return '';
        }
        /** 0x 十六进制串 → 按 4 位分组的二进制（聚合无 hex 返回空） */
        function hexToBin(hex) {
          if (!hex || hex.indexOf('0x') !== 0) return '';
          const bits = (hex.length - 2) * 4;
          try {
            return BigInt(hex).toString(2).padStart(bits, '0').replace(/(.{4})(?=.)/g, '$1 ');
          } catch (e) { return ''; }
        }
        function valOf(v, node, f) {
          if (v && v.ok) {
            let text;
            if (f === 'multi') {
              // 同时显示（dec = 0x hex）：缺其一退回单显（浮点/布尔通常只有十进制）
              const d = v.value || '';
              const h = v.hex || '';
              text = (d && h) ? (d + ' = ' + h) : (d || h || '…');
            }
            else if (f === 'hex') text = v.hex || v.value || '…';
            else if (f === 'bin') text = hexToBin(v.hex) || v.value || '…';
            else if (f === 'char') {
              // 字符显示：按低字节取 ASCII，可打印显示 'X'，否则回落十进制
              const b = v.hex ? parseInt(v.hex.slice(2), 16) & 0xff : NaN;
              text = (Number.isFinite(b) && b >= 0x20 && b < 0x7f)
                ? "'" + String.fromCharCode(b) + "'"
                : (v.value || v.hex || '…');
            }
            else text = (v.value && v.value !== '') ? v.value : (v.hex || '…');
            return { text: text, cls: 'val' + kindSuffix(node, text) };
          }
          if (node && node.resolveFailed && node.addr === undefined && !node.memRef) {
            return { text: '不在 ELF 中', cls: 'val err' };
          }
          if (node && node.capturedValue) return { text: node.capturedValue, cls: 'val stale' };
          return { text: '…', cls: 'val stale' };
        }
        function addrTextOf(expr, path, node) {
          if (path) {
            if (node.addr !== undefined) return '0x' + node.addr.toString(16).toUpperCase();
            if (node.memRef && /^0x/.test(node.memRef)) return node.memRef.toUpperCase();
            return '⏸';
          }
          const rv = state.vals[expr];
          const a = rv && rv.addr !== undefined ? rv.addr : node.addr;
          if (a !== undefined) return '0x' + a.toString(16).toUpperCase();
          if (node.memRef) return '已捕获';
          return node.resolveFailed ? '无法解析' : '解析中…';
        }
        function caretHtml(expr, path, expanded) {
          return '<span class="caret' + (expanded ? ' open' : '') + '" data-x="' + esc(expr) +
            '" data-p="' + esc(path || '') + '">▶</span>';
        }
        /** 名称着色的类型分类（标量/浮点/枚举/指针/布尔/数组/结构体） */
        function kindOf(n) {
          const t = n && n.type;
          if (!t) {
            return 'other';
          }
          if (t.cat === 'array') return 'array';
          if (t.cat === 'struct') return 'struct';
          if (t.cat === 'ptr') return 'ptr';
          if (t.cat === 'enum') return 'enum';
          if (t.cat === 'bool') return 'bool';
          if (t.cat === 'scalar' && (t.kind === 'f32' || t.kind === 'f64')) return 'float';
          return 'scalar';
        }
        const HIDDEN_CARET = '<span class="caret" style="visibility:hidden">▶</span>';
        function rowHtml(cls, expr, path, name, caret, typeLabel, tip, isRoot, node) {
          const kt = node && node.type && node.type.label ? ' title="' + esc(node.type.label) + '"' : '';
          return '<tr class="' + cls + '" data-e="' + esc(expr) + '" data-p="' + esc(path || '') + '"' +
            (isRoot ? ' data-root="1"' : '') + '>' +
            '<td class="name"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + caret +
            '<span class="nk ' + kindOf(node) + '"' + kt + '>' + esc(name) + '</span></td>' +
            '<td class="ty">' + esc(typeLabel) + '</td>' +
            '<td class="val" data-vk="' + esc(rowKey(expr, path)) + '">…</td>' +
            '<td class="ad" data-ak="' + esc(rowKey(expr, path)) + '">…</td>' +
            (isRoot
              ? '<td class="del" data-del="' + esc(expr) + '" title="移除">✕</td>'
              : '<td></td>') + '</tr>';
        }
        function childRowsHtml(e, children, depth) {
          const cls = depth >= 3 ? 'child3' : depth === 2 ? 'child2' : 'child';
          let h = '';
          for (const c of children) {
            const caret = nodeExpandable(c) ? caretHtml(e.expr, c.path || '', c.expanded) : HIDDEN_CARET;
            h += rowHtml(cls, e.expr, c.path || c.name, c.name, caret, c.typeLabel, '', false, c);
            if (c.expanded && c.children && c.children.length > 0) {
              h += childRowsHtml(e, c.children, depth + 1);
            }
          }
          if (children.length > 0 && children[children.length - 1].truncated) {
            h += '<tr class="' + cls + '"><td class="name">…（元素较多，仅显示前 ' + children.length + ' 项）</td><td></td><td></td><td></td><td></td></tr>';
          }
          return h;
        }

        /** 结构重建：仅在条目/展开状态变化时调用（用户操作触发，无点击竞争） */
        function renderStructure() {
          const list = $('list');
          if (state.entries.length === 0) {
            list.innerHTML = '<div class="empty"><span class="glyph">⌖</span>添加要实时监控的变量<br>全局/静态/数组/结构体：直接填变量名<br>（ELF DWARF 解析类型，可展开）<br>局部变量：打一个断点即自动捕获</div>';
            cells.clear(); cellText.clear();
            visObs && (visObs.disconnect(), visSeen.clear(), sendVis());
            return;
          }
          let h = '<table class="wtable">' +
            '<colgroup>' + state.colw.map((w) => '<col style="width:' + w + '%">').join('') +
            '<col style="width:26px"></colgroup>' +
            '<thead><tr>' +
            '<th>变量名<span class="rz" data-c="0" title="拖动调整列宽，双击复位"></span></th>' +
            '<th>类型<span class="rz" data-c="1" title="拖动调整列宽，双击复位"></span></th>' +
            '<th>值<span class="rz" data-c="2" title="拖动调整列宽，双击复位"></span></th>' +
            '<th>地址<span class="rz" data-c="3" title="拖动调整列宽，双击复位"></span></th>' +
            '<th></th></tr></thead><tbody>';
          for (const e of state.entries) {
            const tip = [e.srcFile ? '文件: ' + e.srcFile : '',
                         e.scope !== undefined && e.scope !== null ? '作用域: ' + (e.scope === '' ? '文件级 static' : e.scope + '()') : ''].filter(Boolean).join('\\n');
            const caret = rootExpandable(e) ? caretHtml(e.expr, '', e.expanded) : '';
            h += rowHtml('', e.expr, '', e.expr, caret, e.typeLabel, tip, true, e);
            if (e.expanded && e.children && e.children.length > 0) {
              h += childRowsHtml(e, e.children, 1);
            }
          }
          h += '</tbody></table>';
          list.innerHTML = h;
          cells.clear(); cellText.clear();
          for (const el of list.querySelectorAll('[data-vk]')) cells.set('v:' + el.getAttribute('data-vk'), el);
          for (const el of list.querySelectorAll('[data-ak]')) cells.set('a:' + el.getAttribute('data-ak'), el);
          patchValues();
          observeRows();
        }

        function setCell(key, text, cls) {
          const prev = cellText.get(key);
          if (prev === text + '|' + cls) return;
          cellText.set(key, text + '|' + cls);
          const el = cells.get(key);
          if (!el) return;
          el.textContent = text;
          el.className = cls;
          // 值变化 → 闪烁一下（调试器的"变化即高亮"）；首次填充（重建后）不闪
          if (prev !== undefined && prev.split('|')[0] !== text) {
            el.classList.remove('chg');
            void el.offsetWidth; // 重启动画
            el.classList.add('chg');
            clearTimeout(el._t);
            el._t = setTimeout(() => el.classList.remove('chg'), 800);
          }
        }

        /** 遍历当前结构中的每一行（与 renderStructure 生成的行一一对应）；
         *  第三个参数是该节点的有效显示进制（节点覆盖 ← 最近祖先覆盖 ← 面板全局） */
        function eachRow(fn) {
          const effOf = (n, inh) => (n.fmt && n.fmt !== 'auto' ? n.fmt : inh);
          const walk = (e, children, inh) => {
            for (const c of children) {
              const eff = effOf(c, inh);
              fn(e, c, eff);
              if (c.expanded && c.children && c.children.length > 0) walk(e, c.children, eff);
            }
          };
          for (const e of state.entries) {
            const eff0 = effOf(e, state.fmt);
            fn(e, null, eff0);
            if (e.expanded && e.children && e.children.length > 0) walk(e, e.children, eff0);
          }
        }

        /** 视口可见行上报：宿主只补读屏幕内的行（大数组滚动到哪读到哪） */
        const visSeen = new Set();
        let visTimer = null;
        const visObs = 'IntersectionObserver' in window
          ? new IntersectionObserver((ents) => {
              for (const en of ents) {
                const k = en.target.getAttribute('data-vk');
                if (k) { if (en.isIntersecting) visSeen.add(k); else visSeen.delete(k); }
              }
              if (!visTimer) visTimer = setTimeout(sendVis, 150);
            }, { threshold: 0 }) : null;
        function sendVis() {
          visTimer = null;
          if (visObs) post({ cmd: 'vis', keys: [...visSeen] });
        }
        function observeRows() {
          if (!visObs) return;
          visObs.disconnect();
          visSeen.clear();
          document.querySelectorAll('#list tr[data-p]').forEach((tr) => {
            if (!tr.getAttribute('data-p')) return; // 根行随整块读取，不参与按行补读
            const vc = tr.querySelector('td[data-vk]');
            if (vc) visObs.observe(vc);
          });
          sendVis();
        }

        /** 周期刷新入口：只写发生变化的单元格，不重建 DOM */
        function patchValues() {
          if (state.entries.length === 0) return;
          eachRow((e, c, eff) => {
            const path = c ? (c.path || c.name) : '';
            const key = rowKey(e.expr, path);
            const v = c ? (state.childVals[e.expr] || {})[path] : state.vals[e.expr];
            const vo = valOf(v, c || e, eff);
            setCell('v:' + key, vo.text, vo.cls);
            setCell('a:' + key, addrTextOf(e.expr, path, c || e), 'ad');
          });
        }

        function tick() {
          if (state.entries.length === 0) return;
          post({ cmd: 'read', interval: state.interval });
        }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.cmd === 'session') {
            $('nosess').classList.toggle('show', !m.on);
          } else if (m.cmd === 'entries') {
            state.entries = m.entries || [];
            state.fmt = m.fmt || 'dec';
            if (m.colw && m.colw.length === 4) state.colw = m.colw;
            state.childVals = {};
            renderStructure();
          } else if (m.cmd === 'values') {
            state.vals = m.values || {};
            // 合并而非整表替换：视口外未采样的行保留上次值（可见行由 vis 机制补读）
            for (const ex in (m.childVals || {})) {
              state.childVals[ex] = Object.assign(state.childVals[ex] || {}, m.childVals[ex]);
            }
            patchValues();
          }
        });

        // 事件委托：监听器挂在容器上（容器自身不重建），点击不再被周期刷新吞掉
        $('list').addEventListener('click', (ev) => {
          const t = ev.target instanceof Element ? ev.target : null;
          if (!t) return;
          const del = t.closest('.del');
          if (del && del.hasAttribute('data-del')) {
            post({ cmd: 'remove', expr: del.getAttribute('data-del') });
            return;
          }
          const caret = t.closest('.caret');
          if (caret && caret.hasAttribute('data-x')) {
            post({ cmd: 'expand', expr: caret.getAttribute('data-x'), path: caret.getAttribute('data-p') || '' });
          }
        });

        // —— 右键菜单：单条目显示进制（子元素继承）+ 快捷移除 ——
        const ctxEl = $('ctx');
        let ctxTarget = null;
        function hideCtx() { ctxEl.classList.remove('show'); ctxTarget = null; }
        function findNode(expr, path) {
          let hit = null;
          eachRow((e, c, eff) => {
            const p = c ? (c.path || c.name) : '';
            if (!hit && e.expr === expr && p === path) {
              hit = { node: c || e, eff: eff };
            }
          });
          return hit;
        }
        function showCtx(x, y, expr, path, isRoot, node) {
          ctxTarget = { expr: expr, path: path };
          $('ctxName').textContent = expr + (path || '');
          const cur = node && node.fmt ? node.fmt : 'auto';
          ctxEl.querySelectorAll('.ctxi[data-f]').forEach((it) => {
            it.classList.toggle('on', it.getAttribute('data-f') === cur);
          });
          $('ctxSet').style.display = (node && node.type &&
            (node.type.cat === 'array' || node.type.cat === 'struct')) ? 'none' : '';
          $('ctxDel').style.display = isRoot ? '' : 'none';
          ctxEl.classList.add('show');
          const r = ctxEl.getBoundingClientRect();
          ctxEl.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 6)) + 'px';
          ctxEl.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 6)) + 'px';
        }
        $('list').addEventListener('contextmenu', (ev) => {
          const t = ev.target instanceof Element ? ev.target : null;
          const tr = t ? t.closest('tr') : null;
          hideCtx();
          if (!tr || !tr.getAttribute('data-e')) {
            return;
          }
          ev.preventDefault();
          const expr = tr.getAttribute('data-e');
          const path = tr.getAttribute('data-p') || '';
          const isRoot = tr.getAttribute('data-root') === '1';
          const found = findNode(expr, path);
          showCtx(ev.clientX, ev.clientY, expr, path, isRoot, found ? found.node : null);
        });
        ctxEl.addEventListener('click', (ev) => {
          const it = ev.target instanceof Element ? ev.target.closest('.ctxi') : null;
          if (!it || !ctxTarget) {
            return;
          }
          if (it.id === 'ctxSet') {
            const cell = cells.get('v:' + ctxTarget.expr + '#' + (ctxTarget.path || ''));
            post({ cmd: 'setvalue', expr: ctxTarget.expr, path: ctxTarget.path, cur: cell ? cell.textContent : '' });
          } else if (it.id === 'ctxDel') {
            post({ cmd: 'remove', expr: ctxTarget.expr });
          } else if (it.getAttribute('data-f')) {
            post({ cmd: 'fmt', expr: ctxTarget.expr, path: ctxTarget.path, fmt: it.getAttribute('data-f') });
          }
          hideCtx();
        });
        window.addEventListener('click', (ev) => {
          if (ev.target instanceof Element && ev.target.closest('#ctx')) {
            return;
          }
          hideCtx();
        });
        window.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape') {
            hideCtx();
          }
        });

        // —— 表头拖拽调列宽：与相邻列交换宽度，最小 8%；双击分隔条复位；持久化到宿主 ——
        const DEF_COLW = [34, 20, 30, 16];
        let colDrag = null;
        function applyCols() {
          const cols = $('list').querySelectorAll('col');
          for (let i = 0; i < 4 && i < cols.length; i++) {
            cols[i].style.width = state.colw[i] + '%';
          }
        }
        $('list').addEventListener('pointerdown', (ev) => {
          const rz = ev.target instanceof Element ? ev.target.closest('.rz') : null;
          if (!rz) {
            return;
          }
          ev.preventDefault();
          const tbl = rz.closest('table');
          colDrag = {
            i: +rz.getAttribute('data-c'),
            x0: ev.clientX,
            w0: state.colw.slice(),
            tblW: tbl ? tbl.getBoundingClientRect().width : 1,
            el: rz,
          };
          rz.classList.add('on');
        });
        window.addEventListener('pointermove', (ev) => {
          if (!colDrag) {
            return;
          }
          const i = colDrag.i;
          const j = i < 3 ? i + 1 : i - 1;
          const MIN = 8;
          let d = ((ev.clientX - colDrag.x0) / colDrag.tblW) * 100;
          d = Math.max(MIN - colDrag.w0[i], Math.min(colDrag.w0[j] - MIN, d));
          state.colw = colDrag.w0.slice();
          state.colw[i] = colDrag.w0[i] + d;
          state.colw[j] = colDrag.w0[j] - d;
          applyCols();
        });
        window.addEventListener('pointerup', () => {
          if (!colDrag) {
            return;
          }
          colDrag.el.classList.remove('on');
          colDrag = null;
          post({ cmd: 'colw', w: state.colw });
        });
        $('list').addEventListener('dblclick', (ev) => {
          const rz = ev.target instanceof Element ? ev.target.closest('.rz') : null;
          if (!rz) {
            return;
          }
          state.colw = DEF_COLW.slice();
          applyCols();
          post({ cmd: 'colw', w: state.colw });
        });

        function add() {
          const v = $('expr').value.trim();
          if (v) { post({ cmd: 'add', expr: v }); $('expr').value = ''; }
        }
        $('add').addEventListener('click', add);
        $('expr').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') add(); });
        $('browse').addEventListener('click', () => post({ cmd: 'browse' }));
        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (!state.paused) { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } } });
        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'run') { state.paused = !e0.data.on; if (state.paused) { if (state.timer) clearInterval(state.timer); state.timer = null; } else { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, state.interval); } } });
        state.timer = setInterval(tick, state.interval);

        post({ cmd: 'ready' });
      </script>
    </body></html>`;
  }
}
