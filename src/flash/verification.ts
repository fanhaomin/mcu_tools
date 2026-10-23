/**
 * STM32CubeProgrammer CLI 输出解析（纯函数，可单元测试）。
 *
 * 解析基于对 CLI 实际输出的模式匹配，并始终保留原始输出用于日志与人工核对。
 * 当无法可靠判断时明确返回 unconfirmed，绝不把“退出码 0”直接等同于“校验成功”。
 *
 * CLI 语法依据（STM32CubeProgrammer v2.x，UM2237）：
 *   STM32_Programmer_CLI.exe -l                     列出已连接的调试探头
 *   STM32_Programmer_CLI.exe -c port=SWD freq=4000 通过 SWD 连接目标
 *   STM32_Programmer_CLI.exe -c ... -d file [addr]  下载文件（BIN 需要地址）
 *   STM32_Programmer_CLI.exe -c ... -d file -v      下载并校验
 *   STM32_Programmer_CLI.exe -c ... -rst hw|sw      复位目标
 * 手动验证方法见 README“CLI 手动验证”一节。
 */

import { StLinkProbe, TargetConnection, VerifyStatus } from '../types';

/** 解析 `-l` 输出中的 ST-LINK 探头数量与序列号 */
export function parseProbeList(stdout: string): { count: number; probes: StLinkProbe[] } {
  const text = stdout ?? '';
  if (/no\s+(?:connected\s+)?st-?link/i.test(text)) {
    return { count: 0, probes: [] };
  }

  const probes: StLinkProbe[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 形如 "ST-LINK probe 0:" / "ST-Link Probe 0 :" / "ST-LINK SN : xxx" 的行视为一个探头
    if (/ST-?LINK\s+(probe\s*\d*|SN\s*:)/i.test(line)) {
      const probe: StLinkProbe = {};
      const snM = /SN\s*[:=]\s*([0-9A-Za-z]{4,})/i.exec(line);
      if (snM) {
        probe.serial = snM[1];
      }
      // 在当前行与后续 3 行中寻找 SN 与 Firmware 信息
      for (let j = i; j < Math.min(i + 4, lines.length); j++) {
        const l = lines[j];
        if (!probe.serial) {
          const m = /SN\s*[:=]\s*([0-9A-Za-z]{4,})/i.exec(l);
          if (m) {
            probe.serial = m[1];
          }
        }
        const fw = /(?:Firmware|FW)\s*[:=]\s*(.+)/i.exec(l);
        if (fw && !probe.firmware) {
          probe.firmware = fw[1].trim();
        }
      }
      // 去重：同一序列号只记一次
      if (probe.serial && probes.some((p) => p.serial === probe.serial)) {
        continue;
      }
      probes.push(probe);
    }
  }
  return { count: probes.length, probes };
}

/** 解析 `-c port=SWD` 连接输出 */
export function parseConnectResult(
  stdout: string,
  exitCode: number | null,
): TargetConnection {
  const text = stdout ?? '';
  const conn: TargetConnection = { connected: false, rawOutput: text };

  const nameM =
    /Device name\s*:\s*(.+)/i.exec(text) ?? /Device\s*:\s*(STM32\S+)/i.exec(text);
  if (nameM) {
    conn.deviceName = nameM[1].trim();
  }
  const idM = /Device ?ID\s*:\s*(0x[0-9A-Fa-f]+)/i.exec(text);
  if (idM) {
    conn.deviceId = idM[1];
  }
  const cpuM = /CPU\s*type\s*:\s*(.+)/i.exec(text);
  if (cpuM) {
    conn.cpu = cpuM[1].trim();
  }

  if (exitCode !== 0) {
    conn.error = extractLastError(text) ?? `连接命令退出码 ${exitCode}`;
    return conn;
  }

  // 退出码 0：连接成功。识别特征行增强可信度。
  if (
    /device connected/i.test(text) ||
    /connection mode/i.test(text) ||
    /device ?id/i.test(text) ||
    conn.deviceName ||
    conn.deviceId
  ) {
    conn.connected = true;
  } else {
    // 退出码 0 但输出无特征行 —— 视为已连接（CLI 退出码为唯一可靠依据），标注未确认细节
    conn.connected = true;
    conn.error = '连接命令退出码为 0，但输出中未识别到设备信息行';
  }
  return conn;
}

