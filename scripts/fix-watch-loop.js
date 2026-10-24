const fs = require('fs');
const f = 'src/ui/watchView.ts';
let s = fs.readFileSync(f, 'utf8');
let n = 0;

function rep(a, b) {
  if (!s.includes(a)) { console.log('MISS:', JSON.stringify(a.slice(0, 70))); process.exit(1); }
  s = s.replace(a, b, 1);
  n++;
}

// 1. 条目增加解析尝试计数与失败标记
rep("interface WatchEntry {\n  expr: string;\n  /** 解析出的地址（运行中持续尝试解析直到成功） */\n  addr?: number;\n  /** 字节数（sizeof，默认 4） */\n  bytes: number;\n  /** 上次尝试解析的时间戳（限频 1s） */\n  lastResolve?: number;\n}",
  "interface WatchEntry {\n  expr: string;\n  /** 解析出的地址（运行中持续尝试解析直到成功） */\n  addr?: number;\n  /** 字节数（sizeof，默认 4） */\n  bytes: number;\n  /** 上次尝试解析的时间戳（限频 1s） */\n  lastResolve?: number;\n  /** 已尝试的微停机解析次数（上限 3，防止不可解析表达式导致无限暂停目标） */\n  resolveTries?: number;\n  /** 解析彻底失败（提示改用 0x 地址） */\n  resolveFailed?: boolean;\n}");

// 2. resolveEntry：样本路径计入尝试次数
rep("    e.lastResolve = now;\n    try {\n      const addrR = (await s.customRequest('evaluate', {\n        expression: `&(${e.expr})`,\n        context: 'repl',\n      })) as { result?: string };\n      const addr = parseEvalHexAddress(addrR?.result ?? '');\n      if (addr === undefined) {\n        return;\n      }",
  "    e.lastResolve = now;\n    if (inSample) {\n      e.resolveTries = (e.resolveTries ?? 0) + 1;\n    }\n    try {\n      const addrR = (await s.customRequest('evaluate', {\n        expression: `&(${e.expr})`,\n        context: 'repl',\n      })) as { result?: string };\n      const addr = parseEvalHexAddress(addrR?.result ?? '');\n      if (addr === undefined) {\n        if (inSample && (e.resolveTries ?? 0) >= 3) {\n          e.resolveFailed = true;\n          this.deps.log(`变量监控: ${e.expr} 无法解析（CMSIS 宏需 -g3？）——请改用 0x 地址`);\n        }\n        return;\n      }");

// 3. 微停机解析的筛选：只尝试未达上限的条目
rep("      const stillUnresolved = this.entries.filter((e) => e.addr === undefined);",
  "      const stillUnresolved = this.entries.filter((e) => e.addr === undefined && (e.resolveTries ?? 0) < 3);")

// 4. UI meta 行：解析失败时明确提示
rep("'<div class=\"meta\">' + (e.addr !== undefined ? '0x' + e.addr.toString(16).toUpperCase() : '解析中…') + ' · ' + e.bytes + 'B</div>' +",
  "'<div class=\"meta\">' + (e.addr !== undefined ? '0x' + e.addr.toString(16).toUpperCase() + ' · ' + e.bytes + 'B' : (e.resolveFailed ? '无法解析 — 请改用 0x 地址' : '解析中… · ' + e.bytes + 'B')) + '</div>' +")

fs.writeFileSync(f, s);
console.log('applied', n, 'edits');
