import io

# 1. extension.ts：推送用刚写入的值（Configuration API 对未注册键有读取延迟）
f = 'src/extension.ts'
s = io.open(f, encoding='utf-8').read()
n = 0

old = """    await updateWorkspaceSetting('debugRefreshMs', ms);
    settings = loadSettings();
    periph.setIntervalMs(settings.debugRefreshMs);
    watch.setIntervalMs(settings.debugRefreshMs);
    mem.setIntervalMs(settings.debugRefreshMs);
    log('调试面板刷新间隔: ' + settings.debugRefreshMs + 'ms');"""
new = """    await updateWorkspaceSetting('debugRefreshMs', ms);
    settings = loadSettings();
    settings.debugRefreshMs = ms; // 直写文件后 Configuration 读取有延迟，先用刚写的值
    periph.setIntervalMs(ms);
    watch.setIntervalMs(ms);
    mem.setIntervalMs(ms);
    log('调试面板刷新间隔: ' + ms + 'ms');"""
if old in s:
    s = s.replace(old, new, 1); n += 1
else:
    print('MISS ext-refresh')

old = """    await updateWorkspaceSetting('debugEngine', next);
    settings = loadSettings();"""
new = """    await updateWorkspaceSetting('debugEngine', next);
    settings = loadSettings();
    settings.debugEngine = next; // 直写文件后 Configuration 读取有延迟"""
if old in s:
    s = s.replace(old, new, 1); n += 1
else:
    print('MISS ext-engine')

io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('extension.ts applied', n)

# 2. watchView：去掉底部残留的刷新下拉框
f = 'src/ui/watchView.ts'
s = io.open(f, encoding='utf-8').read()
old = """      <div class="row2">刷新
        <select id="iv">
          <option value="50">50ms</option>
          <option value="100">100ms</option>
          <option value="200" selected>200ms</option>
          <option value="500">500ms</option>
        </select>
        · probe-rs 引擎运行中旁路直读 · cortex-debug 自动微停机采样
      </div>"""
new = """      <div class="row2">probe-rs 引擎运行中旁路直读 · cortex-debug 自动微停机采样 · 刷新间隔在侧边栏「调试」分组设置</div>"""
if old in s:
    s = s.replace(old, new, 1); n += 1
else:
    print('MISS watch-row2')
io.open(f, 'w', encoding='utf-8', newline='').write(s)

# 3. memView：同上
f = 'src/ui/memView.ts'
s = io.open(f, encoding='utf-8').read()
old = """      <div class="row2">刷新
        <select id="iv">
          <option value="50">50ms</option>
          <option value="100">100ms</option>
          <option value="200" selected>200ms</option>
          <option value="500">500ms</option>
        </select>
        · 点字节格编辑写回 · 修改过的字节绿色高亮 · 单区域上限 16KB
      </div>"""
new = """      <div class="row2">点字节格编辑写回 · <span style="color:#e2b93d">琥珀</span>=程序修改 <span style="color:var(--ok)">绿</span>=手动修改 · 刷新间隔在侧边栏「调试」分组设置</div>"""
if old in s:
    s = s.replace(old, new, 1); n += 1
else:
    print('MISS mem-row2')
io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
