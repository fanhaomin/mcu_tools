import io

f = 'src/ui/watchView.ts'
s = io.open(f, encoding='utf-8').read()
n = 0

def rep(a, b):
    global s, n
    assert a in s, 'MISS: ' + repr(a[:80])
    s = s.replace(a, b, 1)
    n += 1

# 1. 导入 typed 模块
rep("import { readSymbolTable, SymbolInfo } from '../debug/symbols';",
    "import { readSymbolTable, SymbolInfo } from '../debug/symbols';\n"
    "import { splitTypeSuffix, decodeTyped, kindByBytes, ValueKind } from '../debug/typed';")

# 2. WatchEntry 增加类型字段
rep("""  /** 断点捕获的 DAP memoryReference（局部变量经此监控） */
  memRef?: string;
}""",
"""  /** 断点捕获的 DAP memoryReference（局部变量经此监控） */
  memRef?: string;
  /** 用户指定/推断的解码类型 */
  kind: ValueKind;
  /** 类型显示名 */
  typeLabel: string;
  /** 用户是否显式指定了类型 */
  explicitType?: boolean;
}""")

# 3. add 处理：解析 “:类型” 后缀；地址也支持类型
rep("""        const addrMatch = /^0x[0-9a-fA-F]{1,8}$/.exec(expr);
        this.entries.push(addrMatch
          ? { expr, addr: parseInt(expr, 16), bytes: 4 }
          : { expr, bytes: 4 });""",
"""        const { name, spec } = splitTypeSuffix(expr);
        const addrMatch = /^0x[0-9a-fA-F]{1,8}$/.exec(name);
        if (addrMatch) {
          const spec2 = spec ?? { kind: 'u32' as ValueKind, bytes: 4, label: 'uint32_t' };
          this.entries.push({
            expr,
            addr: parseInt(name, 16),
            bytes: spec2.bytes,
            kind: spec2.kind,
            typeLabel: spec2.label,
            explicitType: !!spec,
          });
        } else {
          this.entries.push({
            expr: name,
            bytes: spec?.bytes ?? 4,
            kind: spec?.kind ?? 'u32',
            typeLabel: spec?.label ?? 'uint32_t',
            explicitType: !!spec,
          });
        }""")

# 4. 符号表路径：仅在未显式指定类型时采用符号大小
rep("""        const hit = sym.get(name);
        if (hit) {
          e.addr = hit.addr;
          e.bytes = Math.max(1, Math.min(256, hit.size));
          e.resolveFailed = false;""",
"""        const hit = sym.get(name);
        if (hit) {
          e.addr = hit.addr;
          if (!e.explicitType) {
            e.bytes = Math.max(1, Math.min(256, hit.size));
            e.kind = kindByBytes(e.bytes);
          }
          e.resolveFailed = false;""")

# 5. results 增加 value；读取后按类型解码
rep("    const results: Record<string, { hex: string; ok: boolean; bytes: number; addr: number }> = {};",
    "    const results: Record<string, { hex: string; ok: boolean; bytes: number; addr: number; value: string }> = {};")

io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('applied', n, 'edits')
