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
        applied.append(f)

# 1. periphView：可见性变化通知 webview 暂停/恢复定时器
patch('src/ui/periphView.ts', [
    ("""    view.onDidChangeVisibility(() => {
      this.visible = view.visible;
      if (view.visible) {
        this.pushSvd();
        this.pushSession();
      }
    });""",
     """    view.onDidChangeVisibility(() => {
      this.visible = view.visible;
      void this.view?.webview.postMessage({ cmd: 'run', on: view.visible });
      if (view.visible) {
        this.pushSvd();
        this.pushSession();
      }
    });"""),
    # webview：run 消息处理（暂停/恢复定时器）
    ("""        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } });""",
     """        window.addEventListener('message', (e0) => {
          if (e0.data.cmd === 'interval') { state.intervalMs = e0.data.ms; if (!state.paused) { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } }
          if (e0.data.cmd === 'run') { state.paused = !e0.data.on; if (state.paused) { if (state.timer) clearInterval(state.timer); state.timer = null; } else { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, state.intervalMs || 200); } }
        });"""),
    # state 增加 paused/intervalMs
    ("""                        vals: {}, q: '', engine: undefined, session: false, monitor: false, frowFields: [], intervalMs: 200 };""",
     """                        vals: {}, q: '', engine: undefined, session: false, monitor: false, frowFields: [], intervalMs: 200, paused: false };"""),
])

# 2. watchView：同上
patch('src/ui/watchView.ts', [
    ("""    view.onDidChangeVisibility(() => {
      this.visible = view.visible;
      if (view.visible) {
        this.postEntries();
      }
    });""",
     """    view.onDidChangeVisibility(() => {
      this.visible = view.visible;
      void this.view?.webview.postMessage({ cmd: 'run', on: view.visible });
      if (view.visible) {
        this.postEntries();
      }
    });"""),
    ("""        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } });""",
     """        window.addEventListener('message', (e0) => {
          if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (!state.paused) { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } }
          if (e0.data.cmd === 'run') { state.paused = !e0.data.on; if (state.paused) { if (state.timer) clearInterval(state.timer); state.timer = null; } else { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, state.interval); } }
        });"""),
])

# 3. memView：同上
patch('src/ui/memView.ts', [
    ("""    view.onDidChangeVisibility(() => {
      this.visible = view.visible;
      if (view.visible) {
        this.postInit();
      }
    });""",
     """    view.onDidChangeVisibility(() => {
      this.visible = view.visible;
      void this.view?.webview.postMessage({ cmd: 'run', on: view.visible });
      if (view.visible) {
        this.postInit();
      }
    });"""),
    ("""        window.addEventListener('message', (e0) => { if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } });""",
     """        window.addEventListener('message', (e0) => {
          if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (!state.paused) { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } }
          if (e0.data.cmd === 'run') { state.paused = !e0.data.on; if (state.paused) { if (state.timer) clearInterval(state.timer); state.timer = null; } else { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, state.interval); } }
        });"""),
])

print('applied:', applied)
