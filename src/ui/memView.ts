/**
 * 「内存视图」WebviewView：Keil 风格的内存查看器。
 * 单一 256 字节视口（16 行 × 16 列）：地址回车跳转（带历史下拉），
 * 滚轮逐行滚动、Shift+滚轮整页；每轮只读取当前可见的 256 字节。
 * 字节点击可编辑写回。历史与上次地址持久化在 workspaceState。
 */

import * as vscode from 'vscode';
import { readBlock, sampleWhileRunning, delay } from '../debug/dapHelpers';

export interface MemViewDeps {
  getSession(): vscode.DebugSession | undefined;
  log(msg: string): void;
  memento: vscode.Memento;
  /** 调试面板统一刷新间隔 ms */
  getInterval(): number;
}

const VIEW_BYTES = 256;
const HIST_KEY = 'acf.mem.history';
const LAST_KEY = 'acf.mem.lastBase';
const MAX_HISTORY = 12;

export class MemViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autoCmakeFlash.memview';
  private view?: vscode.WebviewView;
  private visible = false;
  private history: number[] = [];
  private lastBase = 0x20000000;
  /** 上次通知 webview 的会话状态（变化才发） */
  private lastSessionOn: boolean | undefined;

  constructor(private readonly deps: MemViewDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.visible = true;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((m) => void this.onMessage(m));
    view.onDidChangeVisibility(() => {
      this.visible = view.visible;
      if (view.visible) {
        this.postInit();
      }
    });
    this.history = this.deps.memento.get<number[]>(HIST_KEY, []);
    this.lastBase = this.deps.memento.get<number>(LAST_KEY, 0x20000000);
    this.pushSessionState(!!this.deps.getSession());
    this.postInit();
  }

  /** 推送统一刷新间隔（设置变更时调用） */
  setIntervalMs(ms: number): void {
    void this.view?.webview.postMessage({ cmd: 'interval', ms });
  }

  private postInit(): void {
    void this.view?.webview.postMessage({
      cmd: 'init',
      base: this.lastBase,
      history: this.history,
    });
  }

  /** 回车/下拉选择：更新历史并通知 */
  private async setBase(base: number): Promise<void> {
    this.lastBase = base;
    this.history = [base, ...this.history.filter((h) => h !== base)].slice(0, MAX_HISTORY);
    await this.deps.memento.update(HIST_KEY, this.history);
    await this.deps.memento.update(LAST_KEY, base);
    this.postInit();
  }

  private async onMessage(m: {
    cmd?: string;
    base?: number;
    byteAddr?: number;
    byteValue?: number;
    interval?: number;
  }): Promise<void> {
    switch (m.cmd) {
      case 'ready':
        this.postInit();
        break;
      case 'base': {
        const base = Number(m.base);
        if (!Number.isFinite(base) || base < 0 || base > 0xffffffff) {
          return;
        }
        await this.setBase(base & ~0xf);
        break;
      }
      case 'writeByte': {
        await this.writeByte(m.byteAddr ?? 0, m.byteValue ?? 0);
        break;
      }
      case 'read': {
        if (this.visible) {
          await this.refresh(Number(m.base) || this.lastBase, this.deps.getInterval());
        }
        break;
      }
      default:
        break;
    }
  }

  private async writeByte(addr: number, value: number): Promise<void> {
    const s = this.deps.getSession();
    if (!s) {
      return;
    }
    const hex = `0x${(value & 0xff).toString(16)}`;
    // 首选标准 DAP writeMemory（probe-rs / cortex-debug 均支持，运行中可写）
    const writeMem = async (): Promise<void> => {
      await s.customRequest('writeMemory', {
        memoryReference: `0x${addr.toString(16)}`,
        count: 1,
        data: Buffer.from([value & 0xff]).toString('base64'),
      });
    };
    try {
      await writeMem();
      this.deps.log(`内存写入: [0x${addr.toString(16)}] = ${hex}`);
      return;
    } catch (e) {
      this.deps.log(
        `内存写入 writeMemory 失败 [0x${addr.toString(16)}]（${s.type}）: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    // 回退：GDB evaluate 赋值（cortex-debug）
    try {
      await s.customRequest('evaluate', {
        expression: `set {unsigned char}0x${addr.toString(16)} = ${hex}`,
        context: 'repl',
      });
      this.deps.log(`内存写入（evaluate 回退）: [0x${addr.toString(16)}] = ${hex}`);
      return;
    } catch (e) {
      this.deps.log(
        `内存写入失败 [0x${addr.toString(16)}]: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    // cortex-debug 运行中：微停机窗口再试一次 writeMemory
    if (s.type !== 'probe-rs-debug') {
      try {
        const ok = await sampleWhileRunning(s, this.deps.log, writeMem);
        if (ok) {
          this.deps.log(`内存写入（微停机窗口）: [0x${addr.toString(16)}] = ${hex}`);
          return;
        }
      } catch {
        // 落入失败提示
      }
    }
    void this.view?.webview.postMessage({
      cmd: 'toast',
      msg: `写入失败 0x${addr.toString(16)}（详见输出面板日志）`,
      err: true,
    });
  }

  /** 会话状态变化时通知 webview（显示/隐藏「未在调试中」遮罩） */
  private pushSessionState(on: boolean): void {
    if (this.lastSessionOn === on) {
      return;
    }
    this.lastSessionOn = on;
    void this.view?.webview.postMessage({ cmd: 'session', on });
  }

  private async refresh(base: number, intervalMs: number): Promise<void> {
    const s = this.deps.getSession();
    this.pushSessionState(!!s);
    if (!s) {
      return;
    }
    const nonIntrusive = s.type === 'probe-rs-debug';
    let buf = await readBlock(s, base, VIEW_BYTES);
    let ok = !!buf;

    if (!ok) {
      if (nonIntrusive) {
        // probe-rs 运行中偶发失败：短暂等待重试一次（不动目标）
        await delay(30);
        buf = await readBlock(s, base, VIEW_BYTES);
        ok = !!buf;
      } else {
        // cortex-debug：微停机窗口读取
        await sampleWhileRunning(s, this.deps.log, async () => {
          buf = await readBlock(s, base, VIEW_BYTES);
          ok = !!buf;
        });
      }
    }

    void this.view?.webview.postMessage({
      cmd: 'data',
      base,
      data: buf ? buf.toString('base64') : undefined,
      ok,
    });
  }

  private html(): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: var(--vscode-font-family); font-size: 12px;
             color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
             margin: 0; padding: 8px 10px 20px; }
      :root { --ac: #58b6f8; --ok: #4ec994; }
      .row { display: flex; gap: 6px; margin-bottom: 8px; align-items: center; }
      #addr { flex: 1; min-width: 0; padding: 5px 9px; border-radius: 6px;
        border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35));
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        font-family: var(--vscode-editor-font-family, monospace); }
      #addr:focus { outline: none; border-color: var(--ac); }
      .card { position: relative; border: 1px solid rgba(128,128,128,.25); border-radius: 8px;
        background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent); overflow: hidden; }
      .nosess { position: absolute; inset: 0; z-index: 5; display: none;
        align-items: center; justify-content: center; text-align: center;
        background: color-mix(in srgb, var(--vscode-sideBar-background) 86%, transparent);
        color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.9; }
      .nosess.show { display: flex; }
      .tblwrap { overflow-x: auto; flex: 1; min-width: 0; }
      .body { display: flex; align-items: stretch; }
      #sb { width: 12px; margin: 4px 4px 4px 2px; border-radius: 6px; position: relative;
            background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
            cursor: ns-resize; user-select: none; flex: none; }
      #thumb { position: absolute; left: 2px; right: 2px; height: 28px; border-radius: 4px;
               background: color-mix(in srgb, var(--vscode-foreground) 28%, transparent); }
      #thumb:hover, #thumb.on { background: var(--ac); }
      /* 窄面板：压缩字节格尺寸，尽量少出横向滚动 */
      @media (max-width: 560px) {
        .by { min-width: 18px; padding: 1px 2px; }
        .by:nth-child(6), .by:nth-child(10), .by:nth-child(14) { padding-left: 5px; }
        td { padding: 2px 2px; }
        .asc { padding-left: 5px; }
      }
      .head { display: flex; align-items: center; padding: 5px 10px; gap: 8px;
        border-bottom: 1px solid rgba(128,128,128,.18); }
      .head .a { font-family: var(--vscode-editor-font-family, monospace); font-weight: 700; color: var(--ac); }
      .head .n { font-size: 10.5px; color: var(--vscode-descriptionForeground); }
      table { border-collapse: collapse; font-family: var(--vscode-editor-font-family, monospace); }
      td { padding: 2px 4px; white-space: nowrap; }
      tr:hover { background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent); }
      .a { color: var(--vscode-descriptionForeground); font-size: 10.5px; user-select: none; cursor: grab; }
      .by { cursor: pointer; padding: 1px 3px; border-radius: 4px; text-align: center; min-width: 22px;
            transition: background .1s, color .1s; }
      .by:nth-child(6), .by:nth-child(10), .by:nth-child(14) { padding-left: 10px; }
      .by:hover { background: color-mix(in srgb, var(--ac) 25%, transparent); color: var(--ac); }
      .by.z { color: var(--vscode-descriptionForeground); opacity: .55; }
      .by input { width: 26px; padding: 0 2px; font-family: inherit; font-size: 11px;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        border: 1px solid var(--ac); border-radius: 3px; text-align: center; }
      .asc { color: var(--vscode-descriptionForeground); padding-left: 8px; }
      .chg { color: var(--ok); font-weight: 700; }
      .diff { color: #e2b93d; font-weight: 700;
        background: color-mix(in srgb, #e2b93d 14%, transparent); }
      .stale { opacity: .45; }
      .hint { font-size: 10.5px; color: var(--vscode-descriptionForeground); }
      select { padding: 3px 6px; border-radius: 5px; font-size: 11px;
        border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35));
        background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); }
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
        <input id="addr" type="text" list="hist" placeholder="0x20000000（回车跳转）">
        <datalist id="hist"></datalist>
      </div>
      <div class="card" id="card">
        <div class="head"><span class="a" id="base">—</span><span class="n">256 B · 实时</span></div>
        <div class="body">
          <div class="tblwrap"><table id="tbl"></table></div>
          <div id="sb" title="拖动快速跳转（每次拖动覆盖 ±32KB）· 点击轨道翻页"><div id="thumb"></div></div>
        </div>
        <div class="nosess" id="nosess">未在调试中<br>启动调试后这里显示内存内容</div>
      </div>
      <div id="toast"></div>
      <script>
        const vscode = acquireVsCodeApi();
        const VIEW = 256;
        const state = { base: 0x20000000, data: null, ok: false, timer: null, interval: 200, changed: {}, history: [], prev: null, prevBase: 0 };
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

        // 结构：一次性建 16 行 × 16 格 + ASCII 列；地址/数值后续增量更新
        function build() {
          const tbl = $('tbl');
          let h = '';
          for (let r = 0; r < 16; r++) {
            h += '<tr><td class="a" data-r="' + r + '"></td>';
            for (let c = 0; c < 16; c++) {
              h += '<td class="by" data-c="' + c + '" data-r="' + r + '">·</td>';
            }
            h += '<td class="asc" data-r="' + r + '"></td></tr>';
          }
          tbl.innerHTML = h;
          tbl.querySelectorAll('.by').forEach((cell) => {
            cell.onclick = () => {
              if (cell.querySelector('input') || !state.ok) return;
              const cur = cell.textContent.trim();
              cell.innerHTML = '<input maxlength="2" value="' + esc(cur === '·' ? '' : cur) + '">';
              const inp = cell.querySelector('input');
              inp.focus(); inp.select();
              const abs = state.base + (+cell.getAttribute('data-r')) * 16 + (+cell.getAttribute('data-c'));
              const done = () => renderData();
              inp.onkeydown = (ev) => {
                if (ev.key === 'Enter') {
                  const v = parseInt(inp.value, 16);
                  if (Number.isFinite(v)) {
                    state.changed[abs] = v;
                    post({ cmd: 'writeByte', byteAddr: abs, byteValue: v });
                  }
                  done();
                }
                if (ev.key === 'Escape') done();
              };
              inp.onblur = () => done();
            };
          });
          renderData();
          renderHist();
        }

        // 数值增量更新：只改文本变化的单元格
        function renderData() {
          updateThumb && updateThumb();
          $('base').textContent = '0x' + state.base.toString(16).toUpperCase();
          $('card').classList.toggle('stale', !state.ok);
          const rows = $('tbl').querySelectorAll('tr');
          if (!state.ok || !state.data) {
            rows.forEach((tr) => {
              tr.querySelectorAll('.by').forEach((c) => { c.textContent = '·'; c.classList.remove('chg'); });
              tr.querySelector('.asc').textContent = '';
              tr.querySelector('.a').textContent = '';
            });
            return;
          }
          const buf = Uint8Array.from(atob(state.data), (c) => c.charCodeAt(0));
          for (let r = 0; r < 16; r++) {
            const tr = rows[r];
            tr.querySelector('.a').textContent = '0x' + (state.base + r * 16).toString(16).toUpperCase().padStart(8, '0');
            let ascii = '';
            tr.querySelectorAll('.by').forEach((cell, c) => {
              const i = r * 16 + c;
              if (i >= buf.length) { cell.textContent = ''; return; }
              const b = buf[i];
              const txt = b.toString(16).toUpperCase().padStart(2, '0');
              const abs = state.base + i;
              const chg = state.changed[abs];
              const diff = state.prev && state.prevBase === state.base &&
                state.prev[i] !== undefined && state.prev[i] !== b;
              const want = chg !== undefined ? chg.toString(16).toUpperCase().padStart(2, '0') : txt;
              if (cell.textContent !== want) cell.textContent = want;
              cell.classList.toggle('chg', chg !== undefined);
              cell.classList.toggle('diff', diff && chg === undefined);
              cell.classList.toggle('z', b === 0 && chg === undefined && !diff);
              ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·';
            });
            const asc = tr.querySelector('.asc');
            if (asc.textContent !== ascii) asc.textContent = ascii;
          }
          state.prev = buf;
          state.prevBase = state.base;
        }

        function renderHist() {
          $('hist').innerHTML = state.history.map((h) =>
            '<option value="0x' + h.toString(16).toUpperCase() + '">').join('');
        }

        function jump(base) {
          base = Math.max(0, Math.min(0xfffffef0, base)) & ~0xf;
          if (base === state.base) return;
          state.base = base;
          state.changed = {};
          state.prev = null;
          build();
          updateThumb();
          tick();
        }

        function tick() {
          post({ cmd: 'read', base: state.base, interval: state.interval });
        }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.cmd === 'session') {
            $('nosess').classList.toggle('show', !m.on);
          } else if (m.cmd === 'init') {
            state.base = m.base; state.history = m.history || [];
            build();
          } else if (m.cmd === 'data') {
            if (m.base !== state.base) return; // 过期响应（滚动后旧数据）
            state.data = m.data; state.ok = m.ok;
            renderData();
          } else if (m.cmd === 'initHist') {
            state.history = m.history || [];
            renderHist();
          } else if (m.cmd === 'toast') {
            toast(m.msg, m.err);
          }
        });

        // 回车 / 下拉历史选择 → 跳转（host 记历史）
        $('addr').addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter') return;
          const v = parseInt($('addr').value, 16);
          if (!Number.isFinite(v)) return;
          post({ cmd: 'base', base: v });
          jump(v);
        });
        $('addr').addEventListener('change', () => {
          const v = parseInt($('addr').value, 16);
          if (!Number.isFinite(v)) return;
          post({ cmd: 'base', base: v });
          jump(v);
        });

        // —— 滚动条：拖动快速跳转（以拖动起始地址为中心 ±32KB），点轨道翻页 ——
        const SB_SPAN = 64 * 1024; // 拖动全程覆盖 64KB
        const SB_PAGE = 256;       // 轨道点击翻页步长
        const sbEl = $('sb'), thumbEl = $('thumb');
        let sbDrag = null;
        function updateThumb() {
          const trackH = sbEl.clientHeight - thumbEl.offsetHeight;
          if (trackH <= 0) { return; }
          let f = 0.5;
          if (sbDrag) {
            f = (state.base - (sbDrag.center - SB_SPAN / 2)) / SB_SPAN;
          } else {
            f = 0.5; // 未拖动时拇指居中（下次拖动以此为中心）
          }
          f = Math.max(0, Math.min(1, f));
          thumbEl.style.top = Math.round(f * trackH) + 'px';
        }
        sbEl.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          const trackH = sbEl.clientHeight - thumbEl.offsetHeight;
          if (trackH <= 0) { return; }
          const tRect = thumbEl.getBoundingClientRect();
          if (ev.clientY >= tRect.top && ev.clientY <= tRect.bottom) {
            sbDrag = { center: state.base, y0: ev.clientY, grab: ev.clientY - tRect.top };
            thumbEl.classList.add('on');
          } else {
            jump(state.base + (ev.clientY < tRect.top ? -SB_PAGE : SB_PAGE));
            return;
          }
        });
        window.addEventListener('pointermove', (ev) => {
          if (!sbDrag) { return; }
          const trackH = sbEl.clientHeight - thumbEl.offsetHeight;
          const f = Math.max(0, Math.min(1, (ev.clientY - sbEl.getBoundingClientRect().top - sbDrag.grab) / trackH));
          const nb = Math.round((sbDrag.center - SB_SPAN / 2 + f * SB_SPAN) / 16) * 16;
          if (nb !== state.base) {
            jump(nb);
            updateThumb();
          }
        });
        window.addEventListener('pointerup', () => {
          if (sbDrag) { sbDrag = null; thumbEl.classList.remove('on'); updateThumb(); }
        });

        // 滚轮：逐行 / Shift 整页（在卡片上滚动 = 移动视口）
        $('card').addEventListener('wheel', (ev) => {
          ev.preventDefault();
          const step = ev.shiftKey ? VIEW : 16;
          jump(state.base + (ev.deltaY > 0 ? step : -step));
        }, { passive: false });

        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } });
        state.timer = setInterval(tick, state.interval);

        post({ cmd: 'ready' });
      </script>
    </body></html>`;
  }
}
