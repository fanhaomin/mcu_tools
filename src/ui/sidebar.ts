/**
 * 侧边栏 TreeView：工程识别 / 环境状态 / 构建状态 / 烧录状态，
 * 每一行都绑定实际命令（点击即执行），不做占位界面。
 */

import * as vscode from 'vscode';
import {
  StLinkInfo,
  ToolchainInfo,
  WorkspaceState,
  Confidence,
  FlashOutcome,
} from '../types';
import { describeMcu } from '../detection/stm32Detector';
import { missingToolAdvice } from '../detection/toolchainDetector';

interface TreeNode extends vscode.TreeItem {}

export class SidebarProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly state: () => WorkspaceState) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return [
        this.makeSection('$(file-directory) 工程', 'section-project'),
        this.makeSection('$(tools) 开发环境', 'section-env'),
        this.makeSection('$(build) 构建', 'section-build'),
        this.makeSection('$(cloud-upload) 烧录', 'section-flash'),
      ];
    }
    const s = this.state();
    switch (element.contextValue) {
      case 'section-project':
        return this.projectRows(s);
      case 'section-env':
        return this.envRows(s);
      case 'section-build':
        return this.buildRows(s);
      case 'section-flash':
        return this.flashRows(s);
      default:
        return [];
    }
  }

  private makeSection(label: string, contextValue: string): TreeNode {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
    item.contextValue = contextValue;
    return item;
  }

  private row(
    label: string,
    opts: {
      command?: string;
      commandTitle?: string;
      tooltip?: string;
      contextValue?: string;
    } = {},
  ): TreeNode {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    if (opts.command) {
      item.command = {
        command: opts.command,
        title: opts.commandTitle ?? label,
      };
    }
    item.tooltip = opts.tooltip;
    item.contextValue = opts.contextValue;
    return item;
  }

  private projectRows(s: WorkspaceState): TreeNode[] {
    const rows: TreeNode[] = [];
    const p = s.project;
    if (!p) {
      rows.push(
        this.row('$(circle-slash) 尚未扫描工程（点击扫描）', {
          command: 'autoCmakeFlash.scanProject',
          tooltip: '扫描当前工作区，识别 STM32 工程结构',
        }),
      );
      return rows;
    }
    rows.push(
      this.row(`$(folder-active) 工程: ${p.name}`, {
        command: 'autoCmakeFlash.scanProject',
        commandTitle: '重新扫描',
        tooltip: p.root,
      }),
    );
    rows.push(
      this.row(
        p.mcu.model
          ? `$(chip) MCU: ${describeMcu(p.mcu)}`
          : '$(warning) MCU: 芯片型号待确认（点击手动选择）',
        {
          command: 'autoCmakeFlash.chooseMcu',
          commandTitle: '选择芯片型号',
          tooltip:
            p.mcu.evidence.length > 0
              ? p.mcu.evidence.map((e) => `${e.source}: ${e.detail}`).join('\n')
              : '未收集到芯片证据',
        },
      ),
    );
    rows.push(
      this.row(
        `$(shield) 识别可信度: ${confidenceLabel(p.mcu.confidence)}${p.mcu.confirmedByUser ? '（用户确认）' : ''}`,
        { tooltip: p.mcu.warnings.join('\n') || '证据充分性评级' },
      ),
    );
    rows.push(
      this.row(
        `$(json) CubeMX .ioc: ${p.hasIoc ? '✔ 已找到' : '✘ 未找到'}`,
        { tooltip: p.iocPath ?? '无 .ioc 文件' },
      ),
    );
    rows.push(
      this.row(
        `$(file-code) CMakeLists.txt: ${p.hasCMakeLists ? '✔ 已找到' : '✘ 未找到'}`,
        { tooltip: p.cmakeListsPath ?? '无法进行 CMake 配置' },
      ),
    );
    rows.push(
      this.row(
        `$(library) HAL/CMSIS: ${p.hasHalDriver ? 'HAL ✔' : 'HAL ✘'} / ${p.hasCmsis ? 'CMSIS ✔' : 'CMSIS ✘'}，` +
          `启动文件 ${p.startupFiles.length} 个，链接脚本 ${p.linkerScripts.length} 个`,
        { tooltip: '工程结构完整性' },
      ),
    );
    if (p.warnings.length > 0) {
      rows.push(
        this.row(`$(alert) 识别警告 (${p.warnings.length})（点击查看）`, {
          command: 'autoCmakeFlash.showWarnings',
          commandTitle: '查看识别警告',
          tooltip: p.warnings.join('\n'),
        }),
      );
    }
    return rows;
  }

  private envRows(s: WorkspaceState): TreeNode[] {
    const rows: TreeNode[] = [];
    const tc: ToolchainInfo | undefined = s.toolchain;
    if (!tc) {
      rows.push(
        this.row('$(circle-slash) 尚未检测环境（点击检测）', {
          command: 'autoCmakeFlash.detectEnvironment',
          tooltip: '检测 CMake/Ninja/ARM GCC/STM32CubeProgrammer CLI',
        }),
      );
      return rows;
    }
    const icon = (name: 'cmake' | 'ninja' | 'armGcc' | 'programmerCli') => {
      const t = tc.tools[name];
      const mark = t.found ? '$(check)' : '$(error)';
      const ver = t.version ? ` ${t.version}` : '';
      return `${mark} ${t.label.split(' (')[0]}:${ver}${t.found ? '' : ' 未找到'}`;
    };
    rows.push(
      this.row(icon('cmake'), {
        command: 'autoCmakeFlash.detectEnvironment',
        commandTitle: '重新检测',
        tooltip: toolTooltip(tc.tools.cmake),
      }),
    );
    rows.push(
      this.row(icon('ninja'), {
        command: 'autoCmakeFlash.detectEnvironment',
        commandTitle: '重新检测',
        tooltip: toolTooltip(tc.tools.ninja),
      }),
    );
    rows.push(
      this.row(icon('armGcc'), {
        command: 'autoCmakeFlash.detectEnvironment',
        commandTitle: '重新检测',
        tooltip: toolTooltip(tc.tools.armGcc),
      }),
    );
    rows.push(
      this.row(icon('programmerCli'), {
        command: 'autoCmakeFlash.detectEnvironment',
        commandTitle: '重新检测',
        tooltip: toolTooltip(tc.tools.programmerCli),
      }),
    );
    const st: StLinkInfo | undefined = s.stlink;
    const stText = !st
      ? '$(plug) ST-LINK: 未检测（点击检测）'
      : st.status === 'probeDetected'
        ? `$(plug) ST-LINK: 已检测到 ${st.probeCount} 个探头`
        : st.status === 'noProbe'
          ? '$(error) ST-LINK: 未检测到适配器（点击重试）'
          : st.status === 'cliMissing'
            ? '$(error) ST-LINK: CLI 未找到，无法检测'
            : '$(question) ST-LINK: 检测结果未知（点击重试）';
    rows.push(
      this.row(stText, {
        command: 'autoCmakeFlash.detectStLink',
        commandTitle: '检测 ST-LINK',
        tooltip: st?.error ?? (st?.probes.map((p) => `SN: ${p.serial ?? '?'}`).join('\n') || undefined),
      }),
    );
    if (tc.missing.length > 0) {
      rows.push(
        this.row(`$(lightbulb) 缺少 ${tc.missing.length} 个组件（点击查看解决方法）`, {
          command: 'autoCmakeFlash.showMissingTools',
          commandTitle: '查看解决方法',
          tooltip: tc.missing.join(', '),
        }),
      );
    }
    return rows;
  }

  private buildRows(s: WorkspaceState): TreeNode[] {
    const rows: TreeNode[] = [];
    const b = s.lastBuild;
    if (!b) {
      rows.push(
        this.row('$(circle-slash) 最近编译: 未执行', {
          command: 'autoCmakeFlash.build',
          tooltip: '点击编译工程',
        }),
      );
    } else if (b.success) {
      rows.push(
        this.row(`$(check) 最近编译: 成功（耗时 ${(b.durationMs / 1000).toFixed(1)}s）`, {
          command: 'autoCmakeFlash.showArtifacts',
          commandTitle: '查看产物',
          tooltip: `构建模式 ${b.buildType}，退出码 ${b.exitCode}`,
        }),
      );
    } else {
      rows.push(
        this.row(
          `$(error) 最近编译: 失败（退出码 ${b.exitCode ?? '?'}${b.cancelled ? '，已取消' : ''}）`,
          { command: 'autoCmakeFlash.showLogs', commandTitle: '查看日志', tooltip: '点击查看日志与问题面板' },
        ),
      );
    }
    const p = s.project;
    rows.push(
      this.row(`$(file-binary) 当前构建产物: ${p?.artifacts.length ?? 0} 个（点击查看）`, {
        command: 'autoCmakeFlash.showArtifacts',
        commandTitle: '查看构建产物',
        tooltip: 'ELF/HEX/BIN 文件列表',
      }),
    );
    rows.push(
      this.row('$(folder-opened) 打开构建目录', {
        command: 'autoCmakeFlash.openBuildDir',
        commandTitle: '打开构建目录',
      }),
    );
    rows.push(
      this.row('$(trash) 清理插件构建目录', {
        command: 'autoCmakeFlash.clean',
        commandTitle: '清理构建目录',
      }),
    );
    return rows;
  }

  private flashRows(s: WorkspaceState): TreeNode[] {
    const rows: TreeNode[] = [];
    const f: FlashOutcome | undefined = s.lastFlash;
    if (!f) {
      rows.push(this.row('$(circle-slash) 最近烧录: 未执行'));
    } else {
      const icon =
        f.status === 'success'
          ? '$(check)'
          : f.status === 'verify-unconfirmed'
            ? '$(question)'
            : '$(error)';
      rows.push(
        this.row(`${icon} 最近烧录: ${flashStatusText(f)}`, {
          command: 'autoCmakeFlash.showLogs',
          commandTitle: '查看日志',
          tooltip: f.messages.join('\n') || undefined,
        }),
      );
      rows.push(
        this.row(
          `$(shield) 下载: ${f.downloaded ? '成功' : '失败'} / 校验: ${verifyText(f.verify)}`,
          { command: 'autoCmakeFlash.showLogs', commandTitle: '查看日志' },
        ),
      );
    }
    rows.push(
      this.row('$(cloud-upload) 编译并烧录', {
        command: 'autoCmakeFlash.buildAndFlash',
        commandTitle: '编译并烧录',
      }),
    );
    rows.push(
      this.row('$(rocket) 烧录现有固件', {
        command: 'autoCmakeFlash.flashExisting',
        commandTitle: '烧录现有固件',
      }),
    );
    return rows;
  }
}

