/**
 * 「内存视图」WebviewView：Keil 风格的内存 hexdump 窗口。
 * 添加地址区间（16-16384B），50-500ms 实时刷新；字节点击可编辑写回。
 * 渲染为增量式：表格结构只在添加/删除区域时重建，数值刷新只更新
 * 变化的单元格文本——大区域（16KB≈1.6 万格）也不会卡。
 * 区间持久化在 workspaceState（每个工程独立）。
 */

import * as vscode from 'vscode';
import { readBlock, sampleWhileRunning, delay } from '../debug/dapHelpers';
import { formatHexDump } from '../debug/hexdump';

export interface MemViewDeps {
  getSession(): vscode.DebugSession | undefined;
  log(msg: string): void;
  memento: vscode.Memento;
}

interface MemRegion {
  addr: number;
  bytes: number;
}

const STORE_KEY = 'acf.mem.regions';
const MAX_REGIONS = 8;
const MAX_BYTES = 16384;

export class MemViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autoCmakeFlash.memview';
  private view?: vscode.WebviewView;
  private visible = false;
  private regions: MemRegion[] = [];

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
        this.postRegions();
      }
    });
    this.regions = this.deps.memento.get<MemRegion[]>(STORE_KEY, []);
    this.postRegions();
  }

  private async persist(): Promise<void> {
    await this.deps.memento.update(STORE_KEY, this.regions);
  }

  private async onMessage(m: {
    cmd?: string;
    addr?: number;
    bytes?: number;
    key?: number;
    interval?: number;
    byteAddr?: number;
    byteValue?: number;
  }): Promise<void> {
    switch (m.cmd) {
      case 'ready':
        this.postRegions();
        break;
      case 'add': {
        let addr = Number(m.addr);
        if (!Number.isFinite(addr) || addr <= 0 || addr > 0xffffffff) {
          return;
        }
        let bytes = Number(m.bytes) || 256;
        let clamped = false;
        if (bytes > MAX_BYTES) {
          bytes = MAX_BYTES;
          clamped = true;
        }
        bytes = Math.max(16, bytes);
        addr = Math.floor(addr);
        if (this.regions.some((r) => r.addr === addr)) {
          return;
        }
        if (this.regions.length >= MAX_REGIONS) {
          void this.view?.webview.postMessage({
            cmd: 'toast',
            msg: `最多 ${MAX_REGIONS} 个区域`,
            err: true,
          });
          return;
        }
        this.regions.push({ addr, bytes });
        await this.persist();
        this.postRegions();
        if (clamped) {
          void this.view?.webview.postMessage({
            cmd: 'toast',
            msg: `单区域上限 ${MAX_BYTES} 字节（渲染性能考虑），已自动调整`,
            err: true,
          });
        }
        break;
      }
      case 'remove': {
        this.regions = this.regions.filter((r) => r.addr !== m.key);
        await this.persist();
        this.postRegions();
        break;
      }
      case 'writeByte': {
        await this.writeByte(m.byteAddr ?? 0, m.byteValue ?? 0);
        break;
      }
      case 'read': {
        if (this.visible) {
          await this.refresh(m.interval ?? 200);
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
    try {
      await s.customRequest('evaluate', {
        expression: `set {unsigned char}0x${addr.toString(16)} = 0x${(value & 0xff).toString(16)}`,
        context: 'repl',
      });
      this.deps.log(`内存写入: [0x${addr.toString(16)}] = 0x${(value & 0xff).toString(16)}`);
    } catch (e) {
      this.deps.log(`内存写入失败 [0x${addr.toString(16)}]: ${e instanceof Error ? e.message : String(e)}`);
      void this.view?.webview.postMessage({
        cmd: 'toast',
        msg: `写入失败（目标运行中？cortex-debug 引擎请先暂停）0x${addr.toString(16)}`,
        err: true,
      });
    }
  }

  private postRegions(): void {
    void this.view?.webview.postMessage({
      cmd: 'regions',
      regions: this.regions,
      maxBytes: MAX_BYTES,
    });
  }

  private async refresh(intervalMs: number): Promise<void> {
    const s = this.deps.getSession();
    if (!s || this.regions.length === 0) {
      return;
    }
    const nonIntrusive = s.type === 'probe-rs-debug';
    const out: Record<number, { data?: string; ok: boolean }> = {};
    const failed: MemRegion[] = [];

    await Promise.all(
      this.regions.map(async (r) => {
        const buf = await readBlock(s, r.addr, r.bytes);
        if (buf) {
          out[r.addr] = { data: buf.toString('base64'), ok: true };
        } else {
          failed.push(r);
          out[r.addr] = { ok: false };
        }
      }),
    );

    if (!nonIntrusive && failed.length > 0) {
      // cortex-debug：微停机窗口重读
      await sampleWhileRunning(s, this.deps.log, async () => {
        await Promise.all(
          failed.map(async (r) => {
            const buf = await readBlock(s, r.addr, r.bytes);
            if (buf) {
              out[r.addr] = { data: buf.toString('base64'), ok: true };
            }
          }),
        );
      });
    } else if (nonIntrusive && failed.length > 0) {
      // probe-rs 运行中偶发失败：短暂等待重试一次（不动目标）
      await delay(30);
      await Promise.all(
        failed.map(async (r) => {
          const buf = await readBlock(s, r.addr, r.bytes);
          if (buf) {
            out[r.addr] = { data: buf.toString('base64'), ok: true };
          }
        }),
      );
    }

    void this.view?.webview.postMessage({ cmd: 'data', data: out });
  }

  private html(): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: var(--vscode-font-family); font-size: 12px;
             color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
             margin: 0; padding: 8px 10px 20px; }
      :root { --ac: #58b6f8; --ok: #4ec994; }
      .row { display: flex; gap: 6px; margin-bottom: 8px; align-items: center; }
      input[type=text] { padding: 5px 9px; border-radius: 6px;
        border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35));
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        font-family: var(--vscode-editor-font-family, monospace); }
      input:focus { outline: none; border-color: var(--ac); }
      #addr { flex: 1; min-width: 0; }
      #len { width: 70px; }
      button { font-family: inherit; font-size: 12px; padding: 4px 12px; border-radius: 6px;
        cursor: pointer; border: 1px solid transparent;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      .card { border: 1px solid rgba(128,128,128,.25); border-radius: 8px; margin-bottom: 10px;
        background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent); overflow: hidden; }
      .head { display: flex; align-items: center; padding: 5px 10px; gap: 8px;
        border-bottom: 1px solid rgba(128,128,128,.18); }
      .head .a { font-family: var(--vscode-editor-font-family, monospace); font-weight: 700; color: var(--ac); }
      .head .n { font-size: 10.5px; color: var(--vscode-descriptionForeground); }
      .head .del { margin-left: auto; cursor: pointer; color: var(--vscode-descriptionForeground); }
      .head .del:hover { color: #f14c4c; }
      .scroll { max-height: 420px; overflow-y: auto; }
      table { width: 100%; border-collapse: collapse; font-family: var(--vscode-editor-font-family, monospace); }
      td { padding: 2px 4px; white-space: nowrap; }
      tr:hover { background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent); }
      .a { color: var(--vscode-descriptionForeground); font-size: 10.5px; }
      .by { cursor: pointer; padding: 1px 3px; border-radius: 3px; text-align: center; min-width: 22px; }
      .by:hover { background: color-mix(in srgb, var(--ac) 25%, transparent); color: var(--ac); }
      .by input { width: 26px; padding: 0 2px; font-family: inherit; font-size: 11px;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        border: 1px solid var(--ac); border-radius: 3px; text-align: center; }
      .asc { color: var(--vscode-descriptionForeground); padding-left: 8px; }
      .chg { color: var(--ok); font-weight: 700; }
      .empty { padding: 14px 6px; color: var(--vscode-descriptionForeground);
        text-align: center; line-height: 1.7; }
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
      .stale { opacity: .45; }
    </style></head><body>
      <div class="row">
        <input id="addr" type="text" placeholder="0x20000000（回车添加）">
        <input id="len" type="text" value="256" title="字节数（16-16384）">
        <button id="add">添加</button>
      </div>
      <div id="regions"><div class="empty">添加要查看的内存地址<br>如 0x20000000（SRAM）、0x40010800（GPIOA）</div></div>
      <div class="row2">刷新
        <select id="iv">
          <option value="50">50ms</option>
          <option value="100">100ms</option>
          <option value="200" selected>200ms</option>
          <option value="500">500ms</option>
        </select>
        · 点字节格编辑写回 · 修改过的字节绿色高亮 · 单区域上限 16KB
      </div>
      <div id="toast"></div>
      <script>
        const vscode = acquireVsCodeApi();
        const state = { regions: [], data: {}, timer: null, interval: 200, changed: {}, cells: {} };
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

        // 结构重建：仅在添加/删除区域时执行；单元格元素存入 state.cells 供增量更新
        function render() {
          const wrap = $('regions');
          state.cells = {};
          if (state.regions.length === 0) {
            wrap.innerHTML = '<div class="empty">添加要查看的内存地址<br>如 0x20000000（SRAM）、0x40010800（GPIOA）</div>';
            return;
          }
          wrap.innerHTML = state.regions.map((r) => {
            let h = '<div class="card" data-k="' + r.addr + '"><div class="head">' +
              '<span class="a">0x' + r.addr.toString(16).toUpperCase() + '</span>' +
              '<span class="n">' + r.bytes + ' B · 实时</span>' +
              '<span class="del" title="移除">✕</span></div><div class="scroll"><table>';
            for (let off = 0; off < r.bytes; off += 16) {
              h += '<tr><td class="a">0x' + (r.addr + off).toString(16).toUpperCase().padStart(8, '0') + '</td>';
              for (let i = 0; i < 16 && off + i < r.bytes; i++) {
                const abs = r.addr + off + i;
                h += '<td class="by" data-a="' + abs + '">·</td>';
              }
              h += '<td class="asc" data-rowa="' + off + '"></td></tr>';
            }
            h += '</table></div></div>';
            return h;
          }).join('');
          wrap.querySelectorAll('.card').forEach((card) => {
            const key = +card.getAttribute('data-k');
            card.querySelector('.del').onclick = () => post({ cmd: 'remove', key });
            card.querySelectorAll('.by').forEach((cell) => {
              state.cells[+cell.getAttribute('data-a')] = cell;
              cell.onclick = () => {
                if (cell.querySelector('input')) return;
                const cur = cell.textContent.trim();
                cell.innerHTML = '<input maxlength="2" value="' + esc(cur === '·' ? '' : cur) + '">';
                const inp = cell.querySelector('input');
                inp.focus(); inp.select();
                const done = () => render();
                inp.onkeydown = (ev) => {
                  if (ev.key === 'Enter') {
                    const v = parseInt(inp.value, 16);
                    const addr = +cell.getAttribute('data-a');
                    if (Number.isFinite(v)) {
                      state.changed[addr] = v;
                      post({ cmd: 'writeByte', byteAddr: addr, byteValue: v });
                    }
                    done();
                  }
                  if (ev.key === 'Escape') done();
                };
                inp.onblur = () => done();
              };
            });
          });
          updateCells();
        }

        // 增量更新：只改文本变化的单元格（16KB ≈ 1.6 万格也在毫秒级）
        function updateCells() {
          for (const r of state.regions) {
            const d = state.data[r.addr];
            const table = document.querySelector('.card[data-k="' + r.addr + '"] table');
            if (!table) continue;
            table.parentElement.classList.toggle('stale', !d || !d.ok);
            if (!d || !d.ok || !d.data) continue;
            const buf = Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0));
            for (let i = 0; i < buf.length; i++) {
              const abs = r.addr + i;
              const cell = state.cells[abs];
              if (!cell) continue;
              const b = buf[i];
              const txt = b.toString(16).toUpperCase().padStart(2, '0');
              const chg = state.changed[abs];
              const want = chg !== undefined ? chg.toString(16).toUpperCase().padStart(2, '0') : txt;
              if (cell.textContent !== want) cell.textContent = want;
              cell.classList.toggle('chg', chg !== undefined);
            }
            // ASCII 列
            const rows = table.querySelectorAll('tr');
            for (let ri = 0; ri < rows.length; ri++) {
              const asc = rows[ri].querySelector('.asc');
              if (!asc) continue;
              let a = '';
              for (let i = 0; i < 16; i++) {
                const b = buf[ri * 16 + i];
                if (b === undefined) break;
                a += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·';
              }
              if (asc.textContent !== a) asc.textContent = a;
            }
          }
        }

        function tick() {
          if (state.regions.length === 0) return;
          post({ cmd: 'read', interval: state.interval });
        }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.cmd === 'regions') {
            state.regions = m.regions || [];
            render();
          } else if (m.cmd === 'data') {
            state.data = m.data || {};
            updateCells();
          } else if (m.cmd === 'toast') {
            toast(m.msg, m.err);
          }
        });

        function add() {
          const a = parseInt($('addr').value, 16);
          if (!Number.isFinite(a)) return;
          post({ cmd: 'add', addr: a, bytes: parseInt($('len').value, 10) || 256 });
          $('addr').value = '';
        }
        $('add').addEventListener('click', add);
        $('addr').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') add(); });
        $('iv').addEventListener('change', () => {
          state.interval = +$('iv').value;
          if (state.timer) clearInterval(state.timer);
          state.timer = setInterval(tick, state.interval);
        });
        state.timer = setInterval(tick, state.interval);

        post({ cmd: 'ready' });
      </script>
    </body></html>`;
  }
}
