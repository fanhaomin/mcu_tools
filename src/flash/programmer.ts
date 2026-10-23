/**
 * 烧录流程编排（3.6 节）。
 *
 * 流程与安全门禁（顺序不可调换）：
 * 1. 前置条件检查（checkFlashPreconditions）：编译成功、产物存在且新鲜、
 *    BIN 地址已确认、芯片型号已确定 —— 任一不满足直接阻断，不弹确认框。
 * 2. CLI 可用性检查。
 * 3. `-l` 检测 ST-LINK 探头 —— 明确区分“工具存在”与“硬件在线”。
 * 4. `-c port=SWD` 预检目标连接。
 * 5. 弹出确认窗口（工程路径/MCU/烧录器/文件/格式/BIN 地址/目标状态/操作）。
 *    第一版：无论任何自动化设置，每次烧录都必须用户明确确认。
 * 6. 下载 + 校验（-d ... -v），按输出内容判定校验状态。
 * 7. 按配置复位（-rst hw|sw）。
 * 8. 返回结构化结果，下载/校验/复位状态分开呈现。
 *
 * 通过 FlashDeps 注入，可在单元测试中完整模拟硬件行为。
 */

import * as path from 'path';
import {
  FlashOutcome,
  McuInfo,
  StLinkInfo,
  TargetConnection,
  VerifyStatus,
} from '../types';
import { parseConnectResult, parseDownloadResult, parseProbeList, stlinkFailureHints } from './verification';
import { Stm32CubeProgrammerCli } from './stm32CubeProgrammer';
import { FlashPrecheck } from '../cmake/artifacts';

export interface FlashSettings {
  iface: 'SWD' | 'JTAG';
  speedKhz: number;
  resetAfterFlash: 'hardware' | 'software' | 'none';
}

/** 确认窗口必须展示的全部信息 */
export interface FlashConfirmInfo {
  workspacePath: string;
  mcuModel: string;
  mcuNote: string;
  programmer: string;
  probeStatus: string;
  targetStatus: string;
  filePath: string;
  format: string;
  binAddress?: string;
  action: string;
  stale: boolean;
}

export interface FlashDeps {
  cli: Stm32CubeProgrammerCli;
  workspaceRoot: string;
  mcu: McuInfo;
  precheck: FlashPrecheck;
  settings: FlashSettings;
  confirm(info: FlashConfirmInfo): Promise<boolean>;
  log(msg: string): void;
  /** 上次 ST-LINK 检测结果（用于日志；流程内会重新检测） */
  lastStLink?: StLinkInfo;
}

export function describeProbeStatus(st: StLinkInfo | undefined): string {
  if (!st || st.status === 'notChecked') {
    return '未检查';
  }
  switch (st.status) {
    case 'cliMissing':
      return 'STM32CubeProgrammer CLI 未找到';
    case 'probeDetected':
      return `已检测到 ${st.probeCount} 个 ST-LINK`;
    case 'noProbe':
      return '未检测到 ST-LINK';
    default:
      return '检测结果未知';
  }
}

function describeTarget(t: TargetConnection): string {
  if (!t.connected) {
    return '未连接';
  }
  const parts: string[] = [];
  if (t.deviceName) {
    parts.push(t.deviceName);
  }
  if (t.deviceId) {
    parts.push(`DeviceID ${t.deviceId}`);
  }
  return `已连接${parts.length ? `（${parts.join('，')}）` : '（输出中未含设备明细）'}`;
}

