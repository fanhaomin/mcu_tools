const fs = require('fs');
let n = 0;
function patch(f, pairs) {
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) { console.log('MISS in ' + f + ':', JSON.stringify(a.slice(0, 70)));process.exit(1); }
    s = s.replace(a, b); n++;
  }
  fs.writeFileSync(f, s);
}

// 1. statusBar.ts：新增 typeBtn（构建类型），并重排优先级
patch('src/ui/statusBar.ts', [
  ["export class StatusBar {\n  private readonly buildBtn: vscode.StatusBarItem;\n  private readonly flashBtn: vscode.StatusBarItem;\n  private readonly debugBtn: vscode.StatusBarItem;\n  private readonly projectBtn: vscode.StatusBarItem;",
   "export class StatusBar {\n  private readonly buildBtn: vscode.StatusBarItem;\n  private readonly flashBtn: vscode.StatusBarItem;\n  private readonly debugBtn: vscode.StatusBarItem;\n  private readonly projectBtn: vscode.StatusBarItem;\n  private readonly typeBtn: vscode.StatusBarItem;"],
  ["    // 状态栏左侧快捷按钮：编译 / 烧录 / 调试（一键执行，无需打开插件面板）\n    this.buildBtn = vscode.window.createStatusBarItem(\n      vscode.StatusBarAlignment.Left,\n      62,\n    );",
   "    // 状态栏左侧快捷按钮：编译 / 构建类型 / 烧录 / 调试（一键执行，无需打开插件面板）\n    this.buildBtn = vscode.window.createStatusBarItem(\n      vscode.StatusBarAlignment.Left,\n      64,\n    );"],
  ["    this.flashBtn = vscode.window.createStatusBarItem(\n      vscode.StatusBarAlignment.Left,\n      61,\n    );",
   "    // 构建类型按钮（编译与烧录之间）：显示当前类型，点击选择 Debug/Release 等\n    this.typeBtn = vscode.window.createStatusBarItem(\n      vscode.StatusBarAlignment.Left,\n      63,\n    );\n    this.typeBtn.name = 'Auto CMake Flash 构建类型';\n    this.typeBtn.tooltip = '选择构建类型：不同类型使用独立构建目录（cmake-build-debug / cmake-build-release）';\n    this.typeBtn.command = 'autoCmakeFlash.chooseBuildType';\n    this.flashBtn = vscode.window.createStatusBarItem(\n      vscode.StatusBarAlignment.Left,\n      62,\n    );"],
  ["    this.debugBtn = vscode.window.createStatusBarItem(\n      vscode.StatusBarAlignment.Left,\n      60,\n    );",
   "    this.debugBtn = vscode.window.createStatusBarItem(\n      vscode.StatusBarAlignment.Left,\n      61,\n    );"],
  ["    this.projectBtn = vscode.window.createStatusBarItem(\n      vscode.StatusBarAlignment.Left,\n      63,\n    );",
   "    this.projectBtn = vscode.window.createStatusBarItem(\n      vscode.StatusBarAlignment.Left,\n      65,\n    );"],
  ["  update(state: WorkspaceState): void {",
   "  update(state: WorkspaceState, buildType: string): void {"],
  ["    this.debugBtn.text =\n      state.busy === 'debug' ? '$(sync~spin) 调试中' : '$(debug-alt) 调试';\n    this.buildBtn.show();\n    this.flashBtn.show();\n    this.debugBtn.show();",
   "    this.debugBtn.text =\n      state.busy === 'debug' ? '$(sync~spin) 调试中' : '$(debug-alt) 调试';\n    this.typeBtn.text = '$(split-vertical) ' + buildType;\n    this.buildBtn.show();\n    this.flashBtn.show();\n    this.debugBtn.show();\n    this.typeBtn.show();"],
  ["  dispose(): void {\n    this.projectBtn.dispose();\n    this.buildBtn.dispose();\n    this.flashBtn.dispose();\n    this.debugBtn.dispose();",
   "  dispose(): void {\n    this.projectBtn.dispose();\n    this.buildBtn.dispose();\n    this.flashBtn.dispose();\n    this.debugBtn.dispose();\n    this.typeBtn.dispose();"],
]);

// 2. extension.ts：refresh 传 buildType；注册 chooseBuildType 命令
patch('src/extension.ts', [
  ["  const refresh = (): void => {\n    sidebar.refresh();\n    status.update(state);\n  };",
   "  const refresh = (): void => {\n    sidebar.refresh();\n    status.update(state, settings.buildType);\n  };"],
]);

// toggleEngine 注册前面插入 chooseBuildType
patch('src/extension.ts', [
  ["  register('autoCmakeFlash.toggleEngine', async () => {",
   "  register('autoCmakeFlash.chooseBuildType', async () => {\n    const options = ['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel'] as const;\n    const pick = await vscode.window.showQuickPick(\n      options.map((o) => ({\n        label: o === settings.buildType ? '$(check) ' + o : o,\n        description:\n          o === 'Debug' ? '调试信息完整，调试用（cmake-build-debug）' :\n          o === 'Release' ? '无调试信息，体积最小（cmake-build-release）' :\n          o === 'RelWithDebInfo' ? '优化 + 调试信息（cmake-build-relwithdebinfo）' :\n          '最小体积（cmake-build-minsizerel）',\n      })),\n      { title: 'Auto CMake Flash — 选择构建类型', ignoreFocusOut: true },\n    );\n    if (!pick || pick.label === '$(check) ' + pick.label) {\n      return;\n    }\n    const cfg = vscode.workspace.getConfiguration('autoCmakeFlash');\n    const folder = vscode.workspace.workspaceFolders?.[0];\n    await cfg.update('buildType', pick.label, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);\n    settings = loadSettings();\n    log('构建类型已切换为 ' + pick.label + '；构建目录随类型自动切换');\n    refresh();\n  });\n\n  register('autoCmakeFlash.toggleEngine', async () => {"],
]);

console.log('all patched, total', n);
