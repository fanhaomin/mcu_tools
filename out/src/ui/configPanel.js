"use strict";
/**
 * 「配置面板」WebviewPanel：在编辑器区域以标签页形式打开的设置界面，
 * 与外设面板同一设计语言（卡片分组、现代深色）。保存写入当前工程的
 * 工作区设置（仅当前工程生效）。
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
exports.ConfigPanel = void 0;
const vscode = __importStar(require("vscode"));
const workspaceSettings_1 = require("../config/workspaceSettings");
class ConfigPanel {
    log;
    panel;
    lastErrLog = 0;
    constructor(log) {
        this.log = log;
    }
    show() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Active);
            this.postSettings();
            return;
        }
        this.panel = vscode.window.createWebviewPanel('autoCmakeFlash.config', 'Embedded Debug 配置', { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true });
        this.panel.webview.html = this.html();
        this.panel.webview.onDidReceiveMessage((m) => void this.onMessage(m));
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
        this.postSettings();
    }
    fieldDefs() {
        return [
            {
                title: '构建',
                icon: '🔧',
                fields: [
                    { key: 'buildType', label: '构建类型', type: 'enum', options: ['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel'] },
                    { key: 'cmakeToolchainFile', label: 'CMake 工具链文件', type: 'text', hint: '留空 = 自动识别工程内 cmake/*.cmake' },
                    { key: 'cmakeExtraArgs', label: 'CMake 额外参数', type: 'text', hint: '空格分隔，可留空' },
                ],
            },
            {
                title: '烧录',
                icon: '🚀',
                fields: [
                    { key: 'downloadInterface', label: '烧录接口', type: 'enum', options: ['SWD', 'JTAG'] },
                    { key: 'downloadSpeedKhz', label: '连接速度 (kHz)', type: 'number' },
                    { key: 'resetAfterFlash', label: '烧录后复位', type: 'enum', options: ['hardware', 'software', 'none'] },
                    { key: 'binFlashAddress', label: 'BIN 烧录地址', type: 'text', hint: '如 0x08010000，烧 ELF/HEX 时留空' },
                ],
            },
            {
                title: '调试',
                icon: '🐛',
                fields: [
                    { key: 'probeRsChip', label: 'probe-rs 芯片名', type: 'text', hint: '如 STM32F103C8，留空按识别型号自动推导' },
                    { key: 'svdFile', label: 'SVD 文件路径', type: 'text', hint: '留空 = 按芯片型号自动定位' },
                ],
            },
            {
                title: '工具路径',
                icon: '🛠',
                fields: [
                    { key: 'cmakePath', label: 'CMake 路径', type: 'text', hint: '留空 = 自动探测' },
                    { key: 'ninjaPath', label: 'Ninja 路径', type: 'text', hint: '留空 = 自动探测' },
                    { key: 'armToolchainPath', label: 'ARM 工具链路径', type: 'text', hint: 'bin 目录或 gcc 完整路径，留空 = 自动探测' },
                    { key: 'programmerCliPath', label: 'CubeProgrammer CLI 路径', type: 'text', hint: '留空 = 自动探测' },
                    { key: 'cubemxPath', label: 'STM32CubeMX 路径', type: 'text', hint: 'STM32CubeMX.exe，留空 = 自动探测' },
                ],
            },
            {
                title: '高级',
                icon: '⚙',
                fields: [
                    { key: 'verboseLogging', label: '详细日志', type: 'bool' },
                    { key: 'buildTimeoutSec', label: '编译超时（秒）', type: 'number' },
                    { key: 'flashTimeoutSec', label: '烧录超时（秒）', type: 'number' },
                ],
            },
        ];
    }
    postSettings() {
        if (!this.panel) {
            return;
        }
        const s = loadSettingsSafe();
        void this.panel.webview.postMessage({
            cmd: 'settings',
            groups: this.fieldDefs(),
            values: s,
        });
    }
    async onMessage(m) {
        if (m.cmd !== 'save') {
            return;
        }
        const defs = this.fieldDefs().flatMap((g) => g.fields);
        const cur = loadSettingsSafe();
        let changed = 0;
        for (const def of defs) {
            const nv = m.values?.[def.key];
            const cv = cur[def.key];
            // undefined = 用户选"(默认)"或清空 → 走 API 移除自定义值（不能跳过，否则永远无法恢复默认）
            if (nv === cv) {
                continue;
            }
            let value = nv;
            if (def.type === 'number') {
                const num = Math.round(Number(nv));
                if (!Number.isFinite(num) || num <= 0) {
                    continue;
                }
                value = num;
            }
            else if (def.type === 'text') {
                // 空字符串 = 恢复默认
                value = String(nv).trim() === '' ? undefined : String(nv).trim();
            }
            if (value === cv) {
                continue;
            }
            try {
                await (0, workspaceSettings_1.updateWorkspaceSetting)(def.key, value);
                changed++;
                this.log(`配置已更新: ${def.key} = ${value === undefined ? '(默认)' : String(value)}`);
            }
            catch (e) {
                const now = Date.now();
                if (now - this.lastErrLog > 3000) {
                    this.lastErrLog = now;
                    this.log(`配置写入失败 (${def.key}): ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }
        void this.panel?.webview.postMessage({ cmd: 'saved', changed });
    }
    html() {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      :root { --ac: #58b6f8; --ok: #4ec994; --dim: rgba(128,128,128,.35); }
      body { font-family: var(--vscode-font-family); font-size: 12.5px;
             color: var(--vscode-foreground); background: var(--vscode-editor-background);
             margin: 0; padding: 0 0 40px; }
      #bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 10px;
             padding: 10px 16px; background: var(--vscode-editor-background);
             border-bottom: 1px solid var(--dim); }
      #bar h2 { margin: 0; font-size: 15px; }
      #bar .hint { font-size: 11px; color: var(--vscode-descriptionForeground); }
      #bar button { margin-left: auto; }
      button { font-family: inherit; font-size: 12.5px; padding: 5px 18px; border-radius: 6px;
        cursor: pointer; border: 1px solid transparent;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      button:hover { filter: brightness(1.2); }
      button.ghost { background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground); }
      #wrap { max-width: 760px; margin: 0 auto; padding: 12px 16px; }
      .card { padding: 14px 2px 10px; margin-bottom: 0;
              border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 10%, transparent); }
      .card:last-child { border-bottom: none; }
      .cap { font-size: 12px; font-weight: 700; letter-spacing: .06em; margin-bottom: 10px; }
      .frow { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
      .flabel { width: 190px; flex: 0 0 auto; }
      .flabel .l { font-weight: 600; }
      .flabel .h { font-size: 10.5px; color: var(--vscode-descriptionForeground); margin-top: 1px; }
      input[type=text], select { flex: 1; min-width: 0; padding: 5px 9px; border-radius: 6px;
        border: 1px solid var(--vscode-input-border, var(--dim));
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
      input[type=text]:focus, select:focus { outline: none; border-color: var(--ac); }
      input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--ac); cursor: pointer; }
      #toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
        padding: 8px 22px; border-radius: 8px; font-size: 12.5px; opacity: 0;
        transition: opacity .25s; pointer-events: none;
        background: color-mix(in srgb, var(--ok) 18%, var(--vscode-editor-background));
        border: 1px solid var(--ok); color: var(--ok); }
      #toast.show { opacity: 1; }
      #toast.err { border-color: #f14c4c; color: #f14c4c;
        background: color-mix(in srgb, #f14c4c 12%, var(--vscode-editor-background)); }
    </style></head><body>
      <div id="bar">
        <h2>Embedded Debug 配置</h2>
        <span class="hint">保存到当前工程的工作区设置（.vscode/settings.json）</span>
        <button id="save">保存</button>
        <button id="reset" class="ghost" title="把所有项恢复为默认（清空自定义值）">全部恢复默认</button>
      </div>
      <div id="wrap"></div>
      <div id="toast"></div>
      <script>
        const vscode = acquireVsCodeApi();
        const state = { groups: [], values: {} };
        const $ = (id) => document.getElementById(id);
        const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

        function render() {
          let h = '';
          for (const g of state.groups) {
            h += '<div class="card"><div class="cap">' + g.icon + ' ' + esc(g.title) + '</div>';
            for (const f of g.fields) {
              const v = state.values[f.key];
              const shown = (v === undefined || v === '') ? '' : v;
              h += '<div class="frow"><div class="flabel"><div class="l">' + esc(f.label) + '</div>' +
                (f.hint ? '<div class="h">' + esc(f.hint) + '</div>' : '') + '</div>';
              if (f.type === 'enum') {
                h += '<select data-k="' + esc(f.key) + '">' +
                  '<option value="">(默认)</option>' +
                  f.options.map(o => '<option' + (shown === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') +
                  '</select>';
              } else if (f.type === 'bool') {
                h += '<input type="checkbox" data-k="' + esc(f.key) + '"' + (v === true ? ' checked' : '') + '>';
              } else {
                const ph = v === undefined || v === '' ? '(默认/自动)' : '';
                h += '<input type="text" data-k="' + esc(f.key) + '" value="' + esc(shown) + '" placeholder="' + esc(ph) + '">';
              }
              h += '</div>';
            }
            h += '</div>';
          }
          $('wrap').innerHTML = h;
        }

        function collect() {
          const out = {};
          for (const g of state.groups) for (const f of g.fields) {
            const el = document.querySelector('[data-k="' + f.key + '"]');
            if (!el) continue;
            if (f.type === 'bool') out[f.key] = el.checked;
            else if (f.type === 'number') out[f.key] = el.value === '' ? undefined : Number(el.value);
            else out[f.key] = el.value === '' ? undefined : el.value;
          }
          return out;
        }

        function toast(msg, err) {
          const t = $('toast');
          t.textContent = msg;
          t.className = err ? 'err show' : 'show';
          setTimeout(() => { t.className = err ? 'err' : ''; }, 2600);
        }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.cmd === 'settings') {
            state.groups = m.groups; state.values = m.values; render();
          } else if (m.cmd === 'saved') {
            if (m.changed > 0) toast('✔ 已保存 ' + m.changed + ' 项到工作区设置');
            else toast('没有需要保存的修改');
          }
        });

        $('save').addEventListener('click', () => vscode.postMessage({ cmd: 'save', values: collect() }));
        $('reset').addEventListener('click', () => {
          if (!confirm('把所有配置项恢复为默认（清空当前工程的自定义值）？')) return;
          const empty = {};
          for (const g of state.groups) for (const f of g.fields) empty[f.key] = undefined;
          vscode.postMessage({ cmd: 'save', values: empty });
        });

        vscode.postMessage({ cmd: 'ready' });
      </script>
    </body></html>`;
    }
}
exports.ConfigPanel = ConfigPanel;
/** 读取当前设置（不依赖 vscode 传入），供面板显示 */
function loadSettingsSafe() {
    // 延迟 require 避免循环依赖（settings.ts 只依赖 vscode）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { loadSettings } = require('../config/settings');
    return loadSettings();
}
//# sourceMappingURL=configPanel.js.map