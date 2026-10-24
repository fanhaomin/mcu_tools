/**
 * 变量监控的「断点捕获」：目标暂停（断点/复位停机）时走一遍 DAP 变量作用域
 * （threads → stackTrace → scopes → variables），按名字匹配监控条目并记下
 * memoryReference——继续运行后即可对该地址旁路直读（局部变量也能监控）。
 */

import * as vscode from 'vscode';

export interface CapturedVar {
  /** DAP memoryReference（可能是 0x 地址或适配器句柄） */
  memoryReference?: string;
  /** DAP variablesReference（数组/结构体的子节点） */
  variablesReference?: number;
  /** 解析出的展示值（暂停瞬间的值） */
  value?: string;
}

/** 走一遍顶层栈帧的变量作用域，返回 name → 捕获信息 */
export async function captureTopFrameVariables(
  session: vscode.DebugSession,
): Promise<Map<string, CapturedVar>> {
  const out = new Map<string, CapturedVar>();
  try {
    const th = (await session.customRequest('threads')) as {
      threads?: { id: number; name?: string }[];
    };
    const threadId = th?.threads?.[0]?.id;
    if (threadId === undefined) {
      return out;
    }
    const st = (await session.customRequest('stackTrace', {
      threadId,
      levels: 1,
    })) as { stackFrames?: { id: number }[] };
    const frameId = st?.stackFrames?.[0]?.id;
    if (frameId === undefined) {
      return out;
    }
    const scopes = (await session.customRequest('scopes', { frameId })) as {
      scopes?: { name?: string; variablesReference: number }[];
    };
    for (const scope of scopes?.scopes ?? []) {
      if (!scope.variablesReference) {
        continue;
      }
      try {
        const vars = (await session.customRequest('variables', {
          variablesReference: scope.variablesReference,
        })) as {
          variables?: {
            name?: string;
            value?: string;
            memoryReference?: string;
            variablesReference?: number;
          }[];
        };
        for (const v of vars?.variables ?? []) {
          if (v.name && !out.has(v.name)) {
            out.set(v.name, {
              memoryReference: v.memoryReference,
              variablesReference: v.variablesReference,
              value: v.value,
            });
          }
        }
      } catch {
        // 单个作用域失败不影响其他
      }
    }
  } catch {
    // 目标不可用
  }
  return out;
}
