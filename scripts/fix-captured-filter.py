import io
f = 'src/ui/watchView.ts'
s = io.open(f, encoding='utf-8').read()
n = 0

def rep(a, b):
    global s, n
    assert a in s, 'MISS: ' + repr(a[:80])
    s = s.replace(a, b, 1)
    n += 1

# 1. “未解析”= 无地址且无 memRef
rep("    const unresolved = this.entries.filter((e) => e.addr === undefined);",
    "    const unresolved = this.entries.filter((e) => e.addr === undefined && !e.memRef);")
rep("      const stillUnresolved = this.entries.filter((e) => e.addr === undefined);",
    "      const stillUnresolved = this.entries.filter((e) => e.addr === undefined && !e.memRef);")

# 2. meta 行：已捕获状态可见
rep("'<div class=\"meta\">' + (e.addr !== undefined ? '0x' + e.addr.toString(16).toUpperCase() + ' · ' + e.bytes + 'B' : (e.resolveFailed ? '无法解析 — 请改用 0x 地址' : '解析中…')) + '</div>' +",
    "'<div class=\"meta\">' + (e.addr !== undefined ? '0x' + e.addr.toString(16).toUpperCase() + ' · ' + e.bytes + 'B' : e.memRef ? '已捕获 · ' + e.bytes + 'B' : (e.resolveFailed ? '无法解析 — 请改用 0x 地址' : '解析中… · ' + e.bytes + 'B')) + '</div>' +")

# 3. 微停机窗口：memRef 条目也可读
rep("""            if (e.addr === undefined) {
              await this.resolveEntry(s, e, true);
            }
            if (e.addr === undefined) {
              return;
            }
            const buf = await readBlock(s, e.addr, e.bytes);""",
    """            const ref = e.memRef ?? (e.addr !== undefined ? '0x' + e.addr.toString(16) : undefined);
            if (!ref) {
              return;
            }
            let buf: Buffer | undefined;
            try {
              const r = (await s.customRequest('readMemory', {
                memoryReference: ref,
                count: e.bytes,
              })) as { data?: string };
              const b = Buffer.from(r?.data ?? '', 'base64');
              if (b.length > 0) {
                buf = b;
              }
            } catch {
              // 读取失败
            }
            if (!buf) {
              return;
            }""")

io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('applied', n, 'edits')
