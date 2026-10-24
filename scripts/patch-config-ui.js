const fs = require('fs');
const f = 'src/extension.ts';
let s = fs.readFileSync(f, 'utf8');

// 1. 配置面板补上调试引擎与 probe-rs 芯片名两项
const anchor = "      { key: 'buildDir', label: '构建目录', kind: 'string', hint: '填 build 时自动按类型分 Debug/Release 子目录，也支持 ${buildType}' },";
if (!s.includes(anchor)) { console.log('ANCHOR MISS'); process.exit(1); }
s = s.replace(anchor, anchor + "\n      { key: 'debugEngine', label: '调试引擎', kind: 'enum', options: ['cortex-debug', 'probe-rs'], hint: 'probe-rs 支持运行中旁路直读寄存器' }," +
  "\n      { key: 'probeRsChip', label: 'probe-rs 芯片名', kind: 'string', hint: '如 STM32F103C8，留空按识别型号自动推导' },");

// 2. 注册「切换调试引擎」命令（放在 openSettings 注册之前）
const regAnchor = "  register('autoCmakeFlash.openSettings', async () => {";
if (!s.includes(regAnchor)) { console.log('REG ANCHOR MISS'); process.exit(1); }
const toggleCmd = `  register('autoCmakeFlash.toggleEngine', async () => {
    const cfg = vscode.workspace.getConfiguration('autoCmakeFlash');
    const cur = cfg.get<string>('debugEngine', 'cortex-debug');
    const next = cur === 'probe-rs' ? 'cortex-debug' : 'probe-rs';
    const folder = vscode.workspace.workspaceFolders?.[0];
    await cfg.update('debugEngine', next, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
    settings = loadSettings();
    void vscode.window.showInformationMessage(
      \`Auto CMake Flash: 调试引擎已切换为 \${next === 'probe-rs' ? 'probe-rs（旁路直读，零停机）' : 'cortex-debug（停机式）'}。下次调试生效。\`,
    );
    refresh();
  });

`;
s = s.replace(regAnchor, toggleCmd + regAnchor);

fs.writeFileSync(f, s);
console.log('extension.ts patched');
