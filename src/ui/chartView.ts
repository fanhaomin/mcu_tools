/**
 * 「波形」WebviewView：变量监控标量条目的实时曲线（canvas 自绘，零依赖）。
 * 数组矩阵可视化在独立的「数组」面板（arrayView）。
 *
 * 数据来源：变量监控面板每轮刷新的同一批内存读取（数值快照由宿主推送，
 * 不产生额外读取负载）；曲线勾选列表 = 监控条目（仅标量可画），勾选与
 * 时间窗持久化。曲线支持滚轮缩放（光标锚定）、拖动平移（自动暂停跟随，
 * 双击回到实时）、悬停读值（十字线 + 数值框）。
 * 面板隐藏时停采（与其它面板一致的省电策略）；面板可见而「变量监控」标签
 * 未打开时，由本面板宿主侧定时器驱动监控采样。
 */

import * as vscode from 'vscode';

export interface ChartDeps {
  memento: vscode.Memento;
  log(msg: string): void;
  getInterval(): number;
  getSession(): vscode.DebugSession | undefined;
  /** 要求变量监控立刻采一轮样（本面板可见而监控标签隐藏时由定时器驱动） */
  forceSample(): void;
  /** 面板就绪（监控面板回填条目列表用） */
  onReady?(): void;
}

export interface ChartEntryInfo {
  expr: string;
  typeLabel: string;
  scalar: boolean;
  colorIdx: number;
}

const SEL_KEY = 'acf.chart.selected';
const WIN_KEY = 'acf.chart.win';
const PALETTE = ['#58b6f8', '#e5c07b', '#c586c0', '#4ec9b0', '#4ec994', '#dcdcaa', '#ce9178', '#f14c4c'];

interface ChartEntry {
  expr: string;
  typeLabel: string;
  scalar: boolean;
  color: string;
}

