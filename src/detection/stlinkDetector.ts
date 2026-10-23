/**
 * ST-LINK 检测：基于 STM32CubeProgrammer CLI 的 `-l`（列出调试探头）命令。
 *
 * 重要区分：
 * - “找到 STM32CubeProgrammer CLI” 只是软件就绪，不代表有硬件连接。
 * - “检测到 ST-LINK 探头” 表示 USB 层面看到适配器，不代表目标芯片可以连接。
 * - “目标芯片可连接” 需要通过 `-c port=SWD` 连接成功来确认（烧录流程中执行）。
 */

import { StLinkInfo } from '../types';
import { execFileSafe, ProcResult, RunOptions } from '../util/process';
import { parseProbeList, stlinkFailureHints } from '../flash/verification';

export type ProbeRunner = (
  file: string,
  args: string[],
  opts?: RunOptions,
) => Promise<ProcResult>;

export async function detectStLink(
  cliPath: string | undefined,
  run: ProbeRunner = execFileSafe,
  timeoutMs = 30_000,
): Promise<StLinkInfo> {
  if (!cliPath) {
    return {
      status: 'cliMissing',
      probeCount: 0,
      probes: [],
      error: '未找到 STM32CubeProgrammer CLI，无法检测 ST-LINK。请安装 STM32CubeCLT 或在设置中指定路径。',
    };
  }

  const result = await run(cliPath, ['-l'], { timeoutMs });
  const parsed = parseProbeList(result.stdout);
  const combined = `${result.stdout}\n${result.stderr}`;

  if (parsed.count > 0) {
    return {
      status: 'probeDetected',
      probeCount: parsed.count,
      probes: parsed.probes,
      cliPath,
      rawOutput: result.stdout,
      checkedAt: new Date().toISOString(),
    };
  }

  if (result.spawnError) {
    return {
      status: 'unknown',
      probeCount: 0,
      probes: [],
      cliPath,
      error: `无法运行 STM32CubeProgrammer CLI: ${result.spawnError}`,
      checkedAt: new Date().toISOString(),
    };
  }

  if (result.timedOut) {
    return {
      status: 'unknown',
      probeCount: 0,
      probes: [],
      cliPath,
      error: 'ST-LINK 列表命令超时，检测结果未知。',
      checkedAt: new Date().toISOString(),
    };
  }

  // 命令执行了但没有任何探头
  return {
    status: 'noProbe',
    probeCount: 0,
    probes: [],
    cliPath,
    rawOutput: result.stdout,
    error:
      '未检测到 ST-LINK 适配器。可能原因:\n' +
      stlinkFailureHints(combined)
        .map((h, i) => `${i + 1}. ${h}`)
        .join('\n'),
    checkedAt: new Date().toISOString(),
  };
}
