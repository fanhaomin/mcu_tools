/**
 * 「外设寄存器」WebviewView：Keil 风格的 SVD 外设/寄存器/位域视图，
 * 现代深色卡片风格。数据经 DAP（readMemory / evaluate）从调试会话实时读取。
 *
 * 消息协议（webview → host）：
 *  ready                         → host 回 svd 元数据
 *  {cmd:'expand', periph}        → host 回该外设的寄存器定义
 *  {cmd:'read', items:[...]}     → 批量读值，回 values
 *  {cmd:'write', addr,size,value}→ 写寄存器（evaluate set），随后自行重读
 *  {cmd:'writeField', ...}       → 读-改-写位域
 * （host → webview）：svd / registers / values / session
 */

import * as vscode from 'vscode';
import { SvdDevice, SvdPeripheral } from '../svd/svdParser';

interface RegLite {
  name: string;
  address: number;
  size: number;
  access: string;
  description?: string;
}

export interface PeriphViewDeps {
  getSvd(): { device: SvdDevice; file: string } | undefined;
  getSvdStatus(): string | undefined;
  /** 当前可用的调试会话（cortex-debug），无则 undefined */
  getSession(): vscode.DebugSession | undefined;
  log(msg: string): void;
}

export class PeriphViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autoCmakeFlash.periph';
  private view?: vscode.WebviewView;
  private regCache = new Map<string, SvdPeripheral>();

  constructor(private readonly deps: PeriphViewDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.visible = true;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((m) => void this.onMessage(m));
    // 面板重新可见时推送当前 SVD 状态；不可见时停止采样（省去无谓的微停机）
    view.onDidChangeVisibility(() => {
      this.visible = view.visible;
      if (view.visible) {
        this.pushSvd();
        this.pushSession();
      }
    });
  }

  private visible = false;
  /** 读取失败诊断：限频 10s 记录一条真实报错，避免刷屏 */
  private lastErrLog = 0;

  private logErr(context: string, e: unknown): void {
    const now = Date.now();
    if (now - this.lastErrLog > 10_000) {
      this.lastErrLog = now;
      this.deps.log(`外设面板读取诊断 (${context}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 外部通知：SVD 已解析/变更 */
  setSvd(device: SvdDevice, file: string): void {
    this.regCache.clear();
    for (const p of device.peripherals) {
      this.regCache.set(p.name, p);
    }
    this.file = file;
    this.device = device;
    this.pushSvd();
  }

  /** 外部通知：调试会话变化 */
  pushSession(): void {
    if (!this.view) {
      return;
    }
    const s = this.deps.getSession();
    void this.view.webview.postMessage({
      cmd: 'session',
      active: !!s,
      name: s?.name,
      // probe-rs 引擎 = 运行中旁路直读，无需微停机采样，隐藏「运行监视」按钮
      engine: s ? (s.type === 'probe-rs-debug' ? 'probe-rs' : 'cortex-debug') : undefined,
    });
  }

  private file?: string;
  private device?: SvdDevice;

  private async onMessage(m: {
    cmd?: string;
    periph?: string;
    items?: { key: string; addr: number; size: number }[];
    addr?: number;
    size?: number;
    value?: number;
    mask?: number;
    monitor?: boolean;
  }): Promise<void> {
    switch (m.cmd) {
      case 'ready':
        this.pushSvd();
        this.pushSession();
        break;
      case 'expand': {
        const p = m.periph ? this.regCache.get(m.periph) : undefined;
        if (!p || !this.view) {
          return;
        }
        // 寄存器定义（含位域/枚举）全量下发，webview 端解析枚举标签
        const regs = p.registers.map((r) => ({
          name: r.name,
          address: r.address,
          size: r.size,
          access: r.access,
          description: r.description,
          fields:
            r.fields.length > 0
              ? r.fields.map((f) => ({
                  name: f.name,
                  bitOffset: f.bitOffset,
                  bitWidth: f.bitWidth,
                  enumerated: f.enumerated,
                }))
              : undefined,
        }));
        await this.view.webview.postMessage({ cmd: 'registers', periph: p.name, registers: regs });
        break;
      }
      case 'read': {
        if (!this.visible) {
          return; // 面板不可见时不采样
        }
        const values = await this.readAll(m.items ?? [], !!m.monitor);
        await this.view?.webview.postMessage({ cmd: 'values', values, monitor: !!m.monitor });
        break;
      }
      case 'write': {
        const ok = await this.writeAddr(m.addr ?? 0, m.size ?? 32, m.value ?? 0);
        await this.view?.webview.postMessage({ cmd: 'written', addr: m.addr, ok });
        break;
      }
      case 'writeField': {
        const ok = await this.writeField(m.addr ?? 0, m.size ?? 32, m.mask ?? 0xffffffff, m.value ?? 0);
        await this.view?.webview.postMessage({ cmd: 'written', addr: m.addr, ok });
        break;
      }
      default:
        break;
    }
  }

  private pushSvd(): void {
    if (!this.view) {
      return;
    }
    const svd = this.deps.getSvd();
    void this.view.webview.postMessage({
      cmd: 'svd',
      file: svd?.file ?? this.file,
      deviceName: svd?.device.deviceName,
      status: svd
        ? `${svd.device.peripherals.length} 个外设`
        : this.deps.getSvdStatus() ?? '未加载 SVD',
      peripherals:
        svd?.device.peripherals.map((p) => ({
          name: p.name,
          base: p.baseAddress,
          desc: p.description ?? p.title ?? '',
          regCount: p.registers.length,
        })) ?? [],
    });
  }

  // ---------------- DAP 访问 ----------------

  private session(): vscode.DebugSession | undefined {
    const s = this.deps.getSession();
    return s && (s.type === 'cortex-debug' || s.type === 'probe-rs-debug') ? s : undefined;
  }

  private async readAll(
    items: { key: string; addr: number; size: number }[],
    monitor: boolean,
  ): Promise<Record<string, { hex: string; ok: boolean }>> {
    const s = this.session();
    const out: Record<string, { hex: string; ok: boolean }> = {};
    if (!s) {
      for (const it of items) {
        out[it.key] = { hex: '—', ok: false };
      }
      return out;
    }
    // 按地址分组批量读取：每个分组一次 readMemory 往返，
    // 把运行监视的暂停窗口从 N 次往返压缩到 1-2 次
    const groups = groupRanges(items);
    const failed: { key: string; addr: number; size: number }[] = [];
    await Promise.all(
      groups.map(async (g) => {
        const buf = await this.readBlock(s, g.start, g.len);
        if (!buf) {
          for (const it of g.items) {
            failed.push(it);
            out[it.key] = { hex: '…', ok: false };
          }
          return;
        }
        for (const it of g.items) {
          out[it.key] = { hex: this.toHex(buf.subarray(it.addr - g.start), it.size), ok: true };
        }
      }),
    );
    // 运行监视（微停机采样）仅用于 cortex-debug 停机式引擎。
    // probe-rs 支持运行中旁路直读（Keil 同机制）——旁路读取本身不打扰程序，
    // 若个别时刻读失败（目标瞬断等）保持旧值显示，绝不做暂停采样（会导致程序顿挫闪烁）。
    const nonIntrusive = s.type === 'probe-rs-debug';
    if (failed.length > 0 && monitor && !nonIntrusive) {
      await this.sampleWhileRunning(s, async () => {
        await Promise.all(
          groups
            .filter((g) => g.items.some((it) => failed.includes(it)))
            .map(async (g) => {
              const buf = await this.readBlock(s, g.start, g.len);
              if (!buf) {
                return;
              }
              for (const it of g.items) {
                if (!failed.includes(it)) {
                  continue;
                }
                out[it.key] = { hex: this.toHex(buf.subarray(it.addr - g.start), it.size), ok: true };
              }
            }),
        );
      });
    }
    return out;
  }

  private async readBlock(s: vscode.DebugSession, addr: number, len: number): Promise<Buffer | undefined> {
    try {
      const r = (await s.customRequest('readMemory', {
        memoryReference: `0x${addr.toString(16)}`,
        count: len,
      })) as { data?: string };
      const buf = Buffer.from(r?.data ?? '', 'base64');
      return buf.length > 0 ? buf : undefined;
    } catch (e) {
      this.logErr(`readMemory 0x${addr.toString(16)}`, e);
      return undefined;
    }
  }

  /** 微停机采样：暂停目标 → 执行读取 → 立即恢复。返回读取是否成功 */
  private async sampleWhileRunning(s: vscode.DebugSession, fn: () => Promise<void>): Promise<boolean> {
    // 暂停（目标运行中时 gdb 列不出线程，threadId 允许缺省）
    let pre: number | undefined;
    try {
      pre = await this.tryThreadId(s);
    } catch (e) {
      this.logErr('threads(暂停前)', e);
    }
    try {
      await s.customRequest('pause', pre !== undefined ? { threadId: pre } : {});
    } catch (e) {
      this.logErr('pause', e);
      return false;
    }
    // 暂停后再取线程 ID（停机状态下可靠）；稍等 gdb 稳定，最多重试两次
    await delay(20);
    let threadId = await this.tryThreadId(s);
    if (threadId === undefined) {
      await delay(100);
      threadId = await this.tryThreadId(s);
    }
    let ok = true;
    try {
      await fn();
    } catch {
      ok = false;
    }
    // 恢复运行：必须有有效 threadId；取不到则保持暂停并明确提示，绝不发空参数
    if (threadId === undefined) {
      this.deps.log('运行监视: 无法获取线程 ID，目标保持暂停 — 请手动点继续（F5）');
      return ok;
    }
    try {
      await s.customRequest('continue', { threadId });
    } catch {
      // 一次重试：重新获取线程后再试
      await delay(60);
      const tid2 = await this.tryThreadId(s);
      try {
        if (tid2 === undefined) {
          throw new Error('未获取到线程');
        }
        await s.customRequest('continue', { threadId: tid2 });
      } catch (e2) {
        this.deps.log(`运行监视: 恢复运行失败，目标保持暂停 — 请手动点继续（F5）— ${e2 instanceof Error ? e2.message : String(e2)}`);
      }
    }
    return ok;
  }

  private async tryThreadId(s: vscode.DebugSession): Promise<number | undefined> {
    try {
      const th = (await s.customRequest('threads')) as { threads?: { id: number }[] };
      return th?.threads && th.threads.length > 0 ? th.threads[0].id : undefined;
    } catch {
      return undefined;
    }
  }

  private toHex(buf: Buffer, bits: number): string {
    // SVD 外设寄存器为小端内存映像
    const bytes = Math.max(1, Math.ceil(bits / 8));
    let v = 0n;
    for (let i = 0; i < bytes && i < buf.length; i++) {
      v |= BigInt(buf[i]) << BigInt(8 * i);
    }
    const width = Math.ceil(bits / 4);
    return `0x${v.toString(16).toUpperCase().padStart(width, '0')}`;
  }

  private async writeAddr(addr: number, bits: number, value: number): Promise<boolean> {
    const s = this.session();
    if (!s) {
      return false;
    }
    const type = bits <= 8 ? 'unsigned char' : bits <= 16 ? 'unsigned short' : 'unsigned int';
    try {
      await s.customRequest('evaluate', {
        expression: `set {${type}}0x${addr.toString(16)} = 0x${value.toString(16)}`,
        context: 'repl',
      });
      this.deps.log(`外设写入: [0x${addr.toString(16)}] = 0x${value.toString(16)}`);
      return true;
    } catch (e) {
      this.deps.log(`外设写入失败 [0x${addr.toString(16)}]: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  private async writeField(addr: number, bits: number, mask: number, value: number): Promise<boolean> {
    // 读-改-写
    const s = this.session();
    if (!s) {
      return false;
    }
    try {
      const r = (await s.customRequest('readMemory', {
        memoryReference: `0x${addr.toString(16)}`,
        count: Math.max(1, Math.ceil(bits / 8)),
      })) as { data?: string };
      const buf = Buffer.from(r?.data ?? '', 'base64');
      let v = 0n;
      const bytes = Math.max(1, Math.ceil(bits / 8));
      for (let i = 0; i < bytes; i++) {
        v |= BigInt(buf[i] ?? 0) << BigInt(8 * i);
      }
      const nv = (v & ~BigInt(mask)) | (BigInt(value) << BigInt(lowestBit(mask)));
      return await this.writeAddr(addr, bits, Number(nv));
    } catch {
      return false;
    }
  }

  // ---------------- 页面 ----------------

  private html(): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      :root { --ac: #58b6f8; --ok: #4ec994; --dim: rgba(128,128,128,.35); }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body { margin: 0; font-family: var(--vscode-font-family); font-size: 12.5px;
             color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
             display: flex; flex-direction: column; overflow: hidden; }
      #top { padding: 8px 10px 6px; border-bottom: 1px solid var(--dim); }
      .row { display: flex; gap: 6px; align-items: center; }
      input[type=text] { flex: 1; min-width: 0; padding: 5px 9px; border-radius: 6px;
        border: 1px solid var(--vscode-input-border, var(--dim));
        background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
      input[type=text]:focus { outline: none; border-color: var(--ac); }
      #psel { width: 100%; padding: 5px 9px; border-radius: 6px; margin-bottom: 2px;
        border: 1px solid var(--vscode-input-border, var(--dim));
        background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
      button { font-family: inherit; font-size: 12px; padding: 4px 12px; border-radius: 6px;
        cursor: pointer; border: 1px solid transparent;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground); white-space: nowrap; }
      button:hover { filter: brightness(1.2); }
      button.ac { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      #stat { margin-top: 6px; font-size: 11px; color: var(--vscode-descriptionForeground); }
      .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%;
             background: #777; margin-right: 6px; vertical-align: middle; }
      .dot.ok { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
      .dot.err { background: #f14c4c; }
      #main { flex: 1; display: grid; grid-template-columns: minmax(210px, 26%) 1fr;
              gap: 10px; padding: 8px 10px; overflow: hidden; min-height: 0; }
      .pane { overflow-y: auto; min-height: 0; }
      #left { border-right: 1px solid var(--dim); padding-right: 8px; }
      .cap { font-size: 11px; color: var(--vscode-descriptionForeground);
             text-transform: uppercase; letter-spacing: .08em; margin: 8px 0 5px; }
      .pi { padding: 5px 9px; border-radius: 6px; cursor: pointer; margin-bottom: 2px;
            border: 1px solid transparent; display: flex; align-items: center; gap: 7px; }
      .pi:hover { background: color-mix(in srgb, var(--vscode-foreground) 7%, transparent); }
      .pi.on { border-color: color-mix(in srgb, var(--ac) 55%, transparent);
               background: color-mix(in srgb, var(--ac) 14%, transparent); }
      .pi .nm { font-weight: 600; }
      .pi .b { margin-left: auto; font-size: 10px; color: var(--vscode-descriptionForeground); }
      .ri { padding: 4px 8px; border-radius: 5px; cursor: pointer; display: flex;
            align-items: center; gap: 6px; margin-bottom: 1px; }
      .ri:hover { background: color-mix(in srgb, var(--vscode-foreground) 7%, transparent); }
      .ri.on { background: color-mix(in srgb, var(--ac) 16%, transparent); }
      .ri .n { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600; }
      .ri .v { margin-left: auto; font-family: var(--vscode-editor-font-family, monospace);
               font-size: 12.5px; font-weight: 600; color: var(--ac); }
      .card { border: 1px solid var(--dim); border-radius: 10px; padding: 14px 16px;
              background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
              margin-bottom: 12px; }
      .card h3 { margin: 0; font-size: 16px; }
      .badge { font-size: 10px; padding: 2px 8px; border-radius: 9px;
               background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
               color: var(--vscode-descriptionForeground); vertical-align: middle; }
      .badge.ro { color: #e2b93d; }
      .sub { font-size: 11px; color: var(--vscode-descriptionForeground); margin: 2px 0 0; }
      .desc { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
      .bigrow { display: flex; align-items: center; gap: 10px; margin: 12px 0 4px; }
      .bigval { font-family: var(--vscode-editor-font-family, monospace); font-size: 22px;
                font-weight: 600; color: var(--ac); letter-spacing: .04em;
                background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
                border: 1px solid var(--dim); border-radius: 8px; padding: 4px 12px; width: 190px; }
      .bigval:focus { outline: none; border-color: var(--ac); }
      .hint { font-size: 11px; color: var(--vscode-descriptionForeground); }
      .bits { display: grid; grid-template-columns: repeat(16, 46px); gap: 3px; justify-content: start; margin-top: 10px; }
      .b { width: 46px; height: 46px; border-radius: 6px; text-align: center; padding: 4px 0 5px;
           border: 1px solid var(--dim); user-select: none; }
      .b .i { font-size: 9px; color: var(--vscode-descriptionForeground); }
      .b .v { font-family: var(--vscode-editor-font-family, monospace); font-size: 14px; font-weight: 700; }
      .b .fn { font-size: 9px; color: var(--vscode-descriptionForeground); overflow: hidden;
               white-space: nowrap; text-overflow: ellipsis; }
      .b.on { background: color-mix(in srgb, var(--ok) 22%, transparent);
              border-color: color-mix(in srgb, var(--ok) 60%, transparent); color: var(--ok); }
      .b.rw { cursor: pointer; }
      .b.rw:hover { border-color: var(--ac); filter: brightness(1.3); }
      .b.sent { border-color: var(--ok) !important; color: var(--ok); box-shadow: 0 0 8px color-mix(in srgb, var(--ok) 60%, transparent); }
      .leds { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
      .led { text-align: center; cursor: pointer; user-select: none; }
      .bulb { width: 26px; height: 26px; border-radius: 50%; margin: 0 auto 3px;
              background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
              border: 2px solid var(--dim); transition: all .12s; }
      .bulb.on { background: radial-gradient(circle at 35% 30%, #b8f5d8, var(--ok) 65%);
                 border-color: var(--ok); box-shadow: 0 0 10px color-mix(in srgb, var(--ok) 70%, transparent); }
      .led .pl { font-size: 10px; color: var(--vscode-descriptionForeground);
                 font-family: var(--vscode-editor-font-family, monospace); }
      .led:hover .bulb { border-color: var(--ac); }
      .frow { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
      .frange { font-size: 10px; color: var(--vscode-descriptionForeground); min-width: 46px; }
      .fname2 { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600; }
      .fenum { font-size: 11px; color: var(--ok); min-width: 100px; }
      .fin { width: 58px; text-align: center; font-family: var(--vscode-editor-font-family, monospace);
             padding: 2px 4px; border-radius: 4px; border: 1px solid var(--dim);
             background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
      .fin:focus { outline: none; border-color: var(--ac); }
      .empty { padding: 30px 12px; text-align: center; color: var(--vscode-descriptionForeground); line-height: 1.7; }
    </style></head><body>

        <div class="pane" id="left"></div>
        <div class="pane" id="right"></div>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        const state = { svd: false, periphs: [], active: null, regs: [], sel: null,
                        vals: {}, q: '', engine: undefined, session: false, frowFields: [] };
        const $ = (id) => document.getElementById(id);
        const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
        function post(m) { vscode.postMessage(m); }

        function render() {
          const q = state.q.toUpperCase();
          const left = $('left');
          if (!state.svd) { left.innerHTML = '<div class="empty">等待调试会话…</div>'; return; }
          // 左栏以寄存器列表为主：外设用下拉框选择，列表占满剩余空间
          const regs = state.regs.filter(r => !q || r.name.toUpperCase().includes(q));
          let h = '<div class="cap">外设</div>';
          h += '<select id="psel">' + state.periphs.map(p =>
            '<option value="' + esc(p.name) + '"' + (p.name === state.active ? ' selected' : '') + '>' +
            esc(p.name) + ' · 0x' + p.base.toString(16).toUpperCase() + '</option>').join('') + '</select>';
          h += '<div class="cap">寄存器 (' + regs.length + ') · 实时</div>';
          h += regs.map(r => {
            const v = state.vals[state.active + '.' + r.name];
            return '<div class="ri' + (r.name === state.sel ? ' on' : '') + '" data-r="' + esc(r.name) + '">' +
              '<span class="n">' + esc(r.name) + '</span>' +
              '<span class="v">' + esc((v || {}).hex || '') + '</span></div>';
          }).join('');
          if (regs.length === 0) h += '<div class="hint">' + (state.active ? '无匹配寄存器' : '先选择外设') + '</div>';
          left.innerHTML = h;
          const psel = $('psel');
          if (psel) psel.onchange = () => pickPeriph(psel.value);
          left.querySelectorAll('.ri').forEach(el => el.onclick = () => pickReg(el.getAttribute('data-r')));
        }

        function renderRight() {
          const right = $('right');
          if (!state.active) {
            right.innerHTML = '<div class="empty">← 选择一个外设<br><br>程序运行时即可实时查看寄存器' +
              (state.engine === 'probe-rs' ? '（probe-rs 引擎：旁路直读零干扰）' : '') + '</div>';
            return;
          }
          const base = state.periphs.find(p => p.name === state.active);
          const isGpio = state.active.indexOf('GPIO') === 0;
          let h = '';
          if (isGpio) {
            h += '<div class="card"><div class="cap" style="margin-top:0">引脚状态 · 点 LED 翻转输出电平</div><div class="leds" id="leds"></div></div>';
          }
          const r = curReg();
          if (r) {
            const ro = r.access === 'read-only';
            h += '<div class="card"><div class="row" style="justify-content:space-between">' +
              '<h3>' + esc(r.name) + ' <span class="badge ' + (ro ? 'ro' : '') + '">' + (ro ? 'RO' : 'RW') + '</span></h3>' +
              '<span style="color:var(--vscode-descriptionForeground)" class="mono">0x' + r.address.toString(16).toUpperCase() + '</span></div>' +
              '<div class="desc">' + esc(r.description || '') + '</div>' +
              '<div class="bigrow"><input id="bigv" class="bigval"' + (ro ? ' readonly' : '') + ' placeholder="—"> ' +
              '<span class="hint">输入十六进制 · 回车写入</span></div>' +
              '<div class="bits" id="bits"></div></div>';
          } else {
            h += '<div class="empty">↑ 在左侧选择一个寄存器查看内容</div>';
          }
          right.innerHTML = h;
          buildBits();
          if (isGpio) { buildLeds(); }
          bindDetail();
          updateVals();
        }

        function curReg() { return state.regs.find(r => r.name === state.sel); }

        /** 填充 GPIO 引脚 LED 状态板（16 个引脚，点击翻转输出电平） */
        function buildLeds() {
          const wrap = $('leds'); if (!wrap) return;
          const shortName = state.active.replace('GPIO', '');
          let h = '';
          for (let pin = 0; pin < 16; pin++) {
            h += '<div class="led" data-pin="' + pin + '" title="点击翻转 ' + esc('P' + shortName + pin) + ' 输出电平">' +
              '<div class="bulb"></div><div class="pl">' + esc(shortName) + pin + '</div></div>';
          }
          wrap.innerHTML = h;
          wrap.querySelectorAll('.led').forEach(el => {
            el.onclick = () => {
              const pin = +el.getAttribute('data-pin');
              const odr = state.regs.find(x => x.name === 'ODR');
              if (!odr || odr.access === 'read-only') return;
              const v = state.vals[state.active + '.ODR'];
              const cur = v && v.ok ? parseInt(v.hex, 16) : 0;
              post({ cmd: 'write', addr: odr.address, size: odr.size, value: (cur ^ (1 << pin)) >>> 0 });
            };
          });
        }

        function pickPeriph(name) {
          if (state.active === name) return;
          state.active = name; state.sel = null; state.vals = {}; state.regs = [];
          post({ cmd: 'expand', periph: name });
          render(); renderRight();
        }
        function pickReg(name) { state.sel = name; render(); renderRight(); }

        function buildBits() {
          const r = curReg(); if (!r) return;
          const wrap = $('bits'); if (!wrap) return;
          const ro = r.access === 'read-only';
          const fields = r.fields || [];
          let h = '';
          for (let b = r.size - 1; b >= 0; b--) {
            const f = fields.find(x => b >= x.bitOffset && b < x.bitOffset + x.bitWidth);
            h += '<div class="b' + (ro ? '' : ' rw') + '" data-bit="' + b + '"' + (f ? ' title="' + esc(f.name) + '"' : (ro ? '' : ' title="点击翻转 bit ' + b + ' 并写入"')) + '>' +
              '<div class="i">' + b + '</div><div class="v">·</div>' +
              '<div class="fn">' + esc(f ? f.name : '') + '</div></div>';
          }
          wrap.innerHTML = h;
          wrap.querySelectorAll('.b.rw').forEach(el => {
            el.onclick = () => {
              const bit = +el.getAttribute('data-bit');
              // 只写寄存器（如 BSRR）：点格子 = 直接写该位为 1，无需读旧值
              if (r.access === 'write-only') {
                post({ cmd: 'write', addr: r.address, size: r.size, value: (1 << bit) >>> 0 });
                el.classList.add('sent');
                setTimeout(() => el.classList.remove('sent'), 350);
                return;
              }
              const v = state.vals[state.active + '.' + state.sel];
              if (!v || !v.ok) return;
              const nv = ((parseInt(v.hex, 16) ^ (1 << bit)) >>> 0);
              post({ cmd: 'write', addr: r.address, size: r.size, value: nv });
            };
          });
        }

        function updateVals() {
          for (const k in state.vals) {
            const v = state.vals[k];
            const rn = k.split('.').pop();
            const el = document.querySelector('.ri[data-r="' + rn + '"] .v');
            if (el) el.textContent = v.hex;
          }
          const r = curReg(); if (!r) return;
          const v = state.vals[state.active + '.' + r.name];
          const big = $('bigv');
          if (big && document.activeElement !== big && v && v.hex) big.value = v.hex;
          const wrap = $('bits'); if (!wrap) return;
          const num = v && v.ok ? parseInt(v.hex, 16) : null;
          wrap.querySelectorAll('.b').forEach(el => {
            const bit = +el.getAttribute('data-bit');
            const on = num !== null ? ((num >> bit) & 1) === 1 : false;
            el.classList.toggle('on', on);
            el.querySelector('.v').textContent = num !== null ? (on ? '1' : '0') : '·';
          });
          if (state.active.indexOf('GPIO') === 0) {
            const odr = state.regs.find(x => x.name === 'ODR');
            const idr = state.regs.find(x => x.name === 'IDR');
            if (odr && idr) {
              const ov = state.vals[state.active + '.ODR'], iv = state.vals[state.active + '.IDR'];
              const onum = ov && ov.ok ? parseInt(ov.hex, 16) : 0;
              const inum = iv && iv.ok ? parseInt(iv.hex, 16) : 0;
              const short = state.active.replace('GPIO', '');
              $('leds').querySelectorAll('.led').forEach(el => {
                const pin = +el.getAttribute('data-pin');
                el.querySelector('.bulb').classList.toggle('on', ((inum >> pin) & 1) === 1);
              });
              void short;
            }
          }
        }

        function tick() {
          // 会话标志仅作提示用途：读取交给 host 判定（host 无会话时返回 —），
          // 避免标志时序问题导致面板空转不读
          if (!state.active || state.regs.length === 0) return;
          const items = state.regs.map(r => ({ key: state.active + '.' + r.name, addr: r.address, size: r.size }));
          post({ cmd: 'read', items: items, monitor: true });
        }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.cmd === 'svd') {
            state.svd = !!m.file;
            state.periphs = m.peripherals || [];
            if (state.periphs.length && !state.active) {
              const pref = state.periphs.find(p => p.name.indexOf('GPIO') === 0) || state.periphs[0];
              state.active = pref.name;
              post({ cmd: 'expand', periph: pref.name });
            }
            render(); renderRight();
          } else if (m.cmd === 'registers') {
            state.regs = m.registers || [];
            state.sel = state.regs.length ? state.regs[0].name : null;
            render(); renderRight(); tick();
          } else if (m.cmd === 'values') {
            state.vals = m.values || {};
            updateVals(); // 只更新文字节点，不重建左栏（否则下拉框点开就被销毁）
          } else if (m.cmd === 'session') {
            state.session = m.active; state.engine = m.engine;
            if (!m.active) { state.vals = {}; updateVals(); }
} else if (m.cmd === 'written') { tick(); }
        });



        document.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter') return;
          const big = $('bigv');
          if (document.activeElement === big && big.value) {
            const r = curReg(); if (!r) return;
            post({ cmd: 'write', addr: r.address, size: r.size, value: parseInt(big.value, 16) || 0 });
            big.blur();
          }
        });

        state.timer = setInterval(tick, 200);

        post({ cmd: 'ready' });
      </script>
    </body></html>`;
  }

}

function lowestBit(mask: number): number {
  let n = 0;
  while (n < 32 && (mask & 1) === 0) {
    mask >>>= 1;
    n++;
  }
  return n;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ReadItem {
  key: string;
  addr: number;
  size: number;
}

interface ReadGroup {
  start: number;
  len: number;
  items: ReadItem[];
}

/** 把寄存器按地址聚成分组（相邻间隔 ≤48B 合并，单组 ≤1KB），最小化读取往返 */
function groupRanges(items: ReadItem[]): ReadGroup[] {
  const sorted = [...items].sort((a, b) => a.addr - b.addr);
  const groups: ReadGroup[] = [];
  let cur: ReadGroup | undefined;
  for (const it of sorted) {
    const end = it.addr + Math.max(1, Math.ceil(it.size / 8));
    if (
      cur &&
      it.addr - (cur.start + cur.len) <= 48 &&
      end - cur.start <= 1024
    ) {
      cur.len = end - cur.start;
      cur.items.push(it);
    } else {
      cur = { start: it.addr, len: end - it.addr, items: [it] };
      groups.push(cur);
    }
  }
  return groups;
}