export class ChartViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autoCmakeFlash.chart';
  private view?: vscode.WebviewView;
  private visible = false;
  private entries: ChartEntry[] = [];
  private selected = new Set<string>();
  private winSec = 30;
  private timer: NodeJS.Timeout | undefined;
  /** 上次通知 webview 的会话状态（变化才发） */
  private lastSessionOn: boolean | undefined;

  constructor(private readonly deps: ChartDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.visible = true;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((m) => void this.onMessage(m));
    view.onDidChangeVisibility(() => {
      this.visible = view.visible;
      this.restartTimer();
    });
    this.selected = new Set(this.deps.memento.get<string[]>(SEL_KEY, []));
    this.winSec = this.deps.memento.get<number>(WIN_KEY, 30);
    this.lastSessionOn = !!this.deps.getSession();
    void view.webview.postMessage({ cmd: 'session', on: this.lastSessionOn });
    this.restartTimer();
    this.postEntries();
    this.deps.onReady?.();
  }

  /** 刷新间隔变更（设置面板） */
  setIntervalMs(): void {
    this.restartTimer();
  }

  /** 变量监控条目变化时同步（曲线颜色按监控顺序稳定分配） */
  setEntries(list: ChartEntryInfo[]): void {
    this.entries = list.map((x, i) => ({
      expr: x.expr,
      typeLabel: x.typeLabel,
      scalar: x.scalar,
      color: PALETTE[(x.colorIdx ?? i) % PALETTE.length],
    }));
    for (const e of this.entries) {
      if (!e.scalar) {
        this.selected.delete(e.expr);
      }
    }
    this.postEntries();
  }

  /** 采样推送（面板隐藏时丢弃，webview 不再处理） */
  pushSample(t: number, vals: Record<string, number>): void {
    if (!this.visible || !this.view) {
      return;
    }
    void this.view.webview.postMessage({ cmd: 'sample', t, vals });
  }

  private postEntries(): void {
    void this.view?.webview.postMessage({
      cmd: 'entries',
      entries: this.entries,
      selected: [...this.selected],
      win: this.winSec,
    });
  }

  private restartTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.visible) {
      this.timer = setInterval(() => {
        if (!this.visible) {
          return;
        }
        const has = !!this.deps.getSession();
        if (has !== this.lastSessionOn) {
          this.lastSessionOn = has;
          void this.view?.webview.postMessage({ cmd: 'session', on: has });
        }
        if (has) {
          this.deps.forceSample();
        }
      }, this.deps.getInterval());
    }
  }

  private async onMessage(m: {
    cmd?: string;
    expr?: string;
    on?: boolean;
    s?: number;
  }): Promise<void> {
    switch (m.cmd) {
      case 'ready':
        this.postEntries();
        break;
      case 'sel': {
        // 下拉勾选：更新绘制集合并持久化
        if (!m.expr) {
          return;
        }
        if (m.on) {
          this.selected.add(m.expr);
        } else {
          this.selected.delete(m.expr);
        }
        await this.deps.memento.update(SEL_KEY, [...this.selected]);
        break;
      }
      case 'win': {
        const s = Number(m.s);
        if (Number.isFinite(s) && s >= 0) {
          this.winSec = s;
          await this.deps.memento.update(WIN_KEY, s);
        }
        break;
      }
      default:
        break;
    }
  }

  private html(): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      :root { --ac: #58b6f8; --dim: rgba(128,128,128,.3); }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body { margin: 0; font-family: var(--vscode-font-family); font-size: 12px;
             color: var(--vscode-foreground); background: var(--vscode-panel-background, var(--vscode-sideBar-background));
             display: flex; flex-direction: column; overflow: hidden; }
      .bar { display: flex; align-items: center; gap: 6px; padding: 4px 8px;
             border-bottom: 1px solid var(--dim); flex: none; position: relative; }
      button.ac { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      #selPop { position: absolute; top: 100%; left: 8px; z-index: 30; min-width: 250px;
        max-height: 320px; overflow-y: auto; padding: 4px; border-radius: 8px; display: none;
        background: var(--vscode-editorWidget-background, #252526);
        border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.35));
        box-shadow: 0 6px 22px rgba(0,0,0,.4); }
      #selPop.show { display: block; }
      .li { display: flex; align-items: center; gap: 5px; padding: 3px 6px; border-radius: 4px;
            cursor: pointer; margin-bottom: 1px; }
      .li:hover { background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent); }
      .li.dis { opacity: .4; cursor: default; }
      .li input { margin: 0; flex: none; }
      .li .dot { width: 7px; height: 7px; border-radius: 2px; flex: none; }
      .li .nm { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600;
                font-size: 11.5px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .li .lv { font-family: var(--vscode-editor-font-family, monospace); font-size: 10px;
                color: var(--vscode-descriptionForeground); flex: none; }
      .hint { padding: 10px; color: var(--vscode-descriptionForeground);
              font-size: 11px; line-height: 1.7; }
      .lb { font-size: 10.5px; color: var(--vscode-descriptionForeground); }
      select { padding: 2px 4px; border-radius: 5px; font-size: 10.5px;
        border: 1px solid var(--vscode-input-border, var(--dim));
        background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); }
      button { font-family: inherit; font-size: 11px; padding: 2px 10px; border-radius: 6px;
        cursor: pointer; border: 1px solid transparent;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground); }
      button:hover { filter: brightness(1.15); }
      label.ck { display: flex; align-items: center; gap: 4px; cursor: pointer;
        font-size: 10.5px; color: var(--vscode-descriptionForeground); user-select: none; }
      #main { flex: 1; display: flex; min-height: 0; }
      #cvwrap { flex: 1; position: relative; min-width: 0; }
      #cvwrap canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; }
    </style></head><body>
      <div class="bar">
        <button id="selBtn" class="ac" title="勾选要绘制曲线的变量（可多选）">变量 ▾</button>
        <span class="lb">窗口</span>
        <select id="win">
          <option value="10">10 秒</option>
          <option value="30" selected>30 秒</option>
          <option value="60">60 秒</option>
          <option value="0">全部</option>
        </select>
        <button id="pause" title="暂停/继续采样绘制">暂停</button>
        <button id="clear" title="清空全部曲线数据">清空</button>
        <label class="ck"><input type="checkbox" id="ylock">锁定Y轴</label>
        <span class="lb" style="margin-left:auto" title="滚轮缩放 · 拖动平移 · 双击回到实时">滚轮缩放 · 拖动平移</span>
        <div id="selPop"></div>
      </div>
      <div id="main">
        <div id="cvwrap"><canvas id="cv"></canvas></div>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        const state = { order: [], meta: {}, sel: new Set(), series: {}, vEls: {},
                        win: 30, paused: false, yLock: false, yRange: null, lastT: 0,
                        follow: true, view: { b: 0, e: 0 },
                        hover: null, drag: null, plot: null,
                        noSession: true };

        /** 变量勾选下拉列表（色点 + 名称 + 当前值；仅标量可勾选） */
        function renderSelList() {
          const pop = $('selPop');
          if (state.order.length === 0) {
            pop.innerHTML = '<div class="hint">在「变量监控」面板添加变量后，<br>这里勾选要绘制曲线的条目（仅标量可画）。</div>';
            return;
          }
          let h = '';
          for (const expr of state.order) {
            const e = state.meta[expr];
            const dis = !e.scalar;
            const on = state.sel.has(expr);
            h += '<div class="li' + (dis ? ' dis' : '') + '"' +
              (dis ? ' title="数组/结构体不可绘制"' : '') + '>' +
              '<input type="checkbox"' + (on ? ' checked' : '') + (dis ? ' disabled' : '') +
              ' data-x="' + esc(expr) + '">' +
              '<span class="dot" style="background:' + esc(e.color) + '"></span>' +
              '<span class="nm" title="' + esc(expr + ' : ' + e.typeLabel) + '">' + esc(expr) + '</span>' +
              '<span class="lv" data-v="' + esc(expr) + '">—</span></div>';
          }
          pop.innerHTML = h;
          pop.querySelectorAll('input[type=checkbox]').forEach((cb) => {
            cb.onchange = () => {
              const x = cb.getAttribute('data-x');
              if (cb.checked) state.sel.add(x); else state.sel.delete(x);
              post({ cmd: 'sel', expr: x, on: cb.checked });
              draw();
            };
          });
          state.vEls = {};
          pop.querySelectorAll('.lv').forEach((el) => {
            state.vEls[el.getAttribute('data-v')] = el;
          });
        }
        const $ = (id) => document.getElementById(id);
        const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
        function post(m) { vscode.postMessage(m); }

        function fmtNum(v) {
          if (!Number.isFinite(v)) return '—';
          const a = Math.abs(v);
          if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(2);
          return String(Math.round(v * 1000) / 1000);
        }

        function draw() {
          const c = $('cv');
          const W = c.clientWidth, H = c.clientHeight;
          if (W < 20 || H < 20) return;
          const dpr = window.devicePixelRatio || 1;
          if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
            c.width = Math.round(W * dpr);
            c.height = Math.round(H * dpr);
          }
          const ctx = c.getContext('2d');
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, W, H);
          const fontFam = getComputedStyle(document.body).fontFamily || 'monospace';
          ctx.font = '10px ' + fontFam;
          if (state.noSession) {
            ctx.fillStyle = 'rgba(128,128,128,.95)';
            ctx.textAlign = 'center';
            ctx.font = '12.5px ' + fontFam;
            ctx.fillText('未在调试中', W / 2, H / 2 - 8);
            ctx.fillStyle = 'rgba(128,128,128,.7)';
            ctx.font = '10.5px ' + fontFam;
            ctx.fillText('启动调试（编译并调试）后自动开始绘制曲线', W / 2, H / 2 + 12);
            ctx.textAlign = 'left';
            return;
          }
          const R = W - 6, T = 6, B = H - 18;
          if (R < 60 || B - T < 30) {
            return;
          }
          // 时间窗：跟随最新（win 选择器）或用户缩放/平移后的自由视图
          let tEnd, tBegin;
          if (state.follow) {
            tEnd = state.lastT || Date.now();
            tBegin = tEnd - state.win * 1000;
            if (state.win === 0) {
              let mn = Infinity;
              for (const e of state.order) {
                if (!state.sel.has(e)) continue;
                const s = state.series[e];
                if (s && s.ts.length && s.ts[0] < mn) mn = s.ts[0];
              }
              tBegin = mn === Infinity ? tEnd - 30000 : mn;
            }
          } else {
            tBegin = state.view.b; tEnd = state.view.e;
            if (!(tEnd > tBegin)) { state.follow = true; tEnd = state.lastT || Date.now(); tBegin = tEnd - state.win * 1000; }
          }
          // Y 范围（窗口内数据）
          let ymin = Infinity, ymax = -Infinity, any = false;
          for (const e of state.order) {
            if (!state.sel.has(e)) continue;
            const s = state.series[e];
            if (!s) continue;
            for (let i = 0; i < s.ts.length; i++) {
              if (s.ts[i] < tBegin || s.ts[i] > tEnd) continue;
              any = true;
              if (s.vs[i] < ymin) ymin = s.vs[i];
              if (s.vs[i] > ymax) ymax = s.vs[i];
            }
          }
          if (!any) { ymin = 0; ymax = 1; }
          if (ymin === ymax) { ymin -= 1; ymax += 1; }
          if (state.yLock && state.yRange) {
            ymin = state.yRange[0];
            ymax = state.yRange[1];
          } else {
            const pad = (ymax - ymin) * 0.08;
            ymin -= pad;
            ymax += pad;
            state.yRange = [ymin, ymax];
          }
          // 网格与坐标（Y 刻度按量级压缩小数位，左边距按标签实际宽度自适应）
          const grid = 'rgba(128,128,128,.28)';
          const lab = 'rgba(128,128,128,.9)';
          ctx.lineWidth = 1;
          const gy = 5, gx = 6;
          const step = (ymax - ymin) / gy;
          const dec = Math.max(0, Math.min(4, Math.ceil(-Math.log10(Math.abs(step) || 1))));
          const yLabels = [];
          for (let i = 0; i <= gy; i++) {
            yLabels.push((ymax - step * i).toFixed(dec));
          }
          let maxW = 0;
          for (const yl of yLabels) {
            maxW = Math.max(maxW, ctx.measureText(yl).width);
          }
          const L = Math.max(30, Math.min(90, Math.ceil(maxW) + 10));
          for (let i = 0; i <= gy; i++) {
            const y = T + (B - T) * i / gy;
            ctx.strokeStyle = grid;
            ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
            ctx.fillStyle = lab;
            ctx.fillText(yLabels[i], L - maxW - 5, y + 3);
          }
          const span = Math.max(1, tEnd - tBegin);
          for (let i = 0; i <= gx; i++) {
            const x = L + (R - L) * i / gx;
            ctx.strokeStyle = grid;
            ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke();
            ctx.fillStyle = lab;
            const dt = (tEnd - (tBegin + span * i / gx)) / 1000;
            ctx.fillText((span < 10000 ? dt.toFixed(1) : '-' + Math.round(dt)) + 's', x - 12, H - 6);
          }
          // 曲线
          for (const e of state.order) {
            if (!state.sel.has(e)) continue;
            const s = state.series[e];
            if (!s || s.ts.length === 0) continue;
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < s.ts.length; i++) {
              if (s.ts[i] < tBegin || s.ts[i] > tEnd) continue;
              const x = L + (R - L) * (s.ts[i] - tBegin) / span;
              let y = T + (B - T) * (1 - (s.vs[i] - ymin) / (ymax - ymin));
              y = Math.max(T, Math.min(B, y));
              if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
          state.plot = { L, R, T, B, tb: tBegin, te: tEnd };
          if (!state.follow) {
            ctx.fillStyle = 'rgba(128,128,128,.75)';
            ctx.textAlign = 'right';
            ctx.fillText('已暂停跟随 · 双击回到实时', R - 2, T + 10);
            ctx.textAlign = 'left';
          }
          if (!any) {
            ctx.fillStyle = 'rgba(128,128,128,.9)';
            ctx.textAlign = 'center';
            ctx.fillText('点工具栏「变量 ▾」勾选要绘制的条目', (L + R) / 2, (T + B) / 2);
            ctx.textAlign = 'left';
            return;
          }
          // 悬停：十字线 + 最近样本点 + 数值框
          if (state.hover && !state.drag && state.hover.x >= L && state.hover.x <= R) {
            const hx = state.hover.x;
            const th = tBegin + (hx - L) / (R - L) * span;
            ctx.strokeStyle = 'rgba(128,128,128,.55)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(hx, T); ctx.lineTo(hx, B); ctx.stroke();
            const items = [];
            for (const e of state.order) {
              if (!state.sel.has(e)) continue;
              const s = state.series[e];
              if (!s || s.ts.length === 0) continue;
              let lo = 0, hi = s.ts.length - 1;
              while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s.ts[m] < th) lo = m; else hi = m; }
              const i = Math.abs(s.ts[lo] - th) <= Math.abs(s.ts[hi] - th) ? lo : hi;
              const x = L + (R - L) * (s.ts[i] - tBegin) / span;
              const y = Math.max(T, Math.min(B, T + (B - T) * (1 - (s.vs[i] - ymin) / (ymax - ymin))));
              items.push({ color: s.color, name: e, v: s.vs[i], x, y });
              ctx.fillStyle = s.color;
              ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
              ctx.strokeStyle = 'rgba(0,0,0,.5)';
              ctx.stroke();
            }
            if (items.length) {
              const lines = items.slice(0, 10).map((it) => it.name + ' = ' + fmtNum(it.v));
              let wmax = 0;
              for (const ln of lines) wmax = Math.max(wmax, ctx.measureText(ln).width);
              const bw = wmax + 14, bh = lines.length * 13 + 8;
              let bx = hx + 12, by = T + 8;
              if (bx + bw > R) bx = hx - bw - 12;
              if (by + bh > B) by = B - bh - 4;
              ctx.fillStyle = 'rgba(30,30,34,.92)';
              ctx.fillRect(bx, by, bw, bh);
              ctx.strokeStyle = 'rgba(128,128,128,.4)';
              ctx.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
              lines.forEach((ln, i) => {
                ctx.fillStyle = items[i].color;
                ctx.fillText(ln, bx + 7, by + 15 + i * 13);
              });
              ctx.fillStyle = lab;
            }
          }
        }

        // —— 曲线交互：滚轮缩放（光标锚定）、拖动平移、双击回跟随 ——
        const cv = $('cv');
        cv.addEventListener('wheel', (ev) => {
          const p = state.plot; if (!p) return;
          ev.preventDefault();
          const f = ev.deltaY < 0 ? 0.8 : 1.25;
          const tm = p.tb + (p.te - p.tb) * ((ev.offsetX - p.L) / Math.max(1, p.R - p.L));
          let nb = tm - (tm - p.tb) * f, ne = tm + (p.te - tm) * f;
          if (ne - nb < 200) { const c0 = (nb + ne) / 2; nb = c0 - 100; ne = c0 + 100; }
          if (ne - nb > 3600e3) { const c0 = (nb + ne) / 2; nb = c0 - 1800e3; ne = c0 + 1800e3; }
          state.follow = false;
          state.view = { b: nb, e: ne };
          draw();
        }, { passive: false });
        cv.addEventListener('mousedown', (ev) => {
          const p = state.plot; if (!p) return;
          state.drag = { x0: ev.offsetX, b: p.tb, e: p.te };
        });
        window.addEventListener('mousemove', (ev) => {
          if (!state.drag) return;
          const p = state.plot; if (!p) return;
          const r = cv.getBoundingClientRect();
          const x = ev.clientX - r.left;
          const dt = (state.drag.x0 - x) / Math.max(1, p.R - p.L) * (state.drag.e - state.drag.b);
          state.follow = false;
          state.view = { b: state.drag.b + dt, e: state.drag.e + dt };
          draw();
        });
        window.addEventListener('mouseup', () => { if (state.drag) { state.drag = null; draw(); } });
        cv.addEventListener('mousemove', (ev) => {
          if (state.drag) return;
          state.hover = { x: ev.offsetX, y: ev.offsetY };
          draw();
        });
        cv.addEventListener('mouseleave', () => { state.hover = null; draw(); });
        cv.addEventListener('dblclick', () => { state.follow = true; draw(); });

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.cmd === 'session') {
            state.noSession = !m.on;
            draw();
          } else if (m.cmd === 'entries') {
            state.order = [];
            state.meta = {};
            for (const en of (m.entries || [])) {
              state.order.push(en.expr);
              state.meta[en.expr] = en;
              if (!state.series[en.expr]) {
                state.series[en.expr] = { ts: [], vs: [], color: en.color };
              } else {
                state.series[en.expr].color = en.color;
              }
            }
            // 丢弃已删除条目的数据
            for (const k of Object.keys(state.series)) {
              if (!state.meta[k]) delete state.series[k];
            }
            state.sel = new Set((m.selected || []).filter((x) => state.meta[x] && state.meta[x].scalar));
            state.win = m.win || 30;
            $('win').value = String(state.win);
            renderSelList();
            draw();
          } else if (m.cmd === 'sample') {
            state.lastT = m.t;
            if (!state.paused) {
              for (const k in (m.vals || {})) {
                if (!state.sel.has(k)) continue;
                const s = state.series[k];
                if (!s) continue;
                s.ts.push(m.t);
                s.vs.push(m.vals[k]);
                if (s.ts.length > 3600) { s.ts.shift(); s.vs.shift(); }
              }
            }
            for (const k in (m.vals || {})) {
              if (state.vEls[k]) state.vEls[k].textContent = fmtNum(m.vals[k]);
            }
            draw();
          }
        });

        $('win').addEventListener('change', () => {
          state.win = +$('win').value;
          state.follow = true;
          post({ cmd: 'win', s: state.win });
          draw();
        });
        $('pause').addEventListener('click', () => {
          state.paused = !state.paused;
          $('pause').textContent = state.paused ? '继续' : '暂停';
        });
        $('clear').addEventListener('click', () => {
          for (const k of Object.keys(state.series)) {
            state.series[k].ts.length = 0;
            state.series[k].vs.length = 0;
          }
          draw();
        });
        $('ylock').addEventListener('change', () => {
          state.yLock = $('ylock').checked;
          if (!state.yLock) state.yRange = null;
          draw();
        });
        // 变量下拉：按钮开合，点外部收起（弹层内点击不关闭）
        $('selBtn').addEventListener('click', (ev) => {
          ev.stopPropagation();
          $('selPop').classList.toggle('show');
        });
        window.addEventListener('click', (ev) => {
          if (ev.target instanceof Element &&
              !ev.target.closest('#selPop') && !ev.target.closest('#selBtn')) {
            $('selPop').classList.remove('show');
          }
        });
        if (window.ResizeObserver) {
          new ResizeObserver(() => draw()).observe($('cvwrap'));
        }
        window.addEventListener('resize', draw);

        post({ cmd: 'ready' });
      </script>
    </body></html>`;
  }
}
