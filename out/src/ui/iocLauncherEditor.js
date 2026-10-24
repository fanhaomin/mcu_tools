"use strict";
/**
 * .ioc 文件的自定义编辑器：在资源管理器中点击/双击 .ioc 时自动用
 * STM32CubeMX 打开（CLion 行为），页面提供「用文本编辑器查看」回退。
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
exports.IocLauncherEditorProvider = void 0;
const vscode = __importStar(require("vscode"));
class IocLauncherEditorProvider {
    launch;
    openAsText;
    log;
    static viewType = 'autoCmakeFlash.iocLauncher';
    constructor(launch, openAsText, log) {
        this.launch = launch;
        this.openAsText = openAsText;
        this.log = log;
    }
    openCustomDocument(uri) {
        return { uri, dispose: () => { } };
    }
    async resolveCustomEditor(document, webviewPanel) {
        webviewPanel.webview.options = { enableScripts: true };
        this.log(`.ioc 已在资源管理器中打开，启动 STM32CubeMX: ${document.uri.fsPath}`);
        const result = await this.launch(document.uri.fsPath);
        webviewPanel.webview.html = this.render(document.uri, result);
        webviewPanel.webview.onDidReceiveMessage((msg) => {
            if (msg?.cmd === 'openAsText') {
                this.openAsText(document.uri);
            }
            else if (msg?.cmd === 'retry') {
                void this.resolveCustomEditor(document, webviewPanel);
            }
            else if (msg?.cmd === 'openSettings') {
                void vscode.commands.executeCommand('autoCmakeFlash.openSettings');
            }
        });
    }
    render(uri, result) {
        const name = uri.path.split('/').pop() ?? uri.fsPath;
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // 状态文案与配色
        const status = result === 'launched'
            ? {
                cls: 'ok',
                icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
                title: '已在 STM32CubeMX 中打开',
                hint: 'CubeMX 启动需要几秒；若工程已在 CubeMX 中打开，它会自动重新加载。',
            }
            : result === 'notfound'
                ? {
                    cls: 'warn',
                    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`,
                    title: '未找到 STM32CubeMX',
                    hint: '请安装 STM32CubeMX，或在设置 autoCmakeFlash.cubemxPath 中指定 STM32CubeMX.exe 的完整路径。' +
                        '注意 STM32CubeCLT 不包含 CubeMX，两者是分开安装的。',
                }
                : {
                    cls: 'err',
                    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>`,
                    title: 'STM32CubeMX 启动失败',
                    hint: '可在设置 autoCmakeFlash.cubemxPath 中核正 STM32CubeMX.exe 的路径。',
                };
        // 芯片图标
        const chip = `
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none"
           stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round">
        <rect x="7" y="7" width="10" height="10" rx="1.6"/>
        <rect x="10.2" y="10.2" width="3.6" height="3.6" rx="0.6" fill="var(--accent)" stroke="none" opacity="0.85"/>
        <path d="M9.5 7V3.5M14.5 7V3.5M9.5 20.5V17M14.5 20.5V17M7 9.5H3.5M7 14.5H3.5M20.5 9.5H17M20.5 14.5H17"/>
      </svg>`;
        const primaryBtn = result === 'notfound'
            ? `<button class="btn primary" onclick="post('openSettings')">打开设置</button>`
            : result === 'failed'
                ? `<button class="btn primary" onclick="post('retry')">重试</button>`
                : `<button class="btn primary" onclick="post('retry')">重新启动 CubeMX</button>`;
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      :root {
        --accent: #64b5f6;
        --card: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-foreground) 12%);
      }
      * { box-sizing: border-box; }
      body {
        font-family: var(--vscode-font-family); color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        display: flex; align-items: center; justify-content: center;
        min-height: 100vh; margin: 0; padding: 24px;
      }
      .card {
        width: 100%; max-width: 520px; text-align: center;
        border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25));
        border-radius: 10px; padding: 36px 34px 30px;
        background: var(--card);
      }
      .chip-wrap {
        width: 84px; height: 84px; margin: 0 auto 14px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
      }
      h2 { margin: 0 0 2px; font-size: 19px; font-weight: 600; letter-spacing: .2px; }
      .path {
        font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px;
        color: var(--vscode-descriptionForeground); word-break: break-all;
        background: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
        border-radius: 5px; padding: 4px 10px; display: inline-block; margin-bottom: 20px;
      }
      .status {
        display: flex; align-items: flex-start; gap: 11px; text-align: left;
        border-radius: 8px; padding: 13px 15px; margin-bottom: 22px;
        border: 1px solid;
      }
      .status.ok   { border-color: color-mix(in srgb, #73c991 35%, transparent);
                     background: color-mix(in srgb, #73c991 10%, transparent); color: #73c991; }
      .status.warn { border-color: color-mix(in srgb, #cca700 35%, transparent);
                     background: color-mix(in srgb, #cca700 10%, transparent); color: #cca700; }
      .status.err  { border-color: color-mix(in srgb, #f14c4c 35%, transparent);
                     background: color-mix(in srgb, #f14c4c 10%, transparent); color: #f14c4c; }
      .status .icon { flex: 0 0 auto; margin-top: 1px; }
      .status .t { font-weight: 600; font-size: 13px; margin-bottom: 3px; }
      .status .h { font-size: 12px; line-height: 1.55;
                   color: var(--vscode-descriptionForeground); }
      .actions { display: flex; gap: 10px; justify-content: center; }
      .btn {
        font-family: inherit; font-size: 13px; padding: 7px 18px; cursor: pointer;
        border-radius: 5px; border: 1px solid transparent;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }
      .btn:hover { filter: brightness(1.18); }
      .btn.primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .foot { margin-top: 20px; font-size: 11px;
              color: var(--vscode-descriptionForeground); opacity: .8; }
    </style></head><body>
      <div class="card">
        <div class="chip-wrap">${chip}</div>
        <h2>${esc(name)}</h2>
        <div class="path">${esc(uri.fsPath)}</div>
        <div class="status ${status.cls}">
          <div class="icon">${status.icon}</div>
          <div>
            <div class="t">${esc(status.title)}</div>
            <div class="h">${esc(status.hint)}</div>
          </div>
        </div>
        <div class="actions">
          ${primaryBtn}
          <button class="btn" onclick="post('openAsText')">用文本编辑器查看</button>
        </div>
        <div class="foot">Auto CMake Flash · STM32CubeMX 工程快捷入口</div>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        function post(cmd) { vscode.postMessage({ cmd }); }
      </script>
    </body></html>`;
    }
}
exports.IocLauncherEditorProvider = IocLauncherEditorProvider;
//# sourceMappingURL=iocLauncherEditor.js.map