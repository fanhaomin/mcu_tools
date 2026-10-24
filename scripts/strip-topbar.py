import io
f = 'src/ui/periphView.ts'
s = io.open(f, encoding='utf-8').read()
n = 0

def cut(a, b=None):
    global s, n
    if a not in s:
        print('MISS:', repr(a[:60]))
        raise SystemExit(1)
    if b is None:
        s = s.replace(a, '', 1)
    else:
        i = s.find(a)
        j = s.find(b, i)
        if j < 0:
            print('END MISS:', repr(b[:40]))
            raise SystemExit(1)
        s = s[:i] + s[j + len(b):]
    n += 1

# 1. 顶部栏 HTML 整块移除（#top 到 #main 之前）
cut('      <div id="top">', '      <div id="main">')

# 2. state 声明去掉 monitor
s = s.replace(', session: false, monitor: false, frowFields: [] };',
              ', session: false, frowFields: [] };')
n += 1

# 3. render() 空态文案不再引用 statTx
s = s.replace("""if (!state.svd) { left.innerHTML = '<div class="empty">' + esc($('statTx').textContent) + '</div>'; return; }""",
              """if (!state.svd) { left.innerHTML = '<div class="empty">等待调试会话…</div>'; return; }""")
n += 1

# 4. svd 处理器：去掉状态行更新
cut("            $('statTx').textContent = (m.file ? (m.deviceName || '') + ' · ' : '') + m.status;\n")
cut("            $('dot').className = 'dot' + (m.file ? ' ok' : ' err');\n")

# 5. values 处理器：去掉状态点更新块
cut("            const dot = $('dot');\n", "            }\n")

# 6. session 处理器：去掉 mon 显隐与状态行
cut("            $('mon').style.display = state.engine === 'probe-rs' ? 'none' : '';\n",
    "            } else if (m.cmd === 'written') {")
# 上面 cut 会把 written 的开头一起切掉，需要补回；改为精确两段处理：
# （cut 第二参数把 '            } else if (m.cmd === \'written\'）{' 一起删了，下面补回）
s = s.replace("            state.session = m.active; state.engine = m.engine;\n",
              "            state.session = m.active; state.engine = m.engine;\n            if (!m.active) { state.vals = {}; updateVals(); }\n")
n += 1

# 7. 事件监听：q / rf / mon 三行整块移除
cut("        $('q').addEventListener('input', render);\n",
    "        state.timer = setInterval(tick, 200);")
# cut 又把定时器行删了，补回（只保留一份）
if s.count('setInterval(tick, 200)') == 0:
    s = s.replace("        post({ cmd: 'ready' });",
                  "        state.timer = setInterval(tick, 200);\n\n        post({ cmd: 'ready' });")
n += 1

# 8. tick 读取统一带 monitor: true（cortex-debug 自动微停机采样；probe-rs 旁路直读本身不暂停）
if "monitor: state.monitor" in s:
    s = s.replace("monitor: state.monitor", "monitor: true")
else:
    # redesign 后的 tick 没有 monitor 字段，补上
    s = s.replace("post({ cmd: 'read', items: items });",
                  "post({ cmd: 'read', items: items, monitor: true });")
n += 1

io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('applied', n, 'edits')
