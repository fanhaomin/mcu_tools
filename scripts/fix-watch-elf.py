import io

# 1. extension.ts：getElf 改为异步 + 构建目录扫描兜底
f = 'src/extension.ts'
s = io.open(f, encoding='utf-8').read()
old = """    getElf: () => {
      const p = state.lastBuild?.elfPath;
      return p && existsSync(p) ? p : undefined;
    },"""
new = """    getElf: async () => {
      const p = state.lastBuild?.elfPath;
      if (p && existsSync(p)) {
        return p;
      }
      // 兜底：上次构建记录缺失/指向旧目录时，扫描构建目录取最新的 ELF
      const root = state.root;
      if (!root) {
        return undefined;
      }
      const elfs = (await findArtifacts(buildDirOf(root))).filter((a) => a.format === 'elf');
      return elfs[0]?.path;
    },"""
assert old in s, 'EXT GETELF MISS'
s = s.replace(old, new, 1)
io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('extension getElf fallback applied')

# 2. watchView.ts：getElf 异步化 + 空符号表诊断日志 + 新 ELF 时重置失败标记
f = 'src/ui/watchView.ts'
s = io.open(f, encoding='utf-8').read()
n = 0

def rep(a, b):
    global s, n
    assert a in s, 'MISS: ' + repr(a[:70])
    s = s.replace(a, b, 1)
    n += 1

rep("  /** 最近一次构建的 ELF（符号表来源），无则 undefined */\n  getElf(): string | undefined;",
    "  /** 最近一次构建的 ELF（符号表来源），无则 undefined */\n  getElf(): Promise<string | undefined>;")

rep("""  private async ensureSymbols(): Promise<Map<string, SymbolInfo>> {
    const elf = this.deps.getElf();
    const nm = this.deps.getNm();""",
    """  private async ensureSymbols(): Promise<Map<string, SymbolInfo>> {
    const elf = await this.deps.getElf();
    const nm = this.deps.getNm();""")

# 换用新 ELF 时重置失败标记（重新编译后符号可能恢复）
rep("""    if (!this.symLoading) {
      this.symLoading = readSymbolTable(nm, elf).then((map) => {
        this.symCache = { elf, mtimeMs, map };
        this.symLoading = undefined;
      });
    }""",
    """    if (!this.symLoading) {
      const isNew = !this.symCache || this.symCache.elf !== elf || this.symCache.mtimeMs !== mtimeMs;
      this.symLoading = readSymbolTable(nm, elf).then((map) => {
        this.symCache = { elf, mtimeMs, map };
        if (isNew && map.size > 0) {
          // 新 ELF 可用：清除此前的解析失败标记，允许重试
          for (const e of this.entries) {
            e.resolveFailed = false;
            e.resolveTries = 0;
          }
        }
        this.symLoading = undefined;
      });
    }""")

# 空符号表诊断：限频日志说明原因
rep("""      const sym = await this.ensureSymbols();
      for (const e of unresolved) {""",
    """      const sym = await this.ensureSymbols();
      if (sym.size === 0) {
        const now = Date.now();
        if (!this.lastEmptySymLog || now - this.lastEmptySymLog > 10_000) {
          this.lastEmptySymLog = now;
          this.deps.log('变量监控: 无法离线解析（缺 ELF 构建产物或 nm 工具）——请先编译一次；也可直接监控 0x 地址');
        }
      }
      for (const e of unresolved) {""")

rep("  private lastProbeSample = 0;",
    "  private lastProbeSample = 0;\n  private lastEmptySymLog = 0;")

io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('watchView applied', n, 'edits')
