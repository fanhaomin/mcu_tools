"use strict";
/**
 * 「数组」WebviewView：二维及以上标量数组的矩阵可视化（独立于波形面板）。
 *
 * 数据：直接经 DAP readMemory 旁路读数组内存（类型/地址来自变量监控的
 * DWARF 条目，onEntries 同步）。「数组 ▾」可取消勾选隐藏（默认全部显示，
 * **新加的数组自动出现**）。尾两维铺成矩阵、**格子直接显示数值**；前导维
 * 的全部切片同时铺开成小卡片网格，切片过多时分页翻看。颜色按数组内
 * min→max 蓝到红，悬停显示下标与值。
 * 面板不可见或无会话时不读（与其它面板一致的省电策略）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArrayViewProvider = void 0;
const dapHelpers_1 = require("../debug/dapHelpers");
const dwarf_1 = require("../debug/dwarf");
const HIDDEN_KEY = 'acf.array.hidden';
/** 尾两维之外的总切片数展示窗口上限 */
const MAX_SLICES = 12;
/** 单数组每轮采样字节上限 */
const MATRIX_MAX_BYTES = 16384;
/** 单数组每轮渲染格子数上限（DOM 保护；超出减少切片数） */
const MAX_CELLS = 4096;
/** 同时采样显示的数组个数上限 */
const MAX_ARRAYS = 6;
class ArrayViewProvider {
    deps;
    static viewType = 'autoCmakeFlash.arrayview';
    view;
    visible = false;
    /** 目录里所有可选的二维+数组（弹层列表用，不含被裁剪的） */
    allSpecs = [];
    /** 当前显示并采样的数组（applyFilter 从 allSpecs 过滤） */
    specs = [];
    /** 用户取消勾选（隐藏）的数组；新出现的数组不在其中 → 自动显示 */
    hidden = new Set();
    pages = {};
    timer;
    sampling = false;
    lastSig = '';
    /** 上次通知 webview 的会话状态（变化才发） */
    lastSessionOn;
    constructor(deps) {
        this.deps = deps;
    }
    resolveWebviewView(view) {
        this.view = view;
        this.visible = true;
        view.webview.options = { enableScripts: true };
        view.webview.html = this.html();
        view.webview.onDidReceiveMessage((m) => {
            void this.onMessage(m);
        });
        view.onDidChangeVisibility(() => {
            this.visible = view.visible;
            this.restartTimer();
            if (this.visible) {
                void this.sample();
            }
        });
        this.hidden = new Set(this.deps.memento.get(HIDDEN_KEY, []));
        this.restartTimer();
        this.deps.onReady?.();
    }
    setIntervalMs() {
        this.restartTimer();
    }
    /** 变量监控条目变化时同步（数组目录刷新，按勾选过滤显示集） */
    setEntries(list) {
        const all = [];
        for (const x of list) {
            if (!x.matrix || all.length >= 24) {
                continue; // 弹层列表上限（超出部分的数组不提供勾选）
            }
            all.push({
                expr: x.expr,
                typeLabel: x.typeLabel,
                dims: x.matrix.dims,
                addr: x.matrix.addr,
                elemBytes: x.matrix.elemBytes,
                kind: x.matrix.kind,
            });
        }
        this.allSpecs = all;
        this.applyFilter();
    }
    /** 按隐藏集过滤显示/采样集：新数组自动出现（除非被取消勾选过），上限 6 个 */
    applyFilter() {
        const shown = this.allSpecs
            .filter((s) => !this.hidden.has(s.expr))
            .slice(0, MAX_ARRAYS);
        const sig = JSON.stringify([shown, [...this.hidden]]);
        if (sig === this.lastSig) {
            return;
        }
        this.lastSig = sig;
        this.specs = shown;
        for (const k of Object.keys(this.pages)) {
            if (!shown.some((s) => s.expr === k)) {
                delete this.pages[k];
            }
        }
        this.postEntries();
        void this.sample();
    }
    async onMessage(m) {
        switch (m.cmd) {
            case 'ready':
                this.postEntries();
                break;
            case 'page':
                if (m.expr && m.page !== undefined) {
                    this.pages[m.expr] = Math.max(0, m.page);
                    void this.sample();
                }
                break;
            case 'sel': {
                // 勾选 = 显示（从隐藏集移除）；取消 = 隐藏。新数组默认显示，无需手动勾
                if (!m.expr) {
                    return;
                }
                if (m.on) {
                    this.hidden.delete(m.expr);
                }
                else {
                    this.hidden.add(m.expr);
                }
                await this.deps.memento.update(HIDDEN_KEY, [...this.hidden]);
                this.applyFilter();
                break;
            }
            default:
                break;
        }
    }
    restartTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        if (this.visible) {
            this.timer = setInterval(() => {
                if (this.visible && this.deps.getSession()) {
                    void this.sample();
                }
            }, this.deps.getInterval());
        }
    }
    postEntries() {
        void this.view?.webview.postMessage({
            cmd: 'entries',
            arrays: this.allSpecs.map((s) => ({
                expr: s.expr,
                typeLabel: s.typeLabel,
                dims: s.dims,
            })),
            shown: this.specs.map((s) => s.expr),
            hidden: [...this.hidden],
        });
    }
    /** 采样一轮：每个数组把窗口内的连续切片一次 readMemory 读出、逐片解码 */
    async sample() {
        if (!this.view || this.sampling) {
            return;
        }
        const s = this.deps.getSession();
        const has = !!s;
        if (has !== this.lastSessionOn) {
            this.lastSessionOn = has;
            void this.view.webview.postMessage({ cmd: 'session', on: has });
        }
        if (!s) {
            return;
        }
        this.sampling = true;
        try {
            await Promise.all(this.specs.map(async (sp) => {
                if (sp.addr === undefined) {
                    return;
                }
                const lead = sp.dims.slice(0, -2);
                const tail = sp.dims.slice(-2);
                const total = lead.reduce((a, b) => a * b, 1);
                const sliceBytes = tail[0] * tail[1] * sp.elemBytes;
                let count = Math.min(MAX_SLICES, total, Math.max(1, Math.floor(MATRIX_MAX_BYTES / sliceBytes)), Math.max(1, Math.floor(MAX_CELLS / (tail[0] * tail[1]))));
                count = Math.max(1, count);
                const pages = Math.max(1, Math.ceil(total / count));
                const page = Math.min(this.pages[sp.expr] ?? 0, pages - 1);
                const start = page * count;
                const count1 = Math.min(count, total - start);
                const buf = await (0, dapHelpers_1.readBlock)(s, sp.addr + start * sliceBytes, count1 * sliceBytes);
                const slices = [];
                for (let i = 0; i < count1; i++) {
                    const linear = start + i;
                    // 线性切片号 → 前导维下标（行主序）
                    const idx = [];
                    let rest = linear;
                    for (let d = lead.length - 1; d >= 0; d--) {
                        idx[d] = rest % lead[d];
                        rest = Math.floor(rest / lead[d]);
                    }
                    slices.push({
                        idx,
                        values: buf
                            ? (0, dwarf_1.decodeMatrix)(buf.subarray(i * sliceBytes, (i + 1) * sliceBytes), sp)
                            : [],
                    });
                }
                void this.view?.webview.postMessage({
                    cmd: 'data',
                    expr: sp.expr,
                    tail,
                    total,
                    start,
                    count: count1,
                    slices,
                });
            }));
        }
        finally {
            this.sampling = false;
        }
    }
    html() {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: var(--vscode-font-family); font-size: 12px;
             color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
             margin: 0; padding: 0 8px 14px; }
      .bar { display: flex; align-items: center; gap: 8px; padding: 4px 0;
             position: relative; }
      button.ac { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      button { font-family: inherit; font-size: 11px; padding: 2px 10px; border-radius: 6px;
        cursor: pointer; border: 1px solid transparent;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground); }
      button:hover { filter: brightness(1.15); }
      #selPop { position: absolute; top: 100%; left: 0; z-index: 30; min-width: 240px;
        max-height: 300px; overflow-y: auto; padding: 4px; border-radius: 8px; display: none;
        background: var(--vscode-editorWidget-background, #252526);
        border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.35));
        box-shadow: 0 6px 22px rgba(0,0,0,.4); }
      #selPop.show { display: block; }
      .li { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 4px;
            cursor: pointer; margin-bottom: 1px; }
      .li:hover { background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent); }
      .li input { margin: 0; flex: none; }
      .li .nm { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600;
                font-size: 11.5px; flex: 1; overflow: hidden; text-overflow: ellipsis;
                white-space: nowrap; }
      .li .lv { font-family: var(--vscode-editor-font-family, monospace); font-size: 10px;
                color: var(--vscode-descriptionForeground); flex: none; }
      .lb { font-size: 10.5px; color: var(--vscode-descriptionForeground); }
      .empty { padding: 26px 8px; color: var(--vscode-descriptionForeground);
               text-align: center; line-height: 1.9; }
      .blk { margin-bottom: 12px; }
      .bh { display: flex; align-items: center; gap: 8px; margin: 2px 0 5px; }
      .bh .nm { font-family: var(--vscode-editor-font-family, monospace); font-weight: 700;
                color: var(--vscode-foreground); overflow: hidden; text-overflow: ellipsis;
                white-space: nowrap; }
      .bh .dims { font-size: 10px; color: var(--vscode-descriptionForeground); flex: none; }
      .bh .rg { margin-left: auto; font-family: var(--vscode-editor-font-family, monospace);
                font-size: 10px; color: var(--vscode-descriptionForeground); flex: none; }
      .pg { display: flex; align-items: center; gap: 4px; flex: none; }
      .pg button { font-family: inherit; font-size: 10px; padding: 0 7px; height: 18px;
        border-radius: 4px; cursor: pointer; border: 1px solid var(--dim);
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground); }
      .pg .pi { font-size: 10px; color: var(--vscode-descriptionForeground); min-width: 34px;
                text-align: center; }
      .sg { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
      .sc { border: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
            border-radius: 7px; padding: 4px 6px 6px; }
      .sh { font-size: 10px; color: var(--vscode-descriptionForeground);
            font-family: var(--vscode-editor-font-family, monospace); margin-bottom: 4px; }
      .sm { display: grid; gap: 2px; }
      .cell { min-width: 0; height: 21px; border-radius: 3px; overflow: hidden;
        display: flex; align-items: center; justify-content: center;
        font-family: var(--vscode-editor-font-family, monospace); font-size: 9.5px;
        color: #fff; text-shadow: 0 0 3px rgba(0,0,0,.75); user-select: none; }
      .cell.void { background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent); }
      .nosess { color: var(--vscode-descriptionForeground); text-align: center;
        padding: 20px 6px; line-height: 1.9; }
    </style></head><body>
      <div class="bar">
        <button id="arrBtn" class="ac" title="勾选要显示的数组（可多选）">数组 ▾</button>
        <span class="lb">二维及以上数组 · 每格一值 · 颜色 = min→max</span>
        <div id="selPop"></div>
      </div>
      <div id="root"><div class="empty">在「变量监控」添加二维及以上数组后<br>点「数组 ▾」勾选要显示的条目</div></div>
      <div class="nosess" id="nosess" style="display:none">未在调试中<br>启动调试后这里实时刷新数组内容</div>
      <script>
        const vscode = acquireVsCodeApi();
        const state = { arrays: [], shown: new Set(), hidden: new Set(),
                        data: {}, sigs: {}, noSession: true, hasData: false };
        const $ = (id) => document.getElementById(id);
        const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');

        /** 数组勾选弹层：名称 + 维度 + 字节数；默认全显，取消勾选 = 隐藏 */
        function renderSelList() {
          const pop = $('selPop');
          if (!state.arrays.length) {
            pop.innerHTML = '<div class="lb" style="padding:6px">在「变量监控」添加二维及以上数组后，这里出现可勾选的条目。</div>';
            return;
          }
          let h = '';
          for (const a of state.arrays) {
            const on = !state.hidden.has(a.expr);
            h += '<div class="li">' +
              '<input type="checkbox"' + (on ? ' checked' : '') + ' data-x="' + esc(a.expr) + '">' +
              '<span class="nm" title="' + esc(a.expr + ' : ' + a.typeLabel) + '">' + esc(a.expr) + '</span>' +
              '<span class="lv">' + a.dims.join('×') + '</span></div>';
          }
          pop.innerHTML = h;
          pop.querySelectorAll('input[type=checkbox]').forEach((cb) => {
            cb.onchange = () => {
              const x = cb.getAttribute('data-x');
              vscode.postMessage({ cmd: 'sel', expr: x, on: cb.checked });
            };
          });
        }

        function fmtNum(v) {
          if (!Number.isFinite(v)) return '—';
          const a = Math.abs(v);
          if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1);
          if (Number.isInteger(v)) return String(v);
          return String(Math.round(v * 100) / 100);
        }
        function heat(t) {
          if (!Number.isFinite(t)) return '';
          const hue = 240 * (1 - Math.max(0, Math.min(1, t)));
          return 'hsl(' + hue.toFixed(0) + ',72%,52%)';
        }
        function sliceLabel(idxs) {
          return idxs.length === 1 ? 'Z = ' + idxs[0] : '[' + idxs.join('][') + ']';
        }
        function idxText(idxs) {
          return idxs.map((x) => '[' + x + ']').join('');
        }

        function render() {
          const root = $('root');
          $('nosess').style.display = state.noSession && !state.hasData ? 'block' : 'none';
          if (state.noSession && !state.hasData) return;
          const vis = state.arrays.filter((a) => state.shown.has(a.expr));
          if (!vis.length) {
            root.innerHTML = '<div class="empty">' + (state.arrays.length
              ? '数组都已隐藏<br>点上方「数组 ▾」勾选要显示的条目'
              : '在「变量监控」添加二维及以上数组后<br>点「数组 ▾」勾选要显示的条目') + '</div>';
            return;
          }
          let h = '';
          for (const a of vis) {
            h += '<div class="blk" id="blk-' + esc(a.expr) + '"></div>';
          }
          root.innerHTML = h;
          state.sigs = {}; // 结构已重建：强制逐块重填内容
          for (const a of vis) renderBlk(a);
        }

        /** 块结构重建（切片窗口/维度变化时）或值刷新（结构不变时逐格 patch） */
        function renderBlk(a) {
          const d = state.data[a.expr];
          const blk = $('blk-' + CSS.escape(a.expr));
          if (!blk) return;
          const sig = d ? d.start + ':' + d.count + ':' + d.total + ':' + d.tail.join('x') : 'wait';
          if (state.sigs[a.expr] !== sig || !blk.querySelector('.sg')) {
            state.sigs[a.expr] = sig;
            blk.innerHTML = blkHtml(a, d);
            bindBlk(a);
          }
          if (d) patchCells(a, d);
        }

        function blkHtml(a, d) {
          const tailText = a.dims.slice(-2).join('×');
          let h = '<div class="bh">' +
            '<span class="nm">' + esc(a.expr) + '</span>' +
            '<span class="dims">[' + a.dims.join('][') + '] · 矩阵 ' + tailText + '</span>';
          if (d && d.total > d.count) {
            const pages = Math.ceil(d.total / d.count);
            const page = Math.floor(d.start / d.count) + 1;
            h += '<span class="pg"><button data-pg="-1" data-x="' + esc(a.expr) + '" title="上一组切片">‹</button>' +
              '<span class="pi">' + page + '/' + pages + '</span>' +
              '<button data-pg="1" data-x="' + esc(a.expr) + '" title="下一组切片">›</button></span>';
          }
          h += '<span class="rg" data-rg="' + esc(a.expr) + '"></span></div>';
          h += '<div class="sg" data-sg="' + esc(a.expr) + '">';
          if (!d) {
            h += '<div class="sc"><div class="sh">…</div><div class="cell void" style="height:64px">解析中…</div></div>';
          } else {
            for (let i = 0; i < d.count; i++) {
              const sl = d.slices[i];
              h += '<div class="sc"><div class="sh">' + esc(sliceLabel(sl.idx)) + '</div>' +
                '<div class="sm" style="grid-template-columns:repeat(' + d.tail[1] + ',1fr)" data-sl="' + i + '">';
              for (let r = 0; r < d.tail[0]; r++) {
                for (let q = 0; q < d.tail[1]; q++) {
                  h += '<div class="cell" data-r="' + r + '" data-q="' + q + '"></div>';
                }
              }
              h += '</div></div>';
            }
          }
          h += '</div>';
          return h;
        }

        function bindBlk(a) {
          const blk = $('blk-' + CSS.escape(a.expr));
          blk.querySelectorAll('button[data-pg]').forEach((b) => {
            b.onclick = () => {
              const dd = state.data[a.expr];
              if (!dd) return;
              const pages = Math.ceil(dd.total / dd.count);
              const page = Math.floor(dd.start / dd.count) + Number(b.getAttribute('data-pg'));
              vscode.postMessage({ cmd: 'page', expr: a.expr, page: (page + pages) % pages });
            };
          });
          // 悬停显示元素值（原生 title：格子小的时候仍有完整信息）
          blk.querySelectorAll('.sm').forEach((sm) => {
            const si = Number(sm.getAttribute('data-sl'));
            sm.querySelectorAll('.cell').forEach((cell) => {
              cell.onmousemove = () => {
                const dd = state.data[a.expr];
                if (!dd) return;
                const sl = dd.slices[si];
                const r = Number(cell.getAttribute('data-r')), q = Number(cell.getAttribute('data-q'));
                const v = sl.values[r * dd.tail[1] + q];
                cell.title = a.expr + idxText(sl.idx) + '[' + r + '][' + q + '] = ' + fmtNum(v);
              };
            });
          });
        }

        function patchCells(a, d) {
          const blk = $('blk-' + CSS.escape(a.expr));
          if (!blk) return;
          let mn = Infinity, mx = -Infinity;
          for (const sl of d.slices) {
            for (const v of sl.values) {
              if (!Number.isFinite(v)) continue;
              if (v < mn) mn = v;
              if (v > mx) mx = v;
            }
          }
          if (mn === Infinity) { mn = 0; mx = 1; }
          if (mn === mx) { mn -= 1; mx += 1; }
          const rg = blk.querySelector('[data-rg="' + CSS.escape(a.expr) + '"]');
          if (rg) rg.textContent = fmtNum(mn) + ' … ' + fmtNum(mx);
          const showVal = d.tail[0] * d.tail[1] <= 144 && d.tail[1] <= 12;
          blk.querySelectorAll('.sm').forEach((sm) => {
            const si = Number(sm.getAttribute('data-sl'));
            const sl = d.slices[si];
            sm.querySelectorAll('.cell').forEach((cell) => {
              const r = Number(cell.getAttribute('data-r')), q = Number(cell.getAttribute('data-q'));
              const v = sl.values[r * d.tail[1] + q];
              const t = (v - mn) / (mx - mn);
              const bg = Number.isFinite(v) ? heat(t) : '';
              cell.className = 'cell' + (bg ? '' : ' void');
              cell.style.background = bg;
              const txt = showVal ? fmtNum(v) : '';
              if (cell.textContent !== txt) cell.textContent = txt;
            });
          });
        }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.cmd === 'session') {
            // 只切换未调试遮罩，不动内容区（每轮采样都发 session，重建会闪没）
            state.noSession = !m.on;
            $('nosess').style.display = state.noSession && !state.hasData ? 'block' : 'none';
          } else if (m.cmd === 'entries') {
            state.arrays = m.arrays || [];
            state.shown = new Set(m.shown || []);
            state.hidden = new Set(m.hidden || []);
            for (const k of Object.keys(state.data)) {
              if (!state.shown.has(k)) { delete state.data[k]; delete state.sigs[k]; }
            }
            state.hasData = state.shown.size > 0;
            renderSelList();
            render();
          } else if (m.cmd === 'data') {
            state.data[m.expr] = m;
            state.hasData = true;
            const a = state.arrays.find((x) => x.expr === m.expr);
            if (a) renderBlk(a);
          }
        });

        $('arrBtn').addEventListener('click', (ev) => {
          ev.stopPropagation();
          $('selPop').classList.toggle('show');
        });
        window.addEventListener('click', (ev) => {
          if (ev.target instanceof Element &&
              !ev.target.closest('#selPop') && !ev.target.closest('#arrBtn')) {
            $('selPop').classList.remove('show');
          }
        });

        vscode.postMessage({ cmd: 'ready' });
      </script>
    </body></html>`;
    }
}
exports.ArrayViewProvider = ArrayViewProvider;
//# sourceMappingURL=arrayView.js.map