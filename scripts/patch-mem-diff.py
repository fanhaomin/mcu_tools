import io
f = 'src/ui/memView.ts'
s = io.open(f, encoding='utf-8').read()
n = 0

def rep(a, b):
    global s, n
    if a not in s:
        print('MISS:', repr(a[:70]))
        raise SystemExit(1)
    s = s.replace(a, b, 1)
    n += 1

# 1. CSS：变化字节琥珀色
rep("      .chg { color: var(--ok); font-weight: 700; }",
    "      .chg { color: var(--ok); font-weight: 700; }\n"
    "      .diff { color: #e2b93d; font-weight: 700;\n"
    "        background: color-mix(in srgb, #e2b93d 14%, transparent); }")

# 2. state 增加上一轮数据
rep("        const state = { base: 0x20000000, data: null, ok: false, timer: null, interval: 200, changed: {}, history: [] };",
    "        const state = { base: 0x20000000, data: null, ok: false, timer: null, interval: 200, changed: {}, history: [], prev: null, prevBase: 0 };")

# 3. renderData 字节循环：与上一轮比较打 diff 高亮
rep("""              const chg = state.changed[abs];
              const want = chg !== undefined ? chg.toString(16).toUpperCase().padStart(2, '0') : txt;
              if (cell.textContent !== want) cell.textContent = want;
              cell.classList.toggle('chg', chg !== undefined);""",
    """              const chg = state.changed[abs];
              const diff = state.prev && state.prevBase === state.base &&
                state.prev[i] !== undefined && state.prev[i] !== b;
              const want = chg !== undefined ? chg.toString(16).toUpperCase().padStart(2, '0') : txt;
              if (cell.textContent !== want) cell.textContent = want;
              cell.classList.toggle('chg', chg !== undefined);
              cell.classList.toggle('diff', diff && chg === undefined);""")

# 4. 循环结束后保存本轮数据为上一轮
rep("""            const asc = tr.querySelector('.asc');
            if (asc.textContent !== ascii) asc.textContent = ascii;
          }
        }""",
    """            const asc = tr.querySelector('.asc');
            if (asc.textContent !== ascii) asc.textContent = ascii;
          }
          state.prev = buf;
          state.prevBase = state.base;
        }""")

# 5. 跳转时清除上一轮比较基准
rep("          state.base = base;\n          state.changed = {};",
    "          state.base = base;\n          state.changed = {};\n          state.prev = null;")

io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('applied', n, 'edits')
