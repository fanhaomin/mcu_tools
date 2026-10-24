const fs = require('fs');

// 1. extension.ts：导入 + 实例化 + 注册两个新面板
let s = fs.readFileSync('src/extension.ts', 'utf8');
const impAnchor = "import { ConfigPanel } from './ui/configPanel';";
if (!s.includes(impAnchor)) { console.log('IMP MISS'); process.exit(1); }
s = s.replace(impAnchor, impAnchor + "\nimport { WatchViewProvider } from './ui/watchView';\nimport { MemViewProvider } from './ui/memView';");

// 在 periph 注册块结束后追加（定位 periph 的 registerWebviewViewProvider 订阅块结尾）
const periphRegEnd = "  const isEngineSession = (s: vscode.DebugSession): boolean =>";
if (!s.includes(periphRegEnd)) { console.log('PERIPH ANCHOR MISS'); process.exit(1); }
const inject = `  const watch = new WatchViewProvider({
    getSession: () => engineSession,
    log,
    memento: context.workspaceState,
  });
  const mem = new MemViewProvider({
    getSession: () => engineSession,
    log,
    memento: context.workspaceState,
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WatchViewProvider.viewType, watch, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(MemViewProvider.viewType, mem, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

`;
s = s.replace(periphRegEnd, inject + periphRegEnd);
fs.writeFileSync('src/extension.ts', s);
console.log('extension.ts wired');

// 2. package.json：面板容器添加两个视图 + 版本 0.9.0
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const views = p.contributes.views['auto-cmake-flash-debug'];
if (!views) { console.log('PANEL VIEWS MISS'); process.exit(1); }
if (!views.some((v) => v.id === 'autoCmakeFlash.watch')) {
  views.push({ id: 'autoCmakeFlash.watch', name: '变量监控', type: 'webview' });
}
if (!views.some((v) => v.id === 'autoCmakeFlash.memview')) {
  views.push({ id: 'autoCmakeFlash.memview', name: '内存视图', type: 'webview' });
}
p.version = '0.9.0';
fs.writeFileSync('package.json', JSON.stringify(p, null, 2));
console.log('package.json views:', views.map((v) => v.id).join(', '), '| version', p.version);