export interface DownloadParseResult {
  downloaded: boolean;
  verify: VerifyStatus;
  notes: string[];
}

/**
 * 解析 `-d file [-v]` 的输出。
 * 校验状态判定（不依赖退出码单一因素）：
 * - 输出含 "verified successfully" / "verify ... ok" 等 → passed
 * - 输出含 "verification failed" / 校验错误 → failed
 * - 下载成功但没有任何校验行（或未请求 -v）→ unconfirmed / skipped
 */
export function parseDownloadResult(
  stdout: string,
  exitCode: number | null,
  verifyRequested: boolean,
): DownloadParseResult {
  const text = stdout ?? '';
  const notes: string[] = [];

  const downloadOk =
    /file download complete/i.test(text) ||
    /download(?:ing)?\.\.\. *100|download finished/i.test(text);
  const hasError = /\berror\b/i.test(text) && !/verified successfully/i.test(text);
  const downloadFailed = /download failed/i.test(text) || (hasError && !downloadOk);

  const verifyPassed =
    /verified successfully/i.test(text) ||
    /verif\w*\s*(?:operation\s*)?(?:complete|success(?:ful)?|ok)\b/i.test(text);
  const verifyFailed =
    /verif\w*\s*(?:failed|error)/i.test(text) ||
    (/error[^\n]*verif\w*/i.test(text) && !verifyPassed);

  let downloaded: boolean;
  if (exitCode === 0 && !downloadFailed) {
    downloaded = true;
  } else {
    downloaded = downloadOk && !downloadFailed;
  }

  let verify: VerifyStatus;
  if (!verifyRequested) {
    verify = 'skipped';
  } else if (verifyFailed) {
    verify = 'failed';
  } else if (verifyPassed && downloaded) {
    verify = 'passed';
  } else {
    verify = 'unconfirmed';
    notes.push('输出中未找到明确的校验结果行，校验状态未确认。');
  }

  return { downloaded, verify, notes };
}

/** 从 CLI 错误输出中提取人类可读的失败原因 */
export function extractLastError(text: string): string | undefined {
  if (!text) {
    return undefined;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (const line of lines.reverse()) {
    if (/error|fail|cannot|unable|no\s|not\s/i.test(line)) {
      return line.trim();
    }
  }
  return lines[lines.length - 1]?.trim();
}

/** ST-LINK/目标连接失败时的排查提示 */
export function stlinkFailureHints(output: string): string[] {
  const hints = [
    'ST-LINK 未连接或未被系统识别（检查 USB 线与接口）',
    'USB 驱动可能存在问题（重新安装 STM32CubeProgrammer 附带的 ST-LINK 驱动）',
    'SWD 接线可能有问题（检查 SWDIO/SWCLK/GND/3V3 连线）',
    '目标板可能未供电',
    '目标芯片可能无法正常连接（芯片锁死/读保护/RST 状态异常，可尝试 CONNECT UNDER RESET）',
  ];
  if (/usb|driver/i.test(output)) {
    hints.unshift('CLI 输出提及 USB/驱动问题，优先检查 ST-LINK 驱动。');
  }
  return hints;
}

/** 从版本/列表命令输出中提取 CLI 版本号 */
export function extractCliVersion(text: string): string | undefined {
  const m = /(?:STM32CubeProgrammer|CubeProgrammer)\s+v?(\d+\.\d+\.\d+)/i.exec(text ?? '');
  return m?.[1];
}
