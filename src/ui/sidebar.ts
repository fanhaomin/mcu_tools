/**
 * 侧边栏 TreeView：工程 / 开发环境 / 构建 / 烧录 / 调试 五个分区。
 * 图标统一用 ThemeIcon（label 内不出现 $(codicon) 文字），行文案精简，详细数据放 tooltip。
 */

import * as vscode from 'vscode';
import {
  StLinkInfo,
  ToolName,
  ToolchainInfo,
  WorkspaceState,
  Confidence,
  FlashOutcome,
} from '../types';

interface TreeNode extends vscode.TreeItem {}

interface RowOpts {
  icon?: string;
  command?: string;
  commandTitle?: string;
  tooltip?: string;
  contextValue?: string;
}

const TOOL_SHORT: Record<ToolName, string> = {
  cmake: 'CMake',
  ninja: 'Ninja',
  armGcc: 'GCC',
  armGpp: 'G++',
  objcopy: 'ObjCopy',
  size: 'Size',
  programmerCli: 'CubeProg',
  armGdb: 'GDB',
  stlinkGdbServer: 'GDBServer',
};
const CORE_TOOLS: ToolName[] = ['cmake', 'ninja', 'armGcc', 'programmerCli'];
/** 调试组件（可选，缺失不影响编译/烧录） */
const DEBUG_TOOLS: ToolName[] = ['armGdb', 'stlinkGdbServer'];

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
        this.section('工程', 'section-project', 'library'),
        this.section('开发环境', 'section-env', 'tools'),
        this.section('构建', 'section-build', 'build'),
        this.section('烧录', 'section-flash', 'cloud-upload'),
        this.section('调试', 'section-debug', 'bug'),
        this.section('配置', 'section-config', 'gear'),
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
      case 'section-debug':
        return this.debugRows(s);
      case 'section-config':
        return this.configRows(s);
      default:
        return [];
    }
  }

  private section(label: string, contextValue: string, icon: string): TreeNode {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
    item.contextValue = contextValue;
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }

  private row(label: string, opts: RowOpts = {}): TreeNode {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    if (opts.icon) {
      item.iconPath = new vscode.ThemeIcon(opts.icon);
    }
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
        this.row('未扫描工程（点击扫描）', {
          icon: 'search',
          command: 'autoCmakeFlash.scanProject',
          commandTitle: '扫描工程',
          tooltip: '扫描当前工作区，识别 STM32 工程结构',
        }),
      );
      return rows;
    }
    const conf = `${confidenceLabel(p.mcu.confidence)}${p.mcu.confirmedByUser ? '（用户确认）' : ''}`;
    const tipParts = [`工程路径: ${p.root}`, `可信度: ${conf}`];
    if (p.mcu.evidence.length > 0) {
      tipParts.push('识别证据:', ...p.mcu.evidence.map((e) => `${e.source}: ${e.detail}`));
    }
    rows.push(
      this.row(`${p.name} — ${p.mcu.model || '型号待确认'}`, {
        icon: 'folder-active',
        command: 'autoCmakeFlash.scanProject',
        commandTitle: '重新扫描',
        tooltip: tipParts.join('\n'),
      }),
    );
    const marks = [
      `CMakeLists ${p.hasCMakeLists ? '✔' : '✘'}`,
      `.ioc ${p.hasIoc ? '✔' : '✘'}`,
      `HAL ${p.hasHalDriver ? '✔' : '✘'}`,
    ];
    const missing: string[] = [];
    if (!p.hasCMakeLists) {
      missing.push('CMakeLists.txt');
    }
    if (!p.hasIoc) {
      missing.push('.ioc');
    }
    if (!p.hasHalDriver) {
      missing.push('HAL');
    }
    const ok = missing.length === 0;
    const fileTip = [
      p.cmakeListsPath ? `CMakeLists.txt: ${p.cmakeListsPath}` : 'CMakeLists.txt: 未找到',
      p.iocPath ? `.ioc: ${p.iocPath}` : '.ioc: 未找到',
      `CMSIS ${p.hasCmsis ? '✔' : '✘'}，启动文件 ${p.startupFiles.length} 个，链接脚本 ${p.linkerScripts.length} 个`,
    ].join('\n');
    rows.push(
      this.row(
        ok
          ? `工程文件: 就绪（${marks.join(' ')}）`
          : `工程文件: 缺 ${missing.join('、')}（${marks.join(' ')}）`,
        {
          icon: ok ? 'check' : 'warning',
          tooltip: fileTip,
        },
      ),
    );
    if (p.hasIoc) {
      rows.push(
        this.row('在 STM32CubeMX 中打开 .ioc', {
          icon: 'file-text',
          command: 'autoCmakeFlash.openIoc',
          commandTitle: '打开 .ioc',
          tooltip: p.iocPath ?? undefined,
        }),
      );
    }
    if (p.warnings.length > 0) {
      rows.push(
        this.row(`识别警告（${p.warnings.length}）`, {
          icon: 'warning',
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
        this.row('工具链: 未检测', {
          icon: 'tools',
          command: 'autoCmakeFlash.detectEnvironment',
          commandTitle: '检测开发环境',
          tooltip: '检测 CMake/Ninja/ARM GCC/STM32CubeProgrammer CLI 与调试组件',
        }),
      );
      return rows;
    }
    if (tc.complete) {
      rows.push(
        this.row('工具链: 就绪（CMake/Ninja/GCC/CubeProg）', {
          icon: 'check',
          command: 'autoCmakeFlash.detectEnvironment',
          commandTitle: '重新检测',
          tooltip: CORE_TOOLS.map((n) => toolTooltip(tc.tools[n], TOOL_SHORT[n])).join('\n\n'),
        }),
      );
    } else {
      rows.push(
        this.row(`工具链: 缺 ${tc.missing.map((n) => TOOL_SHORT[n] ?? n).join('/')}`, {
          icon: 'warning',
          command: 'autoCmakeFlash.showMissingTools',
          commandTitle: '查看解决方法',
          tooltip: CORE_TOOLS.map((n) => toolTooltip(tc.tools[n], TOOL_SHORT[n])).join('\n\n'),
        }),
      );
    }
    // 调试组件（可选，缺失不影响编译/烧录）
    const dbgMissing = DEBUG_TOOLS.filter((n) => !tc.tools[n].found);
    rows.push(
      this.row(
        dbgMissing.length === 0
          ? '调试组件: 就绪（GDB/GDBServer）'
          : `调试组件: 缺 ${dbgMissing.map((n) => TOOL_SHORT[n]).join('/')}（仅影响调试）`,
        {
          icon: dbgMissing.length === 0 ? 'check' : 'info',
          command: 'autoCmakeFlash.detectEnvironment',
          commandTitle: '重新检测',
          tooltip: DEBUG_TOOLS.map((n) => toolTooltip(tc.tools[n], TOOL_SHORT[n])).join('\n\n'),
        },
      ),
    );
    const st: StLinkInfo | undefined = s.stlink;
    if (!st) {
      rows.push(
        this.row('ST-LINK: 未检测', {
          icon: 'plug',
          command: 'autoCmakeFlash.detectStLink',
          commandTitle: '检测 ST-LINK',
        }),
      );
    } else if (st.status === 'probeDetected') {
      rows.push(
        this.row(`ST-LINK: 已检测到 ${st.probeCount} 个探头`, {
          icon: 'plug',
          command: 'autoCmakeFlash.detectStLink',
          commandTitle: '检测 ST-LINK',
          tooltip: st.probes.map((p) => `SN: ${p.serial ?? '?'}`).join('\n') || undefined,
        }),
      );
    } else {
      const text =
        st.status === 'noProbe'
          ? 'ST-LINK: 未检测到适配器'
          : st.status === 'cliMissing'
            ? 'ST-LINK: CLI 未找到，无法检测'
            : 'ST-LINK: 检测结果未知';
      rows.push(
        this.row(text, {
          icon: 'warning',
          command: 'autoCmakeFlash.detectStLink',
          commandTitle: '重试检测',
          tooltip: st.error ?? undefined,
        }),
      );
    }
    return rows;
  }

  private buildRows(s: WorkspaceState): TreeNode[] {
    const rows: TreeNode[] = [];
    rows.push(
      this.row(`编译${s.target ? `目标 ${s.target}` : ''}`, {
        icon: 'play',
        command: 'autoCmakeFlash.build',
        commandTitle: '编译',
        tooltip: s.target ? '编译当前选中目标' : '编译全部（可在状态栏选择目标）',
      }),
    );
    const b = s.lastBuild;
    if (b?.success) {
      rows.push(
        this.row(`最近编译: 成功 (${(b.durationMs / 1000).toFixed(1)}s)`, {
          icon: 'check',
          command: 'autoCmakeFlash.showArtifacts',
          commandTitle: '查看产物',
          tooltip: `构建模式 ${b.buildType}，退出码 ${b.exitCode}`,
        }),
      );
    } else if (b) {
      rows.push(
        this.row(`最近编译: 失败（退出码 ${b.exitCode ?? '?'}${b.cancelled ? '，已取消' : ''}）`, {
          icon: 'warning',
          command: 'autoCmakeFlash.showLogs',
          commandTitle: '查看日志',
          tooltip: '点击查看日志与问题面板',
        }),
      );
    }
    const count = s.project?.artifacts.length ?? 0;
    rows.push(
      this.row(`构建产物: ${count} 个`, {
        icon: 'file-binary',
        command: 'autoCmakeFlash.showArtifacts',
        commandTitle: '查看构建产物',
        tooltip: 'ELF/HEX/BIN 文件列表',
      }),
    );
    rows.push(
      this.row('打开构建目录', {
        icon: 'folder-opened',
        command: 'autoCmakeFlash.openBuildDir',
        commandTitle: '打开构建目录',
      }),
    );
    rows.push(
      this.row('清理构建目录', {
        icon: 'trash',
        command: 'autoCmakeFlash.clean',
        commandTitle: '清理构建目录',
      }),
    );
    return rows;
  }

  private flashRows(s: WorkspaceState): TreeNode[] {
    const rows: TreeNode[] = [];
    const f: FlashOutcome | undefined = s.lastFlash;
    if (f) {
      const ok = f.status === 'success';
      const tipParts = [`下载: ${f.downloaded ? '成功' : '失败'} / 校验: ${verifyText(f.verify)}`];
      if (f.messages.length > 0) {
        tipParts.push(...f.messages);
      }
      rows.push(
        this.row(`最近烧录: ${ok ? '成功' : flashStatusText(f)}`, {
          icon: ok ? 'check' : 'warning',
          command: 'autoCmakeFlash.showLogs',
          commandTitle: '查看日志',
          tooltip: tipParts.join('\n'),
        }),
      );
    }
    rows.push(
      this.row('编译并烧录', {
        icon: 'cloud-upload',
        command: 'autoCmakeFlash.buildAndFlash',
        commandTitle: '编译并烧录',
      }),
    );
    rows.push(
      this.row('烧录现有固件', {
        icon: 'rocket',
        command: 'autoCmakeFlash.flashExisting',
        commandTitle: '烧录现有固件',
      }),
    );
    return rows;
  }

  private debugRows(_s: WorkspaceState): TreeNode[] {
    return [
      this.row('编译并调试', {
        icon: 'debug-alt',
        command: 'autoCmakeFlash.debug',
        commandTitle: '编译并调试',
        tooltip:
          '编译成功后启动 ST-LINK 调试会话，固件经调试器写入芯片并运行到 main 断点。',
      }),
      this.row('附加到运行中的目标', {
        icon: 'debug-disconnect',
        command: 'autoCmakeFlash.debugAttach',
        commandTitle: '附加调试',
        tooltip: '不重新编译、不写固件，直接连接正在运行的目标芯片调试。',
      }),
      this.row('刷新间隔设置（点击修改）', {
        icon: 'clock',
        command: 'autoCmakeFlash.chooseRefreshInterval',
        commandTitle: '刷新间隔',
        tooltip: '外设寄存器 / 变量监控 / 内存视图三个面板共用的实时刷新间隔（50ms-1s）。',
      }),
    ];
  }

  private configRows(_s: WorkspaceState): TreeNode[] {
    return [
      this.row('打开配置面板', {
        icon: 'settings-gear',
        command: 'autoCmakeFlash.openSettings',
        commandTitle: '打开配置面板',
        tooltip:
          '在交互界面中设置：构建目录/类型/生成器、烧录接口与复位、调试引擎与 GDB 路径、超时等。保存到当前工程的工作区设置。',
      }),
      this.row('切换调试引擎', {
        icon: 'server',
        command: 'autoCmakeFlash.toggleEngine',
        commandTitle: '切换调试引擎',
        tooltip: '在 cortex-debug（停机式）与 probe-rs（旁路直读）之间切换，立即生效。',
      }),
    ];
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

function toolTooltip(
  t: { found: boolean; path?: string; version?: string; error?: string },
  short: string,
): string {
  if (t.found) {
    return `${short}: ${t.version ?? '版本未知'}\n${t.path ?? ''}${t.error ? `\n注意: ${t.error}` : ''}`;
  }
  return `${short}: 未找到 — ${t.error ?? '原因未知'}`;
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
