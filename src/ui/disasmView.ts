/**
 * 「反汇编」视图：汇编与**编辑器代码**双向联动（CLion 式）。
 * 面板只有汇编（全量分片滚动）；点汇编行 → 编辑器跳到对应源码行并以同色装饰高亮；
 * 编辑器光标移动（点击/键盘）→ 面板自动滚到该行对应的指令并同色高亮。
 * 停机时按栈顶 PC 定位（蓝 + ▶）。数据：objdump -d -S -l 离线解析（ELF+mtime 缓存）。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { execFileSafe } from '../util/process';
import {
  disasmFileMatches,
  findFn,
  findInsnIndex,
  parseObjdumpDisasm,
} from '../debug/disasm';

interface DisasmDeps {
  getSession(): vscode.DebugSession | undefined;
  getElf(): Promise<string | undefined>;
  /** arm-none-eabi-objdump 完整路径，无则 undefined */
  getObjdump(): string | undefined;
  log(msg: string): void;
}

/** 跳转/初始窗口与滚动扩展的行数 */
const WINDOW = 500;
/** 联动高亮色（与 webview CSS --sel 保持一致；蓝） */
const LINK_COLOR = 'rgba(88,182,248,0.32)';

interface RowMsg {
  i: number;
  a: number;
  b: string;
  t: string;
  /** 助记符类别（语法高亮） */
  k?: string;
  f?: string;
  l?: number;
  /** 预渲染的语法高亮 HTML（宿主生成，webview 直接 innerHTML） */
  h?: string;
  /** 函数分隔行标记（该行渲染为函数头，非指令） */
  fn?: string;
}

