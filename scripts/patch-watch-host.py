import io

f = 'src/ui/watchView.ts'
s = io.open(f, encoding='utf-8').read()
n = 0

def rep(a, b, count=1):
    global s, n
    assert a in s, 'MISS: ' + repr(a[:80])
    s = s.replace(a, b, count)
    n += count

# 1. resolveWebviewView：条目迁移（补 kind/typeLabel）+ fmt 加载 + 可见性通知
rep("""    this.entries = this.deps.memento.get<WatchEntry[]>(STORE_KEY, []);
    this.postEntries();
    void this.view?.webview.postMessage({ cmd: 'interval', ms: this.deps.getInterval() });
  }""",
"""    const restored = this.deps.memento.get<WatchEntry[]>(STORE_KEY, []) || [];
    this.entries = restored.map((e) => {
      const kind = e.kind ?? (e.bytes === 2 ? 'u16' : e.bytes === 1 ? 'u8' : e.bytes === 8 ? 'u64' : 'u32');
      return {
        ...e,
        bytes: e.bytes ?? 4,
        kind,
        typeLabel: e.typeLabel ?? kindLabelOf(kind),
        explicitType: e.explicitType ?? false,
      };
    });
    this.fmt = this.deps.memento.get<string>(WATCH_FMT_KEY, 'dec') === 'hex' ? 'hex' : 'dec';
    this.postEntries();
    void this.view?.webview.postMessage({ cmd: 'interval', ms: this.deps.getInterval() });
    void this.view?.webview.postMessage({ cmd: 'run', on: view.visible });
  }

  /** 切换值显示进制（持久化） */
  async setFmt(fmt: 'dec' | 'hex'): Promise<void> {
    this.fmt = fmt;
    await this.deps.memento.update(WATCH_FMT_KEY, fmt);
    this.postEntries();
  }""")

# 2. fmt 字段
rep("""  private visible = false;
  private entries: WatchEntry[] = [];""",
"""  private visible = false;
  private fmt: 'dec' | 'hex' = 'dec';
  private entries: WatchEntry[] = [];""")

# 3. postEntries 带 fmt
rep("""  private postEntries(): void {
    void this.view?.webview.postMessage({ cmd: 'entries', entries: this.entries });
  }""",
"""  private postEntries(): void {
    void this.view?.webview.postMessage({
      cmd: 'entries',
      entries: this.entries,
      fmt: this.fmt,
    });
  }""")

# 4. onMessage 类型 + setFmt
rep("""  private async onMessage(m: {
    cmd?: string;
    expr?: string;
    interval?: number;
  }): Promise<void> {""",
"""  private async onMessage(m: {
    cmd?: string;
    expr?: string;
    interval?: number;
    fmt?: string;
  }): Promise<void> {""")
rep("""      case 'ready':
        this.postEntries();
        break;""",
"""      case 'ready':
        this.postEntries();
        break;
      case 'setFmt':
        await this.setFmt(m.fmt === 'hex' ? 'hex' : 'dec');
        break;""")

# 5. 可见性：通知 webview 暂停/恢复
rep("""    view.onDidChangeVisibility(() => {
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
    });""")

io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('host applied', n, 'edits')
