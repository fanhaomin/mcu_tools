const fs = require('fs');
let n = 0;
function patch(f, pairs) {
  if (f === 'src/config/settings.ts' && fs.readFileSync(f, 'utf8').includes('debugRefreshMs')) { console.log('settings.ts 已应用，跳过'); return; }
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of pairs) {
    if (s.includes(b)) { continue; } // 已应用
    if (!s.includes(a)) { console.log('MISS in ' + f + ':', JSON.stringify(a.slice(0, 70))); process.exit(1); }
    s = s.replace(a, b, 1); n++;
  }
  fs.writeFileSync(f, s);
}

patch('src/config/settings.ts', [
  ["  debugEngine: 'cortex-debug' | 'probe-rs';",
   "  debugEngine: 'cortex-debug' | 'probe-rs';\n  /** 调试面板（外设/变量/内存）统一刷新间隔 ms（50-5000） */\n  debugRefreshMs: number;"],
  ["    debugEngine:\n      cfg.get<string>('debugEngine', 'cortex-debug') === 'probe-rs' ? 'probe-rs' : 'cortex-debug',",
   "    debugEngine:\n      cfg.get<string>('debugEngine', 'cortex-debug') === 'probe-rs' ? 'probe-rs' : 'cortex-debug',\n    debugRefreshMs: clampNumber(cfg.get<number>('debugRefreshMs', 200), 50, 5000, 200),"],
]);

patch('src/ui/periphView.ts', [
  ["  /** 当前可用的调试会话（cortex-debug），无则 undefined */\n  getSession(): vscode.DebugSession | undefined;\n  log(msg: string): void;\n}",
   "  /** 当前可用的调试会话（cortex-debug），无则 undefined */\n  getSession(): vscode.DebugSession | undefined;\n  log(msg: string): void;\n  /** 调试面板统一刷新间隔 ms */\n  getInterval(): number;\n}"],
  ["  resolveWebviewView(view: vscode.WebviewView): void {\n    this.view = view;\n    this.visible = true;\n    view.webview.options = { enableScripts: true };\n    view.webview.html = this.html();\n    view.webview.onDidReceiveMessage((m) => void this.onMessage(m));",
   "  /** 推送统一刷新间隔（设置变更时调用） */\n  setIntervalMs(ms: number): void {\n    void this.view?.webview.postMessage({ cmd: 'interval', ms });\n  }\n\n  resolveWebviewView(view: vscode.WebviewView): void {\n    this.view = view;\n    this.visible = true;\n    view.webview.options = { enableScripts: true };\n    view.webview.html = this.html();\n    view.webview.onDidReceiveMessage((m) => void this.onMessage(m));"],
  ["        state.timer = setInterval(tick, 200);\n\n        post({ cmd: 'ready' });",
   "        state.timer = setInterval(tick, 200);\n\n        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } });\n\n        post({ cmd: 'ready' });"],
]);

patch('src/ui/watchView.ts', [
  ["  log(msg: string): void;\n  memento: vscode.Memento;\n}",
   "  log(msg: string): void;\n  memento: vscode.Memento;\n  /** 调试面板统一刷新间隔 ms */\n  getInterval(): number;\n}"],
  ["    this.entries = this.deps.memento.get<WatchEntry[]>(STORE_KEY, []);\n    this.postEntries();\n  }",
   "    this.entries = this.deps.memento.get<WatchEntry[]>(STORE_KEY, []);\n    this.postEntries();\n    void this.view?.webview.postMessage({ cmd: 'interval', ms: this.deps.getInterval() });\n  }\n\n  /** 推送统一刷新间隔（设置变更时调用） */\n  setIntervalMs(ms: number): void {\n    void this.view?.webview.postMessage({ cmd: 'interval', ms });\n  }"],
  ["      await this.refresh(m.interval ?? 200);",
   "      await this.refresh(this.deps.getInterval());"],
  ["        $('iv').addEventListener('change', () => {\n          state.interval = +$('iv').value;\n          if (state.timer) clearInterval(state.timer);\n          state.timer = setInterval(tick, state.interval);\n        });",
   "        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } });"],
]);

patch('src/ui/memView.ts', [
  ["  log(msg: string): void;\n  memento: vscode.Memento;\n}",
   "  log(msg: string): void;\n  memento: vscode.Memento;\n  /** 调试面板统一刷新间隔 ms */\n  getInterval(): number;\n}"],
  ["    this.regions = this.deps.memento.get<MemRegion[]>(STORE_KEY, []);\n    this.postRegions();\n  }",
   "    this.regions = this.deps.memento.get<MemRegion[]>(STORE_KEY, []);\n    this.postRegions();\n    void this.view?.webview.postMessage({ cmd: 'interval', ms: this.deps.getInterval() });\n  }\n\n  /** 推送统一刷新间隔（设置变更时调用） */\n  setIntervalMs(ms: number): void {\n    void this.view?.webview.postMessage({ cmd: 'interval', ms });\n  }"],
  ["      await this.refresh(Number(m.base) || this.lastBase, m.interval ?? 200);",
   "      await this.refresh(Number(m.base) || this.lastBase, this.deps.getInterval());"],
  ["        $('iv').addEventListener('change', () => {\n          state.interval = +$('iv').value;\n          if (state.timer) clearInterval(state.timer);\n          state.timer = setInterval(tick, state.interval);\n        });",
   "        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } });"],
]);

console.log('applied', n);
