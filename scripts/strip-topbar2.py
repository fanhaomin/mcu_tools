import io
f = 'src/ui/periphView.ts'
s = io.open(f, encoding='utf-8').read()
applied = []

def try_replace(a, b, label):
    global s
    if a in s:
        s = s.replace(a, b, 1)
        applied.append(label)

def cut_between(a, b, label):
    global s
    i = s.find(a)
    j = s.find(b, i + 1) if i >= 0 else -1
    if i >= 0 and j > i:
        s = s[:i] + s[j + len(b):]
        applied.append(label)

# 1. 顶部栏 HTML
cut_between('      <div id="top">', '      <div id="main">', 'top-html')

# 2. state 声明
try_replace(', session: false, monitor: false, frowFields: [] };', ', session: false, frowFields: [] };', 'state-decl')

# 3. render 空态
try_replace("""if (!state.svd) { left.innerHTML = '<div class="empty">' + esc($('statTx').textContent) + '</div>'; return; }""",
            """if (!state.svd) { left.innerHTML = '<div class="empty">等待调试会话…</div>'; return; }""", 'render-empty')

# 4. svd 处理器状态行
try_replace("            $('statTx').textContent = (m.file ? (m.deviceName || '') + ' · ' : '') + m.status;\n", '', 'svd-statTx')
try_replace("            $('dot').className = 'dot' + (m.file ? ' ok' : ' err');\n", '', 'svd-dot')

# 5. values 处理器状态点
cut_between("            const dot = $('dot');", "            }\n", 'values-dot')

# 6. session 处理器：mon 显隐 + 未激活状态行（索引定位到 written 分支）
i = s.find("            $('mon').style.display")
j = s.find("} else if (m.cmd === 'written')", i) if i >= 0 else -1
if i >= 0 and j > i:
    # 保留 written 分支的开头大括号
    s = s[:i] + s[j:]
    applied.append('session-mon')
# 未激活时清空旧值
try_replace("""            state.session = m.active; state.engine = m.engine;
""",
            """            state.session = m.active; state.engine = m.engine;
            if (!m.active) { state.vals = {}; updateVals(); }
""", 'session-clear')

# 7. 监听器
cut_between("        $('q').addEventListener('input', render);", "        state.timer = setInterval(tick, 200);", 'listeners')
if 'setInterval(tick, 200)' not in s:
    try_replace("        post({ cmd: 'ready' });",
                "        state.timer = setInterval(tick, 200);\n\n        post({ cmd: 'ready' });", 'timer-restore')

# 8. tick monitor 恒真
if 'monitor: state.monitor' in s:
    s = s.replace('monitor: state.monitor', 'monitor: true')
    applied.append('tick-monitor-replace')
elif "post({ cmd: 'read', items: items });" in s:
    s = s.replace("post({ cmd: 'read', items: items });", "post({ cmd: 'read', items: items, monitor: true });")
    applied.append('tick-monitor-add')

io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('applied:', applied)
leftover = [w for w in ['statTx', "$('mon')", "$('rf')", "$('q')", 'id="top"', 'state.monitor'] if w in s]
print('leftover refs:', leftover if leftover else '无')
