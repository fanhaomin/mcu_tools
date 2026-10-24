/**
 * 内存 hexdump 格式化（纯函数）。
 */

export interface HexRow {
  /** 行起始地址（格式化好的 0x 前缀字符串） */
  addr: string;
  /** 每字节两位大写 hex；不足补空 */
  bytes: string[];
  /** ASCII 渲染（不可打印字符显示 ·） */
  ascii: string;
}

const PER_ROW = 16;

export function formatHexDump(data: Buffer, baseAddr: number, perRow: number = PER_ROW): HexRow[] {
  const rows: HexRow[] = [];
  const total = Math.max(data.length, 1);
  for (let off = 0; off < total; off += perRow) {
    const bytes: string[] = [];
    let ascii = '';
    for (let i = 0; i < perRow; i++) {
      if (off + i < data.length) {
        const b = data[off + i];
        bytes.push(b.toString(16).toUpperCase().padStart(2, '0'));
        ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·';
      } else {
        bytes.push('');
        ascii += ' ';
      }
    }
    rows.push({
      addr: `0x${(baseAddr + off).toString(16).toUpperCase().padStart(8, '0')}`,
      bytes,
      ascii,
    });
  }
  return rows;
}

/** 解析 GDB/DAP evaluate 结果中的第一个十六进制地址（如 "$1 = 0x20000000 <led>"） */
export function parseEvalHexAddress(result: string): number | undefined {
  const m = /0x[0-9a-fA-F]+/.exec(String(result ?? ''));
  if (!m) {
    return undefined;
  }
  const n = parseInt(m[0], 16);
  return Number.isFinite(n) ? n : undefined;
}

/** 解析 evaluate 结果中的十进制值（GDB 输出形如 "$2 = 4"，优先取 = 后面的数字） */
export function parseEvalInt(result: string): number | undefined {
  const str = String(result ?? '');
  const eq = /=\s*(-?\d+)/.exec(str);
  const m = eq ? eq[1] : (/(-?\d+)/.exec(str)?.[0] ?? '');
  if (!m) {
    return undefined;
  }
  const n = parseInt(m, 10);
  return Number.isFinite(n) ? n : undefined;
}