function confidenceLabel(c: Confidence): string {
  switch (c) {
    case 'high':
      return '高';
    case 'medium':
      return '中';
    case 'low':
      return '低';
    default:
      return '无法判断';
  }
}

function toolTooltip(t: { found: boolean; path?: string; version?: string; error?: string; searched: string[] }): string {
  if (t.found) {
    return `${t.path ?? ''}\n版本: ${t.version ?? '未知'}${t.error ? `\n注意: ${t.error}` : ''}`;
  }
  return `${t.error ?? '未找到'}\n搜索过的路径:\n${t.searched.join('\n') || '(无)'}`;
}

export function flashStatusText(f: FlashOutcome): string {
  switch (f.status) {
    case 'success':
      return '成功（下载与校验通过）';
    case 'reset-failed':
      return '下载校验通过，但复位失败';
    case 'verify-unconfirmed':
      return '下载完成，校验状态未确认';
    case 'verify-failed':
      return '校验失败';
    case 'download-failed':
      return '下载失败';
    case 'connect-failed':
      return '目标芯片无法连接';
    case 'no-probe':
      return '未检测到 ST-LINK';
    case 'blocked':
      return '前置条件不满足，已阻止';
    case 'cancelled':
      return '用户取消';
    default:
      return f.status;
  }
}

export function verifyText(v: FlashOutcome['verify']): string {
  switch (v) {
    case 'passed':
      return '通过';
    case 'failed':
      return '失败';
    case 'unconfirmed':
      return '未确认';
    case 'skipped':
      return '未执行';
    default:
      return v;
  }
}
