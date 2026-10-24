/**
 * 工程设置写入器：把 autoCmakeFlash.* 写入当前工程的 .vscode/settings.json。
 *
 * 所有键已在 package.json contributes.configuration 注册（scope: resource），
 * 走 VS Code Configuration API 正规写入——值传 undefined 即移除自定义项（恢复默认）。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/** 旧版写入 bug 可能落进 settings.json 顶层的无前缀死键（与配置项同名） */
const LEGACY_DEAD_KEYS = new Set([
  'buildDir', 'buildType', 'generator', 'cmakeToolchainFile', 'cmakeExtraArgs',
  'downloadInterface', 'downloadSpeedKhz', 'resetAfterFlash', 'binFlashAddress',
  'debugEngine', 'probeRsChip', 'gdbPath', 'gdbServerPath', 'svdFile',
  'cmakePath', 'ninjaPath', 'armToolchainPath', 'programmerCliPath', 'cubemxPath',
  'verboseLogging', 'buildTimeoutSec', 'flashTimeoutSec', 'debugRefreshMs',
]);

export async function updateWorkspaceSetting(
  key: string,
  value: string | number | boolean | undefined,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    // 文件夹级写入：scopeUri 在 getConfiguration 上指定（update 本身无此参数）
    await vscode.workspace
      .getConfiguration('autoCmakeFlash', folder.uri)
      .update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
  } else {
    await vscode.workspace
      .getConfiguration('autoCmakeFlash')
      .update(key, value, vscode.ConfigurationTarget.Workspace);
  }
}

/**
 * 一次性清理：删除 settings.json 顶层的旧无前缀死键（0.9.39 前的写入 bug 遗留）。
 * 返回被删除的键名（空数组 = 无需清理/文件不可解析）。
 */
export async function cleanupLegacyDeadKeys(): Promise<string[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return [];
  }
  const file = path.join(folder.uri.fsPath, '.vscode', 'settings.json');
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  let obj: Record<string, unknown>;
  try {
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1');
    obj = JSON.parse(stripped || '{}') as Record<string, unknown>;
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const k of Object.keys(obj)) {
    if (LEGACY_DEAD_KEYS.has(k)) {
      delete obj[k];
      removed.push(k);
  }
  }
  if (removed.length === 0) {
    return [];
  }
  await fs.promises.writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return removed;
}
