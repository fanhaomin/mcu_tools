import io

f = 'src/ui/watchView.ts'
s = io.open(f, encoding='utf-8').read()
n = 0

def rep(a, b):
    global s, n
    assert a in s, 'MISS: ' + repr(a[:80])
    s = s.replace(a, b, 1)
    n += 1

# 1. 旧条目迁移：补 kind/typeLabel/explicitType 默认值（这就是类型列空白的原因）
rep("""    this.entries = this.deps.memento.get<WatchEntry[]>(STORE_KEY, []);
    this.postEntries();
    void this.view?.webview.postMessage({ cmd: 'interval', ms: this.deps.getInterval() });
  }""",
"""    this.entries = (this.deps.memento.get<WatchEntry[]>(STORE_KEY, []) || []).map((e) => {
      const kind = e.kind ?? (e.bytes === 2 ? 'u16' : e.bytes === 1 ? 'u8' : e.bytes === 8 ? 'u64' : 'u32');
      return {
        ...e,
        bytes: e.bytes ?? 4,
        kind,
        typeLabel: e.typeLabel ?? kindLabel(kind),
        explicitType: e.explicitType ?? false,
      };
    });
    this.fmt = this.deps.memento.get<string>(WATCH_FMT_KEY, 'dec') === 'hex' ? 'hex' : 'dec';
    this.postEntries();
    void this.view?.webview.postMessage({ cmd: 'interval', ms: this.deps.getInterval() });
  }""")

# 2. fmt 字段与持久化
rep("""  private visible = false;
  private entries: WatchEntry[] = [];""",
"""  private visible = false;
  private entries: WatchEntry[] = [];
  private fmt: 'dec' | 'hex' = 'dec';""")
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

# 3. setFmt 消息
rep("""      case 'read': {
        if (this.visible) {
          await this.refresh(this.deps.getInterval());
        }
        break;
      }""",
"""      case 'setFmt': {
        this.fmt = m.fmt === 'hex' ? 'hex' : 'dec';
        await this.deps.memento.update(WATCH_FMT_KEY, this.fmt);
        this.postEntries();
        break;
      }
      case 'read': {
        if (this.visible) {
          await this.refresh(this.deps.getInterval());
        }
        break;
      }""")

# 4. onMessage 类型增加 fmt
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

# 5. webview：卡片改真表格（带边框），值按进制显示
rep("""          const header = '<div class="whead"><span>变量名</span><span>类型</span><span>值</span><span>地址</span><span></span></div>';
          list.innerHTML = header + state.entries.map((e) => {
            const v = state.vals[e.expr] || {};
            const hex = v.ok ? v.hex : (v.hex || '…');
            const valShown = v.ok && v.value ? v.value : esc(hex);
            const addrShown = e.addr !== undefined
              ? '0x' + e.addr.toString(16).toUpperCase()
              : (e.memRef ? '已捕获' : (e.resolveFailed ? '无法解析' : '解析中…'));
            return '<div class="item" data-e="' + esc(e.expr) + '">' +
              '<div class="name" title="' + esc(e.expr) + '">' + esc(e.expr) + '</div>' +
              '<div class="ty">' + esc(e.typeLabel) + '</div>' +
              '<div class="val' + (v.ok ? '' : ' stale') + '">' + valShown + '</div>' +
              '<div class="ad" title="' + esc(addrShown) + '">' + esc(addrShown) + '</div>' +
              '<span class="del" title="移除">✕</span></div>';
          }).join('');""",
"""          const valText = (e, v) => {
            if (!v || !v.ok) return '…';
            if (state.fmt === 'hex') return v.hex;
            return v.value && v.value !== '' ? v.value : v.hex;
          };
          const rows = state.entries.map((e) => {
            const v = state.vals[e.expr] || {};
            const valShown = esc(valText(e, v));
            const addrShown = e.addr !== undefined
              ? '0x' + e.addr.toString(16).toUpperCase()
              : (e.memRef ? '已捕获' : (e.resolveFailed ? '无法解析' : '解析中…'));
            return '<tr data-e="' + esc(e.expr) + '">' +
              '<td class="name" title="' + esc(e.expr) + '">' + esc(e.expr) + '</td>' +
              '<td class="ty">' + esc(e.typeLabel || '') + '</td>' +
              '<td class="val' + (v.ok ? '' : ' stale') + '">' + valShown + '</td>' +
              '<td class="ad" title="' + esc(addrShown) + '">' + esc(addrShown) + '</td>' +
              '<td class="del" title="移除">✕</td></tr>';
          }).join('');
          list.innerHTML = '<table class="wtable"><thead><tr>' +
            '<th>变量名</th><th>类型</th><th>值</th><th>地址</th><th></th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';""")

