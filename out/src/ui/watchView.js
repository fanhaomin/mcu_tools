"use strict";
/**
 * 「变量监控」WebviewView：Keil 风格的实时变量观察窗。
 * 变量经 evaluate 解析出地址与大小后按 readMemory 实时读取；
 * probe-rs 引擎运行中旁路直读（可到 50ms），cortex-debug 引擎自动微停机采样。
 * 条目持久化在 workspaceState（每个工程独立）。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WatchViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const dapHelpers_1 = require("../debug/dapHelpers");
const hexdump_1 = require("../debug/hexdump");
const dapHelpers_2 = require("../debug/dapHelpers");
const symbols_1 = require("../debug/symbols");
const fs = __importStar(require("fs"));
const STORE_KEY = 'acf.watch.entries';
const MAX_ENTRIES = 16;
class WatchViewProvider {
    deps;
    static viewType = 'autoCmakeFlash.watch';
    view;
    visible = false;
    entries = [];
    symCache;
    symLoading;
    /** 加载 ELF 符号表（按 mtime 缓存；nm 失败返回空表不报错） */
    async ensureSymbols() {
        const elf = await this.deps.getElf();
        const nm = this.deps.getNm();
        if (!elf || !nm) {
            return new Map();
        }
        let mtimeMs = 0;
        try {
            mtimeMs = fs.statSync(elf).mtimeMs;
        }
        catch {
            return new Map();
        }
        if (this.symCache?.elf === elf && this.symCache.mtimeMs === mtimeMs) {
            return this.symCache.map;
        }
        if (!this.symLoading) {
            const isNew = !this.symCache || this.symCache.elf !== elf || this.symCache.mtimeMs !== mtimeMs;
            this.symLoading = (0, symbols_1.readSymbolTable)(nm, elf).then((map) => {
                this.symCache = { elf, mtimeMs, map };
                if (isNew && map.size > 0) {
                    // 新 ELF 可用：清除此前的解析失败标记，允许重试
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
                this.postEntries();
            }
        });
        this.entries = this.deps.memento.get(STORE_KEY, []);
        this.postEntries();
        void this.view?.webview.postMessage({ cmd: 'interval', ms: this.deps.getInterval() });
    }
    /** 推送统一刷新间隔（设置变更时调用） */
    setIntervalMs(ms) {
        void this.view?.webview.postMessage({ cmd: 'interval', ms });
    }
    async persist() {
        await this.deps.memento.update(STORE_KEY, this.entries);
    }
    async onMessage(m) {
        switch (m.cmd) {
            case 'ready':
                this.postEntries();
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
                const addrMatch = /^0x[0-9a-fA-F]{1,8}$/.exec(expr);
                this.entries.push(addrMatch
                    ? { expr, addr: parseInt(expr, 16), bytes: 4 }
                    : { expr, bytes: 4 });
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
    postEntries() {
        void this.view?.webview.postMessage({ cmd: 'entries', entries: this.entries });
    }
    /** 解析 &表达式 → 地址，sizeof → 字节数（限频 1s；失败保持旧值继续重试） */
    async resolveEntry(s, e, inSample) {
        if (e.addr !== undefined && Date.now() - (e.lastResolve ?? 0) < 5_000) {
            return;
        }
        const now = Date.now();
        if (!inSample && e.lastResolve !== undefined && now - e.lastResolve < 1_000) {
            return;
        }
        e.lastResolve = now;
        try {
            const addrR = (await s.customRequest('evaluate', {
                expression: `&(${e.expr})`,
                context: 'repl',
            }));
            const addr = (0, hexdump_1.parseEvalHexAddress)(addrR?.result ?? '');
            if (addr === undefined) {
                return;
            }
            e.addr = addr;
            const sizeR = (await s.customRequest('evaluate', {
                expression: `sizeof(${e.expr})`,
                context: 'repl',
            }));
            const size = (0, hexdump_1.parseEvalInt)(sizeR?.result ?? '');
            if (size && size > 0 && size <= 256) {
                e.bytes = size;
            }
            this.deps.log(`变量监控: ${e.expr} @ 0x${addr.toString(16)} (${e.bytes} bytes)`);
        }
        catch {
            // 目标运行中（cortex-debug）无法 evaluate：留给微停机窗口处理
        }
    }
    async refresh(intervalMs) {
        const s = this.deps.getSession();
        if (!s || this.entries.length === 0) {
            return;
        }
        const nonIntrusive = s.type === 'probe-rs-debug';
        const results = {};
        const failed = [];
        // 1. 已解析地址的：旁路读取
        await Promise.all(this.entries
            .filter((e) => e.addr !== undefined)
            .map(async (e) => {
            const buf = await (0, dapHelpers_1.readBlock)(s, e.addr, e.bytes);
            if (buf) {
                results[e.expr] = {
                    hex: (0, dapHelpers_2.toHexLE)(buf, e.bytes * 8),
                    ok: true,
                    bytes: e.bytes,
                    addr: e.addr,
                };
            }
            else {
                failed.push(e);
                results[e.expr] = { hex: '…', ok: false, bytes: e.bytes, addr: e.addr };
            }
        }));
        // 2. 未解析的：优先查 ELF 符号表（离线、零停顿、双引擎通用）
        const unresolved = this.entries.filter((e) => e.addr === undefined);
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
                    e.bytes = Math.max(1, Math.min(256, hit.size));
                    e.resolveFailed = false;
                    this.deps.log('变量监控: ' + e.expr + ' @ 0x' + hit.addr.toString(16) + ' (' + e.bytes + 'B，来自 ELF 符号表)');
                }
            }
            const bySym = this.entries.filter((e) => e.addr !== undefined && unresolved.includes(e));
            await Promise.all(bySym.map(async (e) => {
                const buf = await (0, dapHelpers_1.readBlock)(s, e.addr, e.bytes);
                if (buf) {
                    results[e.expr] = {
                        hex: (0, dapHelpers_2.toHexLE)(buf, e.bytes * 8),
                        ok: true,
                        bytes: e.bytes,
                        addr: e.addr,
                    };
                }
            }));
        }
        if (unresolved.length > 0) {
            if (nonIntrusive) {
                await Promise.all(unresolved.map(async (e) => {
                    await this.resolveEntry(s, e, false);
                    if (e.addr !== undefined) {
                        const buf = await (0, dapHelpers_1.readBlock)(s, e.addr, e.bytes);
                        if (buf) {
                            results[e.expr] = {
                                hex: (0, dapHelpers_2.toHexLE)(buf, e.bytes * 8),
                                ok: true,
                                bytes: e.bytes,
                                addr: e.addr,
                            };
                        }
                    }
                }));
            }
            // probe-rs 运行中 evaluate 必然失败：2 秒后微停机一次完成解析
            const stillUnresolved = this.entries.filter((e) => e.addr === undefined);
            if (stillUnresolved.length > 0 && Date.now() - this.lastProbeSample > 2_000) {
                this.lastProbeSample = Date.now();
                this.deps.log('变量监控: 运行中无法解析符号，微停机一次完成解析（之后纯旁路读取）');
                await (0, dapHelpers_1.sampleWhileRunning)(s, this.deps.log, async () => {
                    await Promise.all(stillUnresolved.map(async (e) => {
                        await this.resolveEntry(s, e, true);
                        if (e.addr !== undefined) {
                            const buf = await (0, dapHelpers_1.readBlock)(s, e.addr, e.bytes);
                            if (buf) {
                                results[e.expr] = {
                                    hex: (0, dapHelpers_2.toHexLE)(buf, e.bytes * 8),
                                    ok: true,
                                    bytes: e.bytes,
                                    addr: e.addr,
                                };
                            }
                        }
                    }));
                });
            }
        }
        // 3. cortex-debug：读取失败或未解析 → 微停机窗口统一处理
        if ((!nonIntrusive && (failed.length > 0 || unresolved.length > 0)) ||
            (nonIntrusive && unresolved.some((e) => e.addr === undefined && this.readFailedRecently))) {
            await (0, dapHelpers_1.sampleWhileRunning)(s, this.deps.log, async () => {
                await Promise.all(this.entries.map(async (e) => {
                    if (e.addr === undefined) {
                        await this.resolveEntry(s, e, true);
                    }
                    if (e.addr === undefined) {
                        return;
                    }
                    const buf = await (0, dapHelpers_1.readBlock)(s, e.addr, e.bytes);
                    if (buf) {
                        results[e.expr] = {
                            hex: (0, dapHelpers_2.toHexLE)(buf, e.bytes * 8),
                            ok: true,
                            bytes: e.bytes,
                            addr: e.addr,
                        };
                    }
                }));
            });
        }
        void this.view?.webview.postMessage({ cmd: 'values', values: results });
    }
    readFailedRecently = false;
    lastProbeSample = 0;
    lastEmptySymLog = 0;
    html() {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: var(--vscode-font-family); font-size: 12.5px;
             color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
             margin: 0; padding: 8px 10px 20px; }
      .row { display: flex; gap: 6px; margin-bottom: 8px; }
      input[type=text] { flex: 1; min-width: 0; padding: 5px 9px; border-radius: 6px;
        border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35));
        background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
      input[type=text]:focus { outline: none; border-color: var(--ac); }
      :root { --ac: #58b6f8; --ok: #4ec994; }
      button { font-family: inherit; font-size: 12px; padding: 4px 12px; border-radius: 6px;
        cursor: pointer; border: 1px solid transparent;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      button.ghost { background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground); }
      .item { display: flex; align-items: center; gap: 8px; padding: 5px 9px;
        border: 1px solid rgba(128,128,128,.22); border-radius: 8px; margin-bottom: 4px;
        background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent); }
      .name { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .val { margin-left: auto; font-family: var(--vscode-editor-font-family, monospace);
        font-size: 13px; font-weight: 700; color: var(--ac); }
      .val.stale { color: var(--vscode-descriptionForeground); font-weight: 400; }
      .meta { font-size: 10px; color: var(--vscode-descriptionForeground); }
      .del { cursor: pointer; color: var(--vscode-descriptionForeground); padding: 0 4px; }
      .del:hover { color: #f14c4c; }
      .empty { padding: 14px 6px; color: var(--vscode-descriptionForeground);
        text-align: center; line-height: 1.7; }
      .row2 { display: flex; align-items: center; gap: 6px; margin: 8px 0 4px;
        font-size: 10.5px; color: var(--vscode-descriptionForeground); }
      select { padding: 3px 6px; border-radius: 5px; font-size: 11px;
        border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35));
        background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); }
    </style></head><body>
      <div class="row">
        <input id="expr" type="text" placeholder="变量名 / 表达式 / 0x地址（回车添加）">
        <button id="add">添加</button>
      </div>
      <div id="list"><div class="empty">添加要实时监控的变量<br>如 uwTick、(int)3.14 式表达式、&结构体字段</div></div>
      <div class="row2">probe-rs 引擎运行中旁路直读 · cortex-debug 自动微停机采样 · 刷新间隔在侧边栏「调试」分组设置</div>
      <script>
        const vscode = acquireVsCodeApi();
        const state = { entries: [], vals: {}, timer: null, interval: 200 };
        const $ = (id) => document.getElementById(id);
        const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
        function post(m) { vscode.postMessage(m); }

        function render() {
          const list = $('list');
          if (state.entries.length === 0) {
            list.innerHTML = '<div class="empty">添加要实时监控的变量<br>变量名（如 led_toggle_count）· 表达式（&arr[2]）· 0x20000000<br>提示：CMSIS 宏（如 SCB->VTOR）需工程带宏调试信息（-g3），否则请直接用其地址</div>';
            return;
          }
          list.innerHTML = state.entries.map((e) => {
            const v = state.vals[e.expr] || {};
            const hex = v.ok ? v.hex : (v.hex || '…');
            return '<div class="item" data-e="' + esc(e.expr) + '">' +
              '<div><div class="name">' + esc(e.expr) + '</div>' +
              '<div class="meta">' + (e.addr !== undefined ? '0x' + e.addr.toString(16).toUpperCase() + ' · ' + e.bytes + 'B' : (e.resolveFailed ? '无法解析 — 请改用 0x 地址' : '解析中…')) + '</div>' +
              '<span class="val' + (v.ok ? '' : ' stale') + '">' + esc(hex) + '</span>' +
              '<span class="del" title="移除">✕</span></div>';
          }).join('');
          list.querySelectorAll('.item').forEach((el) => {
            el.querySelector('.del').onclick = (ev) => {
              ev.stopPropagation();
              post({ cmd: 'remove', expr: el.getAttribute('data-e') });
            };
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
            render();
          } else if (m.cmd === 'values') {
            state.vals = m.values || {};
            render();
          }
        });

        function add() {
          const v = $('expr').value.trim();
          if (v) { post({ cmd: 'add', expr: v }); $('expr').value = ''; }
        }
        $('add').addEventListener('click', add);
        $('expr').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') add(); });
        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } });
        state.timer = setInterval(tick, state.interval);

        post({ cmd: 'ready' });
      </script>
    </body></html>`;
    }
}
exports.WatchViewProvider = WatchViewProvider;
//# sourceMappingURL=watchView.js.map