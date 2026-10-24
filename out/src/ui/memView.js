"use strict";
/**
 * 「内存视图」WebviewView：Keil 风格的内存查看器。
 * 单一 256 字节视口（16 行 × 16 列）：地址回车跳转（带历史下拉），
 * 滚轮逐行滚动、Shift+滚轮整页；每轮只读取当前可见的 256 字节。
 * 字节点击可编辑写回。历史与上次地址持久化在 workspaceState。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemViewProvider = void 0;
const dapHelpers_1 = require("../debug/dapHelpers");
const VIEW_BYTES = 256;
const HIST_KEY = 'acf.mem.history';
const LAST_KEY = 'acf.mem.lastBase';
const MAX_HISTORY = 12;
class MemViewProvider {
    deps;
    static viewType = 'autoCmakeFlash.memview';
    view;
    visible = false;
    history = [];
    lastBase = 0x20000000;
    constructor(deps) {
        this.deps = deps;
    }
    resolveWebviewView(view) {
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
        this.history = this.deps.memento.get(HIST_KEY, []);
        this.lastBase = this.deps.memento.get(LAST_KEY, 0x20000000);
        this.postInit();
    }
    /** 推送统一刷新间隔（设置变更时调用） */
    setIntervalMs(ms) {
        void this.view?.webview.postMessage({ cmd: 'interval', ms });
    }
    postInit() {
        void this.view?.webview.postMessage({
            cmd: 'init',
            base: this.lastBase,
            history: this.history,
        });
    }
    /** 回车/下拉选择：更新历史并通知 */
    async setBase(base) {
        this.lastBase = base;
        this.history = [base, ...this.history.filter((h) => h !== base)].slice(0, MAX_HISTORY);
        await this.deps.memento.update(HIST_KEY, this.history);
        await this.deps.memento.update(LAST_KEY, base);
        this.postInit();
    }
    async onMessage(m) {
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
    async writeByte(addr, value) {
        const s = this.deps.getSession();
        if (!s) {
            return;
        }
        try {
            await s.customRequest('evaluate', {
                expression: `set {unsigned char}0x${addr.toString(16)} = 0x${(value & 0xff).toString(16)}`,
                context: 'repl',
            });
            this.deps.log(`内存写入: [0x${addr.toString(16)}] = 0x${(value & 0xff).toString(16)}`);
        }
        catch (e) {
            this.deps.log(`内存写入失败 [0x${addr.toString(16)}]: ${e instanceof Error ? e.message : String(e)}`);
            void this.view?.webview.postMessage({
                cmd: 'toast',
                msg: `写入失败（目标运行中？cortex-debug 引擎请先暂停）0x${addr.toString(16)}`,
                err: true,
            });
        }
    }
    async refresh(base, intervalMs) {
        const s = this.deps.getSession();
        if (!s) {
            return;
        }
        const nonIntrusive = s.type === 'probe-rs-debug';
        let buf = await (0, dapHelpers_1.readBlock)(s, base, VIEW_BYTES);
        let ok = !!buf;
        if (!ok) {
            if (nonIntrusive) {
                // probe-rs 运行中偶发失败：短暂等待重试一次（不动目标）
                await (0, dapHelpers_1.delay)(30);
                buf = await (0, dapHelpers_1.readBlock)(s, base, VIEW_BYTES);
                ok = !!buf;
            }
            else {
                // cortex-debug：微停机窗口读取
                await (0, dapHelpers_1.sampleWhileRunning)(s, this.deps.log, async () => {
                    buf = await (0, dapHelpers_1.readBlock)(s, base, VIEW_BYTES);
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
    html() {
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
      .card { border: 1px solid rgba(128,128,128,.25); border-radius: 8px;
        background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent); overflow: hidden; }
      .head { display: flex; align-items: center; padding: 5px 10px; gap: 8px;
        border-bottom: 1px solid rgba(128,128,128,.18); }
      .head .a { font-family: var(--vscode-editor-font-family, monospace); font-weight: 700; color: var(--ac); }
      .head .n { font-size: 10.5px; color: var(--vscode-descriptionForeground); }
      table { border-collapse: collapse; font-family: var(--vscode-editor-font-family, monospace); }
      td { padding: 2px 4px; white-space: nowrap; }
      tr:hover { background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent); }
      .a { color: var(--vscode-descriptionForeground); font-size: 10.5px; user-select: none; cursor: grab; }
      .by { cursor: pointer; padding: 1px 3px; border-radius: 3px; text-align: center; min-width: 22px; }
      .by:hover { background: color-mix(in srgb, var(--ac) 25%, transparent); color: var(--ac); }
      .by input { width: 26px; padding: 0 2px; font-family: inherit; font-size: 11px;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        border: 1px solid var(--ac); border-radius: 3px; text-align: center; }
      .asc { color: var(--vscode-descriptionForeground); padding-left: 8px; }
      .chg { color: var(--ok); font-weight: 700; }
      .stale { opacity: .45; }
      .hint { font-size: 10.5px; color: var(--vscode-descriptionForeground); }
      .row2 { display: flex; align-items: center; gap: 6px; margin: 8px 0 4px;
        font-size: 10.5px; color: var(--vscode-descriptionForeground); }
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
        <table id="tbl"></table>
      </div>
      <div class="row2">刷新
        <select id="iv">
          <option value="50">50ms</option>
          <option value="100">100ms</option>
          <option value="200" selected>200ms</option>
          <option value="500">500ms</option>
        </select>
        · 回车跳转 · 滚轮逐行 / Shift+滚轮整页 · 点字节格编辑写回
      </div>
      <div id="toast"></div>
      <script>
        const vscode = acquireVsCodeApi();
        const VIEW = 256;
        const state = { base: 0x20000000, data: null, ok: false, timer: null, interval: 200, changed: {}, history: [] };
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
              const want = chg !== undefined ? chg.toString(16).toUpperCase().padStart(2, '0') : txt;
              if (cell.textContent !== want) cell.textContent = want;
              cell.classList.toggle('chg', chg !== undefined);
              ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·';
            });
            const asc = tr.querySelector('.asc');
            if (asc.textContent !== ascii) asc.textContent = ascii;
          }
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
          build();
          tick();
        }

        function tick() {
          post({ cmd: 'read', base: state.base, interval: state.interval });
        }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.cmd === 'init') {
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
exports.MemViewProvider = MemViewProvider;
//# sourceMappingURL=memView.js.map