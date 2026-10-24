/**
 * 工程设置写入器：把 autoCmakeFlash.* 写入当前工程的 .vscode/settings.json。
 *
 * VS Code 对未在 contributes.configuration 声明的键拒绝 Configuration API 的
 * 文件夹级写入（"没有注册配置 ... 因此无法写入文件夹设置"），因此直接编辑
 * settings.json 文件（尽力保留注释：去注释解析后回写格式化 JSON）。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function updateWorkspaceSetting(
  key: string,
  value: string | number | boolean | undefined,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    // 无工作区：退回全局设置（用户级对未注册键可写）
    await vscode.workspace.getConfiguration('autoCmakeFlash').update(key, value, vscode.ConfigurationTarget.Global);
    return;
  }
  const file = path.join(folder.uri.fsPath, '.vscode', 'settings.json');
  let obj: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(file, 'utf8');
    // 尽力剥离注释与尾逗号（容忍 JSONC）
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1');
    obj = JSON.parse(stripped || '{}') as Record<string, unknown>;
  } catch {
    // 文件不存在 → 从空对象开始；解析失败 → 退回全局写
    if (fs.existsSync(file)) {
      await vscode.workspace.getConfiguration('autoCmakeFlash').update(key, value, vscode.ConfigurationTarget.Global);
      return;
    }
  }
  if (value === undefined) {
    delete obj[key];
  } else {
    obj[key] = value;
  }
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
