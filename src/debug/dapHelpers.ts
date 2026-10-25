/**
 * DAP 访问共享工具：会话判定、内存块读取。
 * 供外设/变量监控/内存视图/调用栈面板复用（probe-rs 引擎，运行中旁路直读）。
 */

import * as vscode from 'vscode';

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isEngineSession(s: vscode.DebugSession | undefined): boolean {
  return !!s && s.type === 'probe-rs-debug';
}

/** 读一块内存（失败返回 undefined，含目标运行中/探针瞬断） */
export async function readBlock(
  s: vscode.DebugSession,
  addr: number,
  len: number,
): Promise<Buffer | undefined> {
  try {
    const r = (await s.customRequest('readMemory', {
      memoryReference: `0x${addr.toString(16)}`,
      count: len,
    })) as { data?: string };
    const buf = Buffer.from(r?.data ?? '', 'base64');
    return buf.length > 0 ? buf : undefined;
  } catch {
    return undefined;
  }
}

/** 小端 hex（如 0x08000179） */
export function toHexLE(buf: Buffer, bits: number): string {
  const bytes = Math.max(1, Math.min(8, Math.ceil(bits / 8)));
  let v = 0n;
  for (let i = 0; i < bytes && i < buf.length; i++) {
    v |= BigInt(buf[i]) << BigInt(8 * i);
  }
  return `0x${v.toString(16).toUpperCase().padStart(bytes * 2, '0')}`;
}
