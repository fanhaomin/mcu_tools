import io
f = 'src/ui/watchView.ts'
s = io.open(f, encoding='utf-8').read()
n = 0

def rep(a, b):
    global s, n
    if a not in s:
        print('MISS:', repr(a[:70]))
        raise SystemExit(1)
    s = s.replace(a, b, 1)
    n += 1

# 1. 0x 地址直接成为条目（不经过 evaluate 解析）
rep("        this.entries.push({ expr, bytes: 4 });",
    """        const addrMatch = /^0x[0-9a-fA-F]{1,8}$/.exec(expr);
        this.entries.push(addrMatch
          ? { expr, addr: parseInt(expr, 16), bytes: 4 }
          : { expr, bytes: 4 });""")

# 2. probe-rs：直连解析失败 2 秒后，自动微停机一次完成解析（一次性，之后纯旁路）
rep("    // 2. 未解析的：尝试 evaluate 解析（probe-rs 运行中通常可用）",
    "    // 2. 未解析的：尝试 evaluate 解析（probe-rs 运行中不支持 evaluate，\n    //    失败持续 2 秒后自动微停机一次完成解析——只停一次，之后纯旁路）")
rep("""    const unresolved = this.entries.filter((e) => e.addr === undefined);
    if (unresolved.length > 0 && nonIntrusive) {
      await Promise.all(
        unresolved.map(async (e) => {
          await this.resolveEntry(s, e, false);
          if (e.addr !== undefined) {
            const buf = await readBlock(s, e.addr, e.bytes);
            if (buf) {
              results[e.expr] = {
                hex: toHexLE(buf, e.bytes * 8),
                ok: true,
                bytes: e.bytes,
                addr: e.addr,
              };
            }
          }
        }),
      );
    }""",
    """    const unresolved = this.entries.filter((e) => e.addr === undefined);
    if (unresolved.length > 0) {
      if (nonIntrusive) {
        await Promise.all(
          unresolved.map(async (e) => {
            await this.resolveEntry(s, e, false);
            if (e.addr !== undefined) {
              const buf = await readBlock(s, e.addr, e.bytes);
              if (buf) {
                results[e.expr] = {
                  hex: toHexLE(buf, e.bytes * 8),
                  ok: true,
                  bytes: e.bytes,
                  addr: e.addr,
                };
              }
            }
          }),
        );
      }
      // probe-rs 运行中 evaluate 必然失败：2 秒后微停机一次完成解析
      const stillUnresolved = this.entries.filter((e) => e.addr === undefined);
      if (stillUnresolved.length > 0 && Date.now() - this.lastProbeSample > 2_000) {
        this.lastProbeSample = Date.now();
        this.deps.log('变量监控: 运行中无法解析符号，微停机一次完成解析（之后纯旁路读取）');
        await sampleWhileRunning(s, this.deps.log, async () => {
          await Promise.all(
            stillUnresolved.map(async (e) => {
              await this.resolveEntry(s, e, true);
              if (e.addr !== undefined) {
                const buf = await readBlock(s, e.addr, e.bytes);
                if (buf) {
                  results[e.expr] = {
                    hex: toHexLE(buf, e.bytes * 8),
                    ok: true,
                    bytes: e.bytes,
                    addr: e.addr,
                  };
                }
              }
            }),
          );
        });
      }
    }""")

# 3. lastProbeSample 字段
rep("  private readFailedRecently = false;",
    "  private readFailedRecently = false;\n  private lastProbeSample = 0;")

# 4. 空态提示：说明 0x 地址方式与 CMSIS 宏限制
rep("<div class=\"empty\">添加要实时监控的变量<br>如 uwTick、&结构体字段、0x20000000</div>",
    "<div class=\"empty\">添加要实时监控的变量<br>变量名（如 led_toggle_count）· 表达式（&arr[2]）· 0x20000000<br>" +
    "提示：CMSIS 宏（如 SCB->VTOR）需工程带宏调试信息（-g3），否则请直接用其地址</div>")

io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('applied', n, 'edits')
