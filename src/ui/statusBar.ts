/**
 * 状态栏：工程/目标选择 + 编译 / 烧录 快捷按钮（一键执行，无需打开插件面板）。
 * 不再有独立的状态摘要项——结果看按钮图标与输出通道。
 */

import * as vscode from 'vscode';
import { WorkspaceState } from '../types';

export class StatusBar {
  private readonly buildBtn: vscode.StatusBarItem;
  private readonly flashBtn: vscode.StatusBarItem;
  private readonly projectBtn: vscode.StatusBarItem;

  constructor() {
    // 状态栏左侧快捷按钮：编译 / 烧录（一键执行，无需打开插件面板）
    this.buildBtn = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      62,
    );
    this.buildBtn.name = 'Auto CMake Flash 编译';
    this.buildBtn.text = '$(zap) 编译';
    this.buildBtn.tooltip = '编译工程（Auto CMake Flash）';
    this.buildBtn.command = 'autoCmakeFlash.build';
    this.flashBtn = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      61,
    );
    this.flashBtn.name = 'Auto CMake Flash 烧录';
    this.flashBtn.text = '$(rocket) 烧录';
    this.flashBtn.tooltip = '编译并烧录到目标芯片（Auto CMake Flash）';
    this.flashBtn.command = 'autoCmakeFlash.buildAndFlash';
    // 工程/目标选择按钮（最左）：显示当前工程名与编译目标，点击打开选择下拉框
    this.projectBtn = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      63,
    );
    this.projectBtn.name = 'Auto CMake Flash 工程/目标';
    this.projectBtn.command = 'autoCmakeFlash.chooseProject';
    this.update({ busy: 'none' });
  }

  update(state: WorkspaceState): void {
    // 工程/目标选择按钮（最左）：工程名·目标名，busy 时显示转圈
    const projectName =
      state.project?.name ??
      (state.root
        ? state.root.split(/[\\/]/).filter((s) => s.length > 0).pop()
        : undefined);
    this.projectBtn.text =
      state.busy !== 'none'
        ? '$(sync~spin)'
        : `$(folder) ${projectName ?? '选择工程'}${state.target ? `·${state.target}` : ''}`;
    this.projectBtn.tooltip = '选择工程或编译目标（Auto CMake Flash）';
    this.projectBtn.show();
    // 快捷按钮状态与显示
    this.buildBtn.text =
      state.busy === 'build' ? '$(sync~spin) 编译中' : '$(zap) 编译';
    this.flashBtn.text =
      state.busy === 'flash' ? '$(sync~spin) 烧录中' : '$(rocket) 烧录';
    this.buildBtn.show();
    this.flashBtn.show();
  }

  dispose(): void {
    this.projectBtn.dispose();
    this.buildBtn.dispose();
    this.flashBtn.dispose();
  }
}
