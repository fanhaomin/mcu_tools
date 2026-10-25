/**
 * ST-LINK 孤儿进程清理。
 *
 * VS Code 异常退出/被强杀/扩展宿主崩溃时，调试引擎的子进程（ST-LINK GDB Server、
 * OpenOCD）可能残留：它们仍以独占方式握着 ST-LINK，之后烧录/调试报「端口被占用/
 * 无法连接目标」，只能手动杀进程或重插探头。
 *
 * 在「即将占用 ST-LINK」的时机清理：启动调试前、烧录预检前、调试会话结束后
 * （延迟等引擎先收自己的子进程）。仅在无活跃调试会话时执行，避免误杀正在
 * 运行的调试服务；非 Windows 平台无对应进程名，跳过。
 */

import * as vscode from 'vscode';
import { execFileSafe } from '../util/process';

/** 可能独占 ST-LINK 的调试服务进程（Windows） */
const HOLDERS = ['ST-LINK_gdbserver.exe', 'openocd.exe'];

export async function killOrphanProbeHolders(
  reason: string,
  log: (m: string) => void,
): Promise<void> {
  if (process.platform !== 'win32' || vscode.debug.activeDebugSession) {
    return;
  }
  for (const name of HOLDERS) {
    try {
      const r = await execFileSafe('taskkill.exe', ['/F', '/IM', name], { timeoutMs: 8000 });
      // 退出码 0 = 确有进程被杀；128 = 进程不存在（正常情况，不刷屏）
      if (r.exitCode === 0) {
        log(`已清理残留的 ${name}（${reason}；上次调试异常退出遗留，此前一直占用 ST-LINK）`);
      }
    } catch {
      // taskkill 不可用等情形，忽略
    }
  }
}