# 6. CSS：真表格边框样式
rep("""      .whead { display: grid; grid-template-columns: minmax(90px, 1.4fr) 64px 84px minmax(80px, 1fr) 18px;
        gap: 6px; padding: 3px 9px; font-size: 10.5px; color: var(--vscode-descriptionForeground);
        border-bottom: 1px solid rgba(128,128,128,.25); }""",
"""      .wtable { width: 100%; border-collapse: collapse;
        border: 1px solid rgba(128,128,128,.3); }
      .wtable th, .wtable td { border: 1px solid rgba(128,128,128,.22);
        padding: 4px 8px; text-align: left; vertical-align: middle; }
      .wtable th { font-size: 10.5px; color: var(--vscode-descriptionForeground);
        background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent); font-weight: 600; }
      .wtable tr:hover td { background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent); }
      .whead { display: none; }""")

# 7. row2 加进制切换按钮
rep("""      <div class="row2">probe-rs 引擎运行中旁路直读 · cortex-debug 自动微停机采样 · 刷新间隔在侧边栏「调试」分组设置</div>""",
"""      <div class="row2">刷新间隔在侧边栏「调试」分组设置 ·
        <button id="fmt" class="ghost" title="切换值的显示进制">进制: 十进制</button>
        · probe-rs 旁路直读 / cortex-debug 微停机采样
      </div>""")

# 8. webview：fmt 消息 + 按钮切换
rep("""        window.addEventListener('message', (e0) => {
          if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (!state.paused) { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } }
          if (e0.data.cmd === 'run') { state.paused = !e0.data.on; if (state.paused) { if (state.timer) clearInterval(state.timer); state.timer = null; } else { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, state.interval); } }
        });""",
"""        window.addEventListener('message', (e0) => {
          if (e0.data.cmd === 'interval') { state.interval = e0.data.ms; if (!state.paused) { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, e0.data.ms); } }
          if (e0.data.cmd === 'run') { state.paused = !e0.data.on; if (state.paused) { if (state.timer) clearInterval(state.timer); state.timer = null; } else { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, state.interval); } }
          if (e0.data.cmd === 'entries') { state.fmt = m_fmt(e0.data.fmt); render(); }
        });
        function m_fmt(v) { return v === 'hex' ? 'hex' : 'dec'; }""")

# 9. 值渲染跟随 fmt
rep("            if (state.fmt === 'hex') return v.hex;",
    "            if (state.fmt === 'hex') return v.hex;")

# 10. fmt 按钮事件
rep("        function add() {",
    """        $('fmt').addEventListener('click', () => {
          state.fmt = state.fmt === 'dec' ? 'hex' : 'dec';
          $('fmt').textContent = '进制: ' + (state.fmt === 'dec' ? '十进制' : '十六进制');
          post({ cmd: 'setFmt', fmt: state.fmt });
          render();
        });

        function add() {""")

# 11. state 增加 fmt
rep("        const state = { entries: [], vals: {}, timer: null, interval: 200 };",
    "        const state = { entries: [], vals: {}, timer: null, interval: 200, fmt: 'dec' };")

io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('applied', n, 'edits')
