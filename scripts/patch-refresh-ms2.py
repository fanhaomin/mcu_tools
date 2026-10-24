import io

applied = []
def patch(f, pairs):
    s = io.open(f, encoding='utf-8').read()
    for a, b in pairs:
        if b in s:
            continue
        if a not in s:
            print('MISS in', f, ':', repr(a[:70]))
            continue
        s = s.replace(a, b, 1)
        applied.append(f + ':' + b.strip()[:40])
    io.open(f, 'w', encoding='utf-8', newline='').write(s)

# watchView（接口里有 getElf/getNm，锚点不同）
patch('src/ui/watchView.ts', [
    ("  getNm(): string | undefined;\n}",
     "  getNm(): string | undefined;\n  /** 调试面板统一刷新间隔 ms */\n  getInterval(): number;\n}"),
    ("    this.entries = this.deps.memento.get<WatchEntry[]>(STORE_KEY, []);\n    this.postEntries();\n  }",
     "    this.entries = this.deps.memento.get<WatchEntry[]>(STORE_KEY, []);\n    this.postEntries();\n    void this.view?.webview.postMessage({ cmd: 'interval', ms: this.deps.getInterval() });\n  }\n\n  /** 推送统一刷新间隔（设置变更时调用） */\n  setIntervalMs(ms: number): void {\n    void this.view?.webview.postMessage({ cmd: 'interval', ms });\n  }"),
    ("      await this.refresh(m.interval ?? 200);",
     "      await this.refresh(this.deps.getInterval());"),
    ("        $('iv').addEventListener('change', () => {\n          state.interval = +$('iv').value;\n          if (state.timer) clearInterval(state.timer);\n          state.timer = setInterval(tick, state.interval);\n        });",
     "        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } });"),
])

# memView
patch('src/ui/memView.ts', [
    ("  log(msg: string): void;\n  memento: vscode.Memento;\n}",
     "  log(msg: string): void;\n  memento: vscode.Memento;\n  /** 调试面板统一刷新间隔 ms */\n  getInterval(): number;\n}"),
    ("    this.regions = this.deps.memento.get<MemRegion[]>(STORE_KEY, []);\n    this.postRegions();\n  }",
     "    this.regions = this.deps.memento.get<MemRegion[]>(STORE_KEY, []);\n    this.postRegions();\n    void this.view?.webview.postMessage({ cmd: 'interval', ms: this.deps.getInterval() });\n  }\n\n  /** 推送统一刷新间隔（设置变更时调用） */\n  setIntervalMs(ms: number): void {\n    void this.view?.webview.postMessage({ cmd: 'interval', ms });\n  }"),
    ("      await this.refresh(Number(m.base) || this.lastBase, m.interval ?? 200);",
     "      await this.refresh(Number(m.base) || this.lastBase, this.deps.getInterval());"),
    ("        $('iv').addEventListener('change', () => {\n          state.interval = +$('iv').value;\n          if (state.timer) clearInterval(state.timer);\n          state.timer = setInterval(tick, state.interval);\n        });",
     "        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } });"),
])

# periphView：补 interface 与 webview listener（resolveWebviewView 包裹已应用）
patch('src/ui/periphView.ts', [
    ("  /** 当前可用的调试会话（cortex-debug），无则 undefined */\n  getSession(): vscode.DebugSession | undefined;\n  log(msg: string): void;\n}",
     "  /** 当前可用的调试会话（cortex-debug），无则 undefined */\n  getSession(): vscode.DebugSession | undefined;\n  log(msg: string): void;\n  /** 调试面板统一刷新间隔 ms */\n  getInterval(): number;\n}"),
    ("        state.timer = setInterval(tick, 200);\n\n        post({ cmd: 'ready' });",
     "        state.timer = setInterval(tick, 200);\n\n        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } });\n\n        post({ cmd: 'ready' });"),
])

print('applied:', applied)