export async function performFlash(deps: FlashDeps): Promise<FlashOutcome> {
  const { log, cli, settings } = deps;
  const messages: string[] = [];

  // 1. 前置门禁
  if (!deps.precheck.ok) {
    const blocker = deps.precheck.blockers.join(' ');
    log(`烧录已阻断: ${blocker}`);
    return {
      status: 'blocked',
      downloaded: false,
      verify: 'skipped',
      messages: deps.precheck.blockers,
      blocker,
    };
  }
  const artifact = deps.precheck.artifact!;
  const binAddress = deps.precheck.binAddress;

  // 2. CLI 可用性
  if (!cli || !cli.cliPath) {
    const blocker = '未找到 STM32CubeProgrammer CLI，无法烧录。请安装 STM32CubeCLT。';
    log(blocker);
    return { status: 'blocked', downloaded: false, verify: 'skipped', messages: [blocker], blocker };
  }

  // 3. ST-LINK 探头检测（硬件在线 ≠ 软件已安装）
  log(`检测 ST-LINK 探头: "${cli.cliPath}" -l`);
  const probeRun = await cli.listProbes();
  const probes = parseProbeList(probeRun.stdout);
  log(
    `探头检测结果: ${probes.count} 个；退出码 ${probeRun.exitCode}` +
      (probeRun.spawnError ? `；错误: ${probeRun.spawnError}` : ''),
  );
  if (deps.precheck.warnings.length > 0) {
    for (const w of deps.precheck.warnings) {
      log(`警告: ${w}`);
    }
    messages.push(...deps.precheck.warnings);
  }
  if (probes.count === 0) {
    log(`ST-LINK 列表命令原始输出:\n${probeRun.stdout}`);
    const hints = stlinkFailureHints(`${probeRun.stdout}\n${probeRun.stderr}`);
    messages.push('未检测到 ST-LINK 适配器', ...hints);
    return {
      status: 'no-probe',
      downloaded: false,
      verify: 'skipped',
      messages,
      blocker: '未检测到 ST-LINK 适配器',
      exitCode: probeRun.exitCode,
    };
  }

  // 4. 目标连接预检
  log(`连接目标预检: "${cli.cliPath}" -c port=${settings.iface} freq=${settings.speedKhz}`);
  const connRun = await cli.connectProbe({
    iface: settings.iface,
    speedKhz: settings.speedKhz,
  });
  const target = parseConnectResult(connRun.stdout, connRun.exitCode);
  log(`目标连接状态: ${describeTarget(target)}`);
  log(`连接命令原始输出:\n${connRun.stdout}${connRun.stderr ? `\n[stderr]\n${connRun.stderr}` : ''}`);
  if (!target.connected) {
    const hints = stlinkFailureHints(`${connRun.stdout}\n${connRun.stderr}`);
    messages.push(
      `目标芯片无法连接（${target.error ?? '未知原因'}）`,
      ...hints,
    );
    return {
      status: 'connect-failed',
      downloaded: false,
      verify: 'skipped',
      messages,
      blocker: '目标芯片无法连接',
      exitCode: connRun.exitCode,
    };
  }

  // 5. 用户确认（第一版：每次烧录都必须确认）
  const mcuNote = deps.mcu.confirmedByUser
    ? '用户手动确认'
    : `自动识别（可信度: ${deps.mcu.confidence}）`;
  const info: FlashConfirmInfo = {
    workspacePath: deps.workspaceRoot,
    mcuModel: deps.mcu.base || deps.mcu.family || '待确认',
    mcuNote,
    programmer: 'ST-LINK (STM32CubeProgrammer CLI)',
    probeStatus: `已检测到 ${probes.count} 个 ST-LINK`,
    targetStatus: describeTarget(target),
    filePath: artifact.path,
    format: artifact.format.toUpperCase(),
    binAddress,
    action:
      `通过 STM32CubeProgrammer CLI 将 ${path.basename(artifact.path)} 写入目标` +
      (binAddress ? `（地址 ${binAddress}）` : '') +
      '，随后校验' +
      (settings.resetAfterFlash !== 'none'
        ? `，完成后执行${settings.resetAfterFlash === 'hardware' ? '硬件' : '软件'}复位`
        : '，不复位'),
    stale: deps.precheck.stale,
  };
  const confirmed = await deps.confirm(info);
  if (!confirmed) {
    log('用户取消了烧录操作。');
    return { status: 'cancelled', downloaded: false, verify: 'skipped', messages: ['用户取消操作'] };
  }

  // 6. 下载 + 校验
  log(
    `开始烧录: "${cli.cliPath}" -c port=${settings.iface} freq=${settings.speedKhz} ` +
      `-d "${artifact.path}"${binAddress ? ` ${binAddress}` : ''} -v`,
  );
  const dlRun = await cli.download({
    iface: settings.iface,
    speedKhz: settings.speedKhz,
    file: artifact.path,
    address: binAddress,
    verify: true,
  });
  const dl = parseDownloadResult(dlRun.stdout, dlRun.exitCode, true);
  log(`烧录命令退出码: ${dlRun.exitCode}；下载判定: ${dl.downloaded ? '成功' : '失败'}；校验判定: ${dl.verify}`);
  log(`烧录命令原始输出:\n${dlRun.stdout}${dlRun.stderr ? `\n[stderr]\n${dlRun.stderr}` : ''}`);
  messages.push(...dl.notes);

  // 7. 复位（仅在下载成功时执行）
  let resetFailed = false;
  if (dl.downloaded && settings.resetAfterFlash !== 'none') {
    try {
      const rstRun = await cli.reset({
        iface: settings.iface,
        speedKhz: settings.speedKhz,
        mode: settings.resetAfterFlash === 'hardware' ? 'hardware' : 'software',
      });
      if (rstRun.exitCode !== 0) {
        resetFailed = true;
        messages.push(`复位命令执行失败（退出码 ${rstRun.exitCode}），固件已写入，可手动复位。`);
        log(`复位失败: ${rstRun.stderr || rstRun.stdout}`);
      } else {
        log('目标复位完成。');
      }
    } catch (e) {
      resetFailed = true;
      messages.push(`复位命令异常: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 8. 汇总结果（下载/校验/复位状态分开呈现）
  if (!dl.downloaded) {
    return {
      status: 'download-failed',
      downloaded: false,
      verify: 'failed',
      messages,
      exitCode: dlRun.exitCode,
    };
  }
  if (dl.verify === 'failed') {
    return {
      status: 'verify-failed',
      downloaded: true,
      verify: 'failed',
      messages,
      exitCode: dlRun.exitCode,
    };
  }
  if (dl.verify === 'unconfirmed') {
    return {
      status: 'verify-unconfirmed',
      downloaded: true,
      verify: 'unconfirmed',
      messages: [
        ...messages,
        '下载命令执行完成，校验状态未确认。请在日志中核对 STM32CubeProgrammer 输出。',
      ],
      exitCode: dlRun.exitCode,
    };
  }
  return {
    status: resetFailed ? 'reset-failed' : 'success',
    downloaded: true,
    verify: 'passed' as VerifyStatus,
    messages,
    exitCode: dlRun.exitCode,
  };
}
