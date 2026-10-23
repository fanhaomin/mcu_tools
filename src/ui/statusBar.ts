/**
 * 状态栏：显示当前忙/闲、最近一次构建或烧录结果摘要。
 */

import * as vscode from 'vscode';
import { WorkspaceState } from '../types';

export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly buildBtn: vscode.StatusBarItem;
  private readonly flashBtn: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      60,
    );
    this.item.name = 'Auto CMake Flash';
    this.item.command = 'auto-cmake-flash.focus';
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
    this.update({ busy: 'none' });
  }

  update(state: WorkspaceState): void {
    const item = this.item;
    if (state.busy === 'build') {
      item.text = '$(sync~spin) ACF 编译中...';
      item.tooltip = 'Auto CMake Flash 正在编译，可在输出面板查看进度';
    } else if (state.busy === 'flash') {
      item.text = '$(sync~spin) ACF 烧录中...';
      item.tooltip = 'Auto CMake Flash 正在烧录';
    } else if (state.busy === 'configure') {
      item.text = '$(sync~spin) ACF 配置中...';
      item.tooltip = 'Auto CMake Flash 正在执行 CMake 配置';
    } else if (state.lastFlash) {
      if (state.lastFlash.status === 'success') {
        item.text = '$(check) ACF 烧录成功';
        item.tooltip = `最近烧录: 下载成功，校验${state.lastFlash.verify === 'passed' ? '通过' : '未确认'}`;
      } else if (state.lastFlash.verify === 'unconfirmed' && state.lastFlash.downloaded) {
        item.text = '$(question) ACF 校验未确认';
        item.tooltip = '下载完成但校验状态未确认，请查看日志';
      } else {
        item.text = '$(error) ACF 烧录异常';
        item.tooltip = `最近烧录状态: ${state.lastFlash.status}`;
      }
    } else if (state.lastBuild) {
      if (state.lastBuild.success) {
        item.text = '$(check) ACF 编译成功';
        item.tooltip = `最近编译耗时 ${(state.lastBuild.durationMs / 1000).toFixed(1)}s\n点击打开 Auto CMake Flash 面板`;
      } else {
        item.text = '$(error) ACF 编译失败';
        item.tooltip = '最近一次编译失败，已阻止烧录。\n点击打开 Auto CMake Flash 面板';
      }
    } else {
      item.text = '$(chip) ACF';
      item.tooltip = 'Auto CMake Flash（点击打开面板）';
    }
    // 快捷按钮状态与显示
    this.buildBtn.text = state.busy === 'build' ? '$(sync~spin) 编译中' : '$(zap) 编译';
    this.flashBtn.text = state.busy === 'flash' ? '$(sync~spin) 烧录中' : '$(rocket) 烧录';
    this.buildBtn.show();
    this.flashBtn.show();
    item.show();
  }

  dispose(): void {
    this.buildBtn.dispose();
    this.flashBtn.dispose();
    this.item.dispose();
  }
}
