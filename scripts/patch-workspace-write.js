const fs = require('fs');
let n = 0;
function patch(f, pairs) {
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) { console.log('MISS in ' + f + ':', JSON.stringify(a.slice(0, 70))); process.exit(1); }
    s = s.replace(a, b, 1); n++;
  }
  fs.writeFileSync(f, s);
}

// 1. extension.ts：导入 + 替换 toggleEngine / chooseRefreshInterval 的写入
patch('src/extension.ts', [
  ["import { ConfigPanel } from './ui/configPanel';",
   "import { ConfigPanel } from './ui/configPanel';\nimport { updateWorkspaceSetting } from './config/workspaceSettings';"],
  ["    const cfg = vscode.workspace.getConfiguration('autoCmakeFlash');\n    const cur = cfg.get<string>('debugEngine', 'cortex-debug');\n    const next = cur === 'probe-rs' ? 'cortex-debug' : 'probe-rs';\n    const folder = vscode.workspace.workspaceFolders?.[0];\n    await cfg.update('debugEngine', next, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);",
   "    const cur = vscode.workspace.getConfiguration('autoCmakeFlash').get<string>('debugEngine', 'cortex-debug');\n    const next = cur === 'probe-rs' ? 'cortex-debug' : 'probe-rs';\n    await updateWorkspaceSetting('debugEngine', next);"],
  ["    const cfg = vscode.workspace.getConfiguration('autoCmakeFlash');\n    const folder = vscode.workspace.workspaceFolders?.[0];\n    await cfg.update('debugRefreshMs', ms, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);",
   "    await updateWorkspaceSetting('debugRefreshMs', ms);"],
]);

// 2. configPanel.ts：保存循环改用写入器
patch('src/ui/configPanel.ts', [
  ["    const cfg = vscode.workspace.getConfiguration('autoCmakeFlash');\n    const defs = this.fieldDefs().flatMap((g) => g.fields);\n    const cur = loadSettingsSafe();\n    const folder = vscode.workspace.workspaceFolders?.[0];\n    const target = folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global;",
   "    const defs = this.fieldDefs().flatMap((g) => g.fields);\n    const cur = loadSettingsSafe();"],
  ["      try {\n        await cfg.update(def.key, value, target);\n        changed++;",
   "      try {\n        await updateWorkspaceSetting(def.key, value);\n        changed++;"],
  ["import * as vscode from 'vscode';\nimport { SvdDevice, SvdPeripheral } from '../svd/svdParser';",
   "import * as vscode from 'vscode';\nimport { SvdDevice, SvdPeripheral } from '../svd/svdParser';\nimport { updateWorkspaceSetting } from '../config/workspaceSettings';"],
]);

console.log('applied', n);
