/**
 * 用户配置（VS Code Settings）读取与监听。
 */

import * as vscode from 'vscode';

export interface AutoCmakeFlashSettings {
  /** 相对工作区根目录或绝对路径，默认 build-auto */
  buildDir: string;
  buildType: 'Debug' | 'Release' | 'RelWithDebInfo' | 'MinSizeRel';
  generator: string;
  cmakePath: string;
  ninjaPath: string;
  armToolchainPath: string;
  programmerCliPath: string;
  cmakeToolchainFile: string;
  cmakeExtraArgs: string;
  downloadInterface: 'SWD' | 'JTAG';
  downloadSpeedKhz: number;
  resetAfterFlash: 'hardware' | 'software' | 'none';
  binFlashAddress: string;
  verboseLogging: boolean;
  buildTimeoutSec: number;
  flashTimeoutSec: number;
}

const SECTION = 'autoCmakeFlash';

export function loadSettings(): AutoCmakeFlashSettings {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const buildType = cfg.get<string>('buildType', 'Debug');
  const validTypes: AutoCmakeFlashSettings['buildType'][] = [
    'Debug',
    'Release',
    'RelWithDebInfo',
    'MinSizeRel',
  ];
  const iface = cfg.get<string>('downloadInterface', 'SWD');
  const reset = cfg.get<string>('resetAfterFlash', 'hardware');
  return {
    buildDir: cfg.get<string>('buildDir', 'build-auto') || 'build-auto',
    buildType: (validTypes as string[]).includes(buildType)
      ? (buildType as AutoCmakeFlashSettings['buildType'])
      : 'Debug',
    generator: cfg.get<string>('generator', 'Ninja') || 'Ninja',
    cmakePath: cfg.get<string>('cmakePath', ''),
    ninjaPath: cfg.get<string>('ninjaPath', ''),
    armToolchainPath: cfg.get<string>('armToolchainPath', ''),
    programmerCliPath: cfg.get<string>('programmerCliPath', ''),
    cmakeToolchainFile: cfg.get<string>('cmakeToolchainFile', ''),
    cmakeExtraArgs: cfg.get<string>('cmakeExtraArgs', ''),
    downloadInterface: iface === 'JTAG' ? 'JTAG' : 'SWD',
    downloadSpeedKhz: clampNumber(cfg.get<number>('downloadSpeedKhz', 4000), 100, 24000, 4000),
    resetAfterFlash:
      reset === 'software' || reset === 'none' ? reset : ('hardware' as const),
    binFlashAddress: cfg.get<string>('binFlashAddress', ''),
    verboseLogging: cfg.get<boolean>('verboseLogging', false),
    buildTimeoutSec: clampNumber(cfg.get<number>('buildTimeoutSec', 600), 10, 7200, 600),
    flashTimeoutSec: clampNumber(cfg.get<number>('flashTimeoutSec', 300), 10, 3600, 300),
  };
}

function clampNumber(v: number | undefined, min: number, max: number, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return dflt;
  }
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** 监听设置变化（刷新 UI / 日志开关） */
export function onSettingsChange(cb: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SECTION)) {
      cb();
    }
  });
}
