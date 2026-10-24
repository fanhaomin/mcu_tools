const fs = require('fs');
const f = 'src/ui/watchView.ts';
let s = fs.readFileSync(f, 'utf8');
let n = 0;

function rep(a, b) {
  if (!s.includes(a)) { console.log('MISS:', JSON.stringify(a.slice(0, 70))); process.exit(1); }
  s = s.replace(a, b, 1);
  n += 1;
}

// 1. 导入捕获模块
rep(`import { readSymbolTable, SymbolInfo } from '../debug/symbols';`,
    `import { readSymbolTable, SymbolInfo } from '../debug/symbols';\nimport { captureTopFrameVariables } from '../debug/stoppedCapture';`);

// 2. WatchEntry 增加 memoryReference
rep(`  /** 解析彻底失败（提示改用 0x 地址） */
  resolveFailed?: boolean;
}`,
`  /** 解析彻底失败（提示改用 0x 地址） */
  resolveFailed?: boolean;
  /** 断点捕获的 DAP memoryReference（局部变量经此监控） */
  memRef?: string;
}`);

// 3. persist 后追加 onTargetStopped 方法
rep(`  private async persist(): Promise<void> {
    await this.deps.memento.update(STORE_KEY, this.entries);
  }`,
`  private async persist(): Promise<void> {
    await this.deps.memento.update(STORE_KEY, this.entries);
  }

  /** 目标暂停（断点/复位停机）时由扩展调用：走变量作用域按名捕获 memoryReference */
  async onTargetStopped(session: vscode.DebugSession): Promise<void> {
    if (this.entries.length === 0) {
      return;
    }
    const captured = await captureTopFrameVariables(session);
    if (captured.size === 0) {
      return;
    }
    let hit = 0;
    for (const e of this.entries) {
      if (e.memRef || e.addr !== undefined) {
        continue;
      }
      const c = captured.get(e.expr.replace(/^&/, '').trim()) ?? captured.get(e.expr);
      if (c) {
        if (c.memoryReference) {
          e.memRef = c.memoryReference;
          e.resolveFailed = false;
          hit++;
        } else if (c.value && /^0x[0-9a-f]+/i.test(c.value.trim())) {
          // 无 memoryReference 但值本身是地址（指针变量）
          e.memRef = c.value.trim().split(/\\s/)[0];
          e.resolveFailed = false;
          hit++;
        }
      }
    }
    if (hit > 0) {
      this.deps.log('变量监控: 已从断点变量作用域捕获 ' + hit + ' 个条目的内存引用');
      await this.persist();
      this.postEntries();
    }
  }`);

// 4. 读取统一走 memRef / 地址（DAP readMemory 两种都支持）
rep(`    await Promise.all(
      this.entries
        .filter((e) => e.addr !== undefined)
        .map(async (e) => {
          const buf = await readBlock(s, e.addr!, e.bytes);
          if (buf) {
            results[e.expr] = {
              hex: toHexLE(buf, e.bytes * 8),
              ok: true,
              bytes: e.bytes,
              addr: e.addr!,
            };
          } else {
            failed.push(e);
            results[e.expr] = { hex: '…', ok: false, bytes: e.bytes, addr: e.addr! };
          }
        }),
    );`,
`    const readOne = async (e: WatchEntry) => {
      const ref = e.memRef ?? (e.addr !== undefined ? \\\`0x\\\${e.addr.toString(16)}\\\` : undefined);
      if (!ref) {
        return;
      }
      try {
        const r = (await s.customRequest('readMemory', {
          memoryReference: ref,
          count: e.bytes,
        })) as { data?: string };
        const buf = Buffer.from(r?.data ?? '', 'base64');
        if (buf.length > 0) {
          results[e.expr] = {
            hex: toHexLE(buf, e.bytes * 8),
            ok: true,
            bytes: e.bytes,
            addr: e.addr ?? 0,
          };
          return;
        }
      } catch {
        // 目标运行中不可读（cortex-debug）
      }
      failed.push(e);
      results[e.expr] = { hex: '…', ok: false, bytes: e.bytes, addr: e.addr ?? 0 };
    };
    await Promise.all(
      this.entries.filter((e) => e.addr !== undefined || e.memRef).map((e) => readOne(e)),
    );`);

fs.writeFileSync(f, s);
console.log('applied', n, 'edits');