export class DisasmViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autoCmakeFlash.disasm';
  private view?: vscode.WebviewView;
  private cache?: { elf: string; mtimeMs: number; cat: ReturnType<typeof parseObjdumpDisasm> };
  private loading?: Promise<void>;
  private halted = false;
  private linkDeco = vscode.window.createTextEditorDecorationType({
    backgroundColor: LINK_COLOR,
    isWholeLine: true,
  });
  /** 「已编译进固件」标注：行尾绿点（after 跟随代码宽度，不占 gutter/不打断点冲突） */
  private compiledDeco?: vscode.TextEditorDecorationType;

  private getCompiledDeco(): vscode.TextEditorDecorationType {
    if (!this.compiledDeco) {
      this.compiledDeco = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(78,201,148,0.07)',
        isWholeLine: true,
      });
    }
    return this.compiledDeco;
  }
  /** 上次标注缓存（key=文件|ELF）：只缓存行集合，装饰重放不设防（切回必须重放） */
  private lastDecorated?: { key: string; lines: Set<number> };
  /** 最近一次联动定位（编辑器行 → 面板），避免光标事件回环 */
  private lastLink?: { file: string; line: number };

  constructor(private readonly deps: DisasmDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((m: {
      cmd?: string;
      file?: string;
      line?: number;
      lo?: number;
      hi?: number;
    }) => {
      switch (m.cmd) {
        case 'link':
          // 汇编行点击 → 编辑器跳转 + 同色装饰
          if (m.file && m.line !== undefined) {
            this.lastLink = { file: m.file, line: m.line };
            void this.openSourceLine(m.file, m.line);
          }
          break;
        case 'range':
          if (m.lo !== undefined && m.hi !== undefined) {
            this.sendRows(m.lo, m.hi);
          }
          break;
        default:
          break;
      }
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        // 打开/切回面板：有会话先尝试停机定位；无会话则加载目录纯浏览
        // （反汇编是 objdump 离线数据，不需要调试会话）
        if (this.deps.getSession()) {
          void this.refreshAtHalt();
        } else {
          void this.browseFromStart();
        }
      }
    });
    // 面板首次打开：无会话也直接进入浏览模式
    if (view.visible && !this.deps.getSession()) {
      void this.browseFromStart();
    }
    this.pushState();
  }

  /** 无调试会话的浏览模式：加载目录，从第一条指令开始显示（纯离线，零依赖） */
  private async browseFromStart(): Promise<void> {
    await this.ensureCatalog();
    const cat = this.cache?.cat;
    if (!cat || cat.insns.length === 0) {
      this.view?.webview.postMessage({ cmd: 'nodata' });
      return;
    }
    const start = cat.fns.find((f) => /reset_handler/i.test(f.name))?.first ?? 0;
    this.pushState(undefined, undefined, undefined);
    this.sendRows(start, start + WINDOW);
  }

  /** stopped/continued 事件转发（extension 的 tracker 调用） */
  onDebugEvent(event: 'stopped' | 'continued'): void {
    if (event === 'stopped') {
      this.halted = true;
      void this.refreshAtHalt();
    } else {
      this.halted = false;
      this.pushState();
    }
  }

  onSessionEnded(): void {
    this.halted = false;
    this.pushState();
  }

  /** 编辑器右键入口：按源码 file:line 定位（离线数据，运行中可用） */
  async revealSourceLine(file: string, line: number): Promise<boolean> {
    await this.ensureCatalog();
    const idx = this.indexOfSourceLine(file, line);
    if (idx < 0) {
      this.deps.log(`反汇编: ${file}:${line} 无对应指令（未编译进 ELF 或无调试信息）`);
      return false;
    }
    this.lastLink = { file, line };
    await this.jumpTo(idx);
    return true;
  }

  /**
   * 编辑器光标联动（extension 在 onDidChangeTextEditorSelection 去抖后调用）：
   * 光标行对应的汇编滚到视口中央并高亮。面板不可见时忽略；
   * 目录未加载时自动解析（首次点击约 1s 的 objdump，之后缓存复用）。
   */
  onEditorCursor(file: string, line: number): void {
    if (!this.view?.visible) {
      return;
    }
    if (this.lastLink && this.lastLink.file === file && this.lastLink.line === line) {
      return; // 本面板触发的跳转回环
    }
    void (async () => {
      if (!this.cache) {
        await this.ensureCatalog();
      }
      if (!this.cache) {
        return;
      }
      const idx = this.indexOfSourceLine(file, line);
      if (idx < 0) {
        return;
      }
      await this.jumpTo(idx);
    })();
  }

  // ---------------- 内部 ----------------

  private async openSourceLine(file: string, line: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const editor = await vscode.window.showTextDocument(doc, { preserveFocus: true });
      const ln = Math.max(0, Math.min(doc.lineCount - 1, line - 1));
      const pos = doc.lineAt(ln).range.start;
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      editor.selection = new vscode.Selection(pos, pos);
      // 同色装饰：该编辑器整行高亮，其他编辑器清掉
      for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document.uri.fsPath === file) {
          ed.setDecorations(this.linkDeco, [new vscode.Range(ln, 0, ln, 0)]);
        } else {
          ed.setDecorations(this.linkDeco, []);
        }
      }
    } catch {
      // 源文件已移动/不存在
    }
  }

  private norm(p: string): string {
    return p.replaceAll('\\', '/').toLowerCase();
  }

  private indexOfSourceLine(file: string, line: number): number {
    const cat = this.cache?.cat;
    if (!cat) {
      return -1;
    }
    return cat.insns.findIndex(
      (x) => x.file && x.line === line && disasmFileMatches(x.file, file),
    );
  }

  /** idx 为中心下发窗口并高亮（联动琥珀；pcIdx 时叠加 PC 蓝） */
  private async jumpTo(idx: number, pcIdx?: boolean): Promise<void> {
    const cat = this.cache!.cat;
    const fn = findFn(cat.fns, cat.insns[idx].addr);
    this.pushState(fn?.name, cat.insns[idx].file, cat.insns[idx].line);
    this.sendRows(Math.max(0, idx - Math.floor(WINDOW / 2)), idx + Math.ceil(WINDOW / 2), {
      focusIdx: idx,
      pcIdx: pcIdx ? idx : undefined,
    });
  }

  /**
   * 编辑器「已编译进固件」标注：当前可见编辑器中，凡在反汇编目录里有指令的
   * 源码行右缘画绿点（CLion 式"哪行真的编译进去了"）。目录未就绪时静默跳过。
   */
  async decorateEditor(editor: vscode.TextEditor): Promise<void> {
    const file = editor.document.uri.fsPath;
    await this.ensureCatalog();
    const cache = this.cache;
    const cat = cache?.cat;
    if (!cache || !cat || cat.insns.length === 0) {
      return;
    }
    const elfKey = cache.elf;
    // 行集合缓存：同文件同 ELF 不重算 objdump 归属（重放装饰仍照常执行——
    // VS Code 在编辑器隐藏时会丢弃装饰，切回必须重放，否则绿底消失）
    let lines: Set<number> | undefined;
    const cacheKey = file + '|' + elfKey;
    if (this.lastDecorated?.key === cacheKey) {
      lines = this.lastDecorated.lines;
    }
    if (!lines) {
      const norm = this.norm(file);
      lines = new Set<number>();
      for (const ins of cat.insns) {
        if (ins.file && ins.line && this.norm(ins.file) === norm) {
          lines.add(ins.line);
        }
      }
      this.lastDecorated = { key: cacheKey, lines };
    }
    const ranges = [...lines].map((l) => new vscode.Range(
      Math.max(0, Math.min(editor.document.lineCount - 1, l - 1)), 0,
      Math.max(0, Math.min(editor.document.lineCount - 1, l - 1)), 0,
    ));
    // ensureCatalog 可能耗时（首次 objdump ~1s）：编辑器可能已切走，
    // 按文档 URI 重新找活跃编辑器应用，并重放（找不到就等下次激活）
    const target =
      vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.fsPath.toLowerCase() === file.toLowerCase(),
      ) ?? editor;
    const deco = this.getCompiledDeco();
    target.setDecorations(deco, ranges);
    if (target !== editor) {
      editor.setDecorations(deco, ranges);
    }
  }

  /** 关闭标注：清除该编辑器的「已编译」底色 */
  clearCompiledMark(editor: vscode.TextEditor): void {
    if (this.compiledDeco) {
      editor.setDecorations(this.compiledDeco, []);
    }
  }

  /** 停机刷新：栈顶 PC 定位（PC 蓝 + ▶） */
  private async refreshAtHalt(tries = 0): Promise<void> {
    const s = this.deps.getSession();
    if (!s) {
      this.pushState();
      return;
    }
    let pc: number | undefined;
    let curFile: string | undefined;
    let curLine: number | undefined;
    try {
      const th = (await s.customRequest('threads')) as { threads?: { id: number }[] };
      const tid = th?.threads?.[0]?.id;
      if (tid !== undefined) {
        const st = (await s.customRequest('stackTrace', { threadId: tid, levels: 1 })) as {
          stackFrames?: { source?: { path?: string }; line?: number; instructionPointerReference?: string }[];
        };
        const f0 = st?.stackFrames?.[0];
        if (f0?.instructionPointerReference) {
          pc = Number.parseInt(f0.instructionPointerReference, 16);
        }
        curFile = f0?.source?.path;
        curLine = f0?.line;
      }
    } catch {
      // 适配器未就绪
    }
    if (pc === undefined) {
      if (tries < 4) {
        await new Promise((r) => setTimeout(r, 400));
        return this.refreshAtHalt(tries + 1);
      }
      this.pushState();
      return;
    }
    await this.ensureCatalog();
    const cat = this.cache?.cat;
    const idx = cat ? findInsnIndex(cat.insns, pc) : -1;
    if (!cat || idx < 0) {
      this.view?.webview.postMessage({ cmd: 'nodata' });
      return;
    }
    if (curFile && curLine) {
      this.lastLink = { file: curFile, line: curLine };
    }
    await this.jumpTo(idx, true);
  }

  /** 下发汇编窗口切片（focusIdx: 联动高亮+滚动；pcIdx: PC 配色） */
  private sendRows(lo: number, hi: number, opts: { focusIdx?: number; pcIdx?: number } = {}): void {
    const cat = this.cache?.cat;
    if (!this.view || !cat || cat.insns.length === 0) {
      return;
    }
    const total = cat.insns.length;
    const l = Math.max(0, Math.min(lo, total));
    const h = Math.max(l, Math.min(hi, total));
    // 函数分隔行：窗口内每个函数起点插一条头部标记；窗口顶截断的函数补「续」
    const marks = new Map<number, string>();
    for (const f of cat.fns) {
      if (f.first >= l && f.first < h) {
        marks.set(f.first, f.name);
      }
    }
    const topFn = findFn(cat.fns, cat.insns[l].addr);
    if (topFn && topFn.first < l) {
      marks.set(l, topFn.name + '（续）');
    }
    const rows: RowMsg[] = [];
    for (let k = l; k < h; k++) {
      const mk = marks.get(k);
      if (mk !== undefined) {
        rows.push({ i: k, a: 0, b: '', t: '', fn: mk });
      }
      const x = cat.insns[k];
      rows.push({
        i: k,
        a: x.addr,
        b: x.bytes,
        t: x.text,
        k: x.kind,
        f: x.file,
        l: x.line,
        h: this.highlight(x.text, x.kind),
      });
    }
    void this.view.webview.postMessage({
      cmd: 'rows',
      lo: l,
      hi: h,
      total,
      rows,
      focusIdx: opts.focusIdx,
      pcIdx: opts.pcIdx,
    });
  }

  private pushState(fn?: string, file?: string, line?: number): void {
    // on=false（无会话）时 webview 不再显示全屏遮罩——反汇编可纯离线浏览
    void this.view?.webview.postMessage({
      cmd: 'state',
      on: true,
      halted: this.halted,
      fn,
      file,
      line,
      noSession: !this.deps.getSession(),
    });
  }

  private async ensureCatalog(): Promise<void> {
    const elf = await this.deps.getElf();
    const objdump = this.deps.getObjdump();
    if (!elf || !objdump) {
      if (!objdump) {
        this.deps.log('反汇编: 未找到 arm-none-eabi-objdump（随 ARM 工具链安装），无法解析');
      }
      return;
    }
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(elf).mtimeMs;
    } catch {
      return;
    }
    if (this.cache?.elf === elf && this.cache.mtimeMs === mtimeMs) {
      return;
    }
    if (this.loading) {
      await this.loading;
      return;
    }
    this.loading = (async () => {
      try {
        const r = await execFileSafe(objdump, ['-d', '-S', '-l', elf], { timeoutMs: 60_000 });
        const cat = parseObjdumpDisasm(r.stdout ?? '');
        this.cache = { elf, mtimeMs, cat };
        this.deps.log(`反汇编: 已解析 ${cat.insns.length} 条指令 / ${cat.fns.length} 个函数`);
        // 解析完成时目录从无到有：补一次当前 C/C++ 编辑器的「已编译」标注
        const ed = vscode.window.activeTextEditor;
        if (ed && /^(c|cpp)$/.test(ed.document.languageId)) {
          void this.decorateEditor(ed);
        }
      } catch (e) {
        this.deps.log(`反汇编: objdump 解析失败 — ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.loading = undefined;
      }
    })();
    await this.loading;
  }

  /** 汇编文本 → 语法高亮 HTML（助记符按类别着色；寄存器/立即数/注释/标签分色） */
  private highlight(text: string, kind?: string): string {
    const esc = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 整行注释（@ 开头）灰斜体
    if (text.startsWith('@') || text.startsWith('//') || text.startsWith(';')) {
      return `<span class="cm">${esc(text)}</span>`;
    }
    const m = /^([a-zA-Z_.][\w.]*(?:\.w)?)(\s+)(.*)$/.exec(text);
    if (!m) {
      return `<span class="lb">${esc(text)}</span>`; // 标签/伪指令行
    }
    const [, mn, sp, rest] = m;
    const kc = kind ?? 'other';
    // 操作数内着色：寄存器淡蓝、立即数绿、#立即数、注释灰
    const ops = esc(rest)
      .replace(/(r\d+\b|lr\b|pc\b|sp\b|sl\b|fp\b|sb\b|ip\b|s\d+\b|d\d+\b|q\d+\b)/gi, '<span class="rg">$1</span>')
      .replace(/(#[^,\s]+|=\s*0x[0-9a-fA-F]+)/g, '<span class="im">$1</span>')
      .replace(/(@.*$)/, '<span class="cm">$1</span>')
      .replace(/(&lt;[^&]+&gt;)/g, '<span class="lb">$1</span>');
    return `<span class="mn ${kc}">${esc(mn)}</span>${sp}${ops}`;
  }

  private html(): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: var(--vscode-font-family); font-size: 12px;
             color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
             margin: 0; padding: 8px 10px 12px; height: 100vh; box-sizing: border-box;
             display: flex; flex-direction: column; }
      :root {
        --sel: rgba(88,182,248,.26); --selBar: #58b6f8;
        --pc: rgba(226,185,61,.28); --pcBar: #e2b93d;
        --dim: rgba(128,128,128,.25);
        /* 汇编语法配色（对齐 VS Code 内置汇编/Dark+ 观感） */
        --mn-branch: #f4877a;   /* 分支/跳转：橙红 */
        --mn-mem:    #6fd3ce;   /* 访存 ldr/str：青 */
        --mn-alu:    #e2c08d;   /* 算术逻辑：琥珀 */
        --mn-fpu:    #c8a6e8;   /* 浮点 SIMD：紫 */
        --mn-system: #e06c9f;   /* 系统/屏障：玫红 */
        --mn-other:  #b8b8b8;   /* 其他：灰 */
        --rg: #9cdcfe;          /* 寄存器：淡蓝 */
        --im: #b5cea8;          /* 立即数：绿 */
        --cm: #7f7f7f;          /* 注释：灰 */
        --lb: #dcdcaa;          /* 标签/目标：金 */
      }
      .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; flex: none;
        font-size: 11px; color: var(--vscode-descriptionForeground); }
      .bar b { color: var(--vscode-foreground); }
      .st { margin-left: auto; display: flex; align-items: center; gap: 5px; }
      .st .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dim); }
      .st.hl .dot { background: #4ec994; box-shadow: 0 0 6px rgba(78,201,148,.7); }
      .wrap { flex: 1; min-height: 0;
        border: 1px solid var(--dim); border-radius: 10px; overflow: hidden;
        display: flex; flex-direction: column;
        background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 72%, var(--vscode-sideBar-background)); }
      .cap { flex: none; font-size: 10px; font-weight: 600; text-transform: uppercase;
        letter-spacing: .07em; padding: 5px 12px;
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--dim);
        display: flex; justify-content: space-between; }
      #asmPane { flex: 1; overflow: auto; padding: 4px 0 14px; }
      .frow { display: flex; align-items: center; gap: 8px; margin: 12px 10px 4px;
        font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
        font-weight: 700; color: var(--lb);
        cursor: default; user-select: none; }
      .frow::after { content: ''; flex: 1; height: 1px;
        background: linear-gradient(90deg, var(--dim), transparent); }
      .arow { display: flex; font-family: var(--vscode-editor-font-family, monospace);
        font-size: 11.5px; line-height: 1.7; cursor: pointer;
        border-left: 3px solid transparent; padding-right: 8px; }
      .arow.alt { background: color-mix(in srgb, var(--vscode-foreground) 3%, transparent); }
      .arow:hover { background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent); }
      .arow.sel { background: var(--sel); border-left-color: var(--selBar); }
      .arow.pc { background: var(--pc); border-left-color: var(--pcBar); }
      .arow.pc .tt { font-weight: 700; }
      .arow.pc.sel { background: linear-gradient(90deg, var(--pc), var(--sel)); border-left-color: var(--pcBar); }
      .arow .aa { flex: none; width: 80px; color: var(--vscode-descriptionForeground);
        opacity: .75; padding-left: 10px; }
      .arow .bb { flex: none; width: 118px; color: var(--vscode-descriptionForeground); opacity: .45;
        overflow: hidden; letter-spacing: .04em; }
      .arow .tt { flex: 1; overflow: hidden; white-space: pre; }
      .arow .fl { flex: none; margin: 0 8px; font-size: 10px; color: var(--selBar); opacity: .75; }
      .arow.pc .aa::before { content: '▶'; color: var(--pcBar); margin-right: 4px; }
      /* 语法高亮 token 色 */
      .mn { font-weight: 700; }
      .mn.branch { color: var(--mn-branch); }
      .mn.mem { color: var(--mn-mem); }
      .mn.alu { color: var(--mn-alu); }
      .mn.fpu { color: var(--mn-fpu); }
      .mn.system { color: var(--mn-system); }
      .mn.other { color: var(--mn-other); }
      .rg { color: var(--rg); }
      .im { color: var(--im); }
      .cm { color: var(--cm); font-style: italic; }
      .lb { color: var(--lb); }
      .hint { flex: none; font-size: 10.5px; color: var(--vscode-descriptionForeground);
        padding: 5px 2px 0; display: flex; gap: 14px; flex-wrap: wrap; }
      .hint .sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px;
        vertical-align: -1px; margin-right: 5px; }
      .empty { padding: 24px 6px; color: var(--vscode-descriptionForeground);
        text-align: center; line-height: 1.9; }
      .nosess { position: fixed; inset: 0; z-index: 5; display: none;
        align-items: center; justify-content: center; text-align: center;
        background: color-mix(in srgb, var(--vscode-sideBar-background) 86%, transparent);
        color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.9; }
      .nosess.show { display: flex; }
    </style></head><body>
      <div class="bar">
        <span id="fn"></span><span id="loc"></span>
        <span class="st" id="st"><span class="dot"></span><span id="stt">运行中</span></span>
      </div>
      <div class="wrap">
        <div class="cap"><span>汇编</span><span id="cnt"></span></div>
        <div id="asmPane">
          <div id="asmBody" class="empty">停机自动定位到 PC；编辑器里点任意代码行自动联动<br>编辑器右键「在反汇编中显示此行」也可；滚到顶/底加载更多</div>
        </div>
      </div>
      <div class="hint">
        <span><span class="sw" style="background:var(--sel)"></span>联动行</span>
        <span><span class="sw" style="background:var(--pc)"></span>当前 PC</span>
        <span><span class="mn branch">分支</span></span>
        <span><span class="mn mem">访存</span></span>
        <span><span class="mn alu">算术</span></span>
        <span><span class="mn fpu">浮点</span></span>
        <span><span class="rg">寄存器</span></span>
        <span><span class="im">立即数</span></span>
      </div>
      <div class="nosess" id="nosess">未在调试中<br>编辑器右键「在反汇编中显示此行」也可浏览</div>
      <script>
        const vscode = acquireVsCodeApi();
        const $ = (id) => document.getElementById(id);
        const hx8 = (a) => a.toString(16).toUpperCase().padStart(8, '0');
        const norm = (p) => String(p == null ? '' : p).replaceAll('\\\\', '/').toLowerCase();
        let lo = 0, hi = 0, total = 0, rows = [];
        let rowMap = new Map();   // insnIdx -> RowMsg
        let elMap = new Map();    // insnIdx -> 元素
        let pcIdx = -1;
        let selKey = '';          // 当前联动 'file:line'
        let rowNo = 0;            // 交替底色计数（重置窗口时归零）

        function buildNode(r) {
          if (r.fn !== undefined) {
            const d = document.createElement('div');
            d.className = 'frow';
            d.textContent = '⌄ ' + r.fn;
            return d;
          }
          const d = document.createElement('div');
          d.className = 'arow';
          if (rowNo % 2 === 1) { d.classList.add('alt'); }
          rowNo++;
          d.dataset.i = r.i;
          const aa = document.createElement('span'); aa.className = 'aa'; aa.textContent = hx8(r.a);
          const bb = document.createElement('span'); bb.className = 'bb'; bb.textContent = r.b || '';
          const tt = document.createElement('span'); tt.className = 'tt'; tt.innerHTML = r.h;
          d.appendChild(aa); d.appendChild(bb); d.appendChild(tt);
          if (r.f && r.l) {
            const fl = document.createElement('span'); fl.className = 'fl';
            fl.textContent = r.f.split(/[\\\\/]/).pop() + ':' + r.l;
            d.appendChild(fl);
          }
          rowMap.set(r.i, r); elMap.set(r.i, d);
          return d;
        }
        function mark() {
          for (const [i, r] of rowMap) {
            const e = elMap.get(i);
            if (!e) { continue; }
            e.classList.toggle('sel', !!r.f && r.l > 0 && (norm(r.f) + ':' + r.l) === selKey);
            e.classList.toggle('pc', i === pcIdx);
          }
        }
        function renderAll() {
          const body = $('asmBody');
          rowMap = new Map(); elMap = new Map();
          if (!rows.length) {
            body.className = 'empty';
            body.innerHTML = 'PC 处无反汇编数据（未找到 ELF/objdump，或不在 .text）';
            return;
          }
          body.className = '';
          body.innerHTML = '';
          const frag = document.createDocumentFragment();
          for (const r of rows) { frag.appendChild(buildNode(r)); }
          body.appendChild(frag);
          mark();
          updateCnt();
        }
        function updateCnt() {
          $('cnt').textContent = hi - lo >= total ? total + ' 条' : (lo + 1) + '–' + hi + ' / ' + total + ' 条';
        }
        function scrollToIdx(idx) {
          const e = elMap.get(idx);
          if (e) { e.scrollIntoView({ block: 'center' }); }
        }
        function selectKeyOf(r) { return r && r.f && r.l ? norm(r.f) + ':' + r.l : ''; }
        function focusRowOf(idx) { return rowMap.get(idx); }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.cmd === 'state') {
            // 无会话但已进入浏览模式时不遮罩（数据可离线显示）；完全无数据才提示
            const blocked = !m.on && !rows.length && !$('asmBody').querySelector('.arow');
            $('nosess').classList.toggle('show', blocked);
            const st = $('st');
            st.className = 'st' + (m.halted ? ' hl' : '');
            $('stt').textContent = m.halted ? '停机中' : (m.file ? '联动浏览' : '运行中');
            $('fn').innerHTML = m.fn ? '函数 <b>' + m.fn.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</b>' : '';
            $('loc').textContent = m.file && m.line ? ' · ' + m.file.split(/[\\\\/]/).pop() + ':' + m.line : '';
            return;
          }
          if (m.cmd === 'rows') {
            const body = $('asmBody');
            const prevTop = body.scrollTop;
            const prevH = body.scrollHeight;
            const wasEmpty = !rows.length;
            if (wasEmpty || m.focusIdx !== undefined || m.lo < lo) {
              // 跳转整窗替换 / 向前扩展：重建并校正滚动
              lo = m.lo; hi = m.hi; total = m.total; rows = m.rows;
              rowNo = 0;
              pcIdx = m.pcIdx !== undefined ? m.pcIdx : pcIdx;
              selKey = m.focusIdx !== undefined ? selectKeyOf(focusRowOf(m.focusIdx)) : selKey;
              renderAll();
              if (m.focusIdx !== undefined) { scrollToIdx(m.focusIdx); }
              else if (!wasEmpty) { body.scrollTop = prevTop + (body.scrollHeight - prevH); }
            } else {
              // 向后追加
              lo = m.lo; hi = m.hi; total = m.total;
              for (const r of m.rows) { rows.push(r); $('asmBody').appendChild(buildNode(r)); }
              mark(); updateCnt();
            }
            return;
          }
          if (m.cmd === 'nodata') {
            $('asmBody').className = 'empty';
            $('asmBody').innerHTML = '无反汇编数据（未找到 ELF/objdump，或 PC 不在 .text）';
          }
        });

        // 点击汇编行：本行（及同源码行）高亮 + 编辑器跳转同色装饰
        $('asmBody').addEventListener('click', (ev) => {
          const ar = ev.target instanceof Element ? ev.target.closest('.arow') : null;
          if (!ar) { return; }
          const r = rowMap.get(Number(ar.dataset.i));
          if (!r || !r.f || !r.l) { return; }
          selKey = norm(r.f) + ':' + r.l;
          mark();
          vscode.postMessage({ cmd: 'link', file: r.f, line: r.l });
        });

        // 无限滚动：接近顶/底 20% 拉取扩展
        $('asmPane').addEventListener('scroll', () => {
          const el = $('asmPane');
          if (el.scrollTop < el.clientHeight * 0.2 && lo > 0) {
            vscode.postMessage({ cmd: 'range', lo: Math.max(0, lo - 400), hi: lo });
          } else if (el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight * 0.2 && hi < total) {
            vscode.postMessage({ cmd: 'range', lo: hi, hi: Math.min(total, hi + 400) });
          }
        });
      </script>
    </body></html>`;
  }
}
