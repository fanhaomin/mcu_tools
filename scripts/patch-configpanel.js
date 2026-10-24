const fs = require('fs');
const f = 'src/extension.ts';
let s = fs.readFileSync(f, 'utf8');
let n = 0;

// 1. 导入 ConfigPanel
const impAnchor = "import { IocLauncherEditorProvider } from './ui/iocLauncherEditor';";
if (!s.includes(impAnchor)) { console.log('IMP MISS'); process.exit(1); }
s = s.replace(impAnchor, impAnchor + "\nimport { ConfigPanel } from './ui/configPanel';");
n++;

// 2. 实例化（放在 treeView/statusBar 创建之后、periph 之前——用 pickRoot 前的位置不合适，
//    放在 logger 定义之后即可；这里挂在 settings/onSettingsChange 之后）
const instAnchor = "  // ---------------- 基础工具 ----------------";
if (!s.includes(instAnchor)) { console.log('INST MISS'); process.exit(1); }
s = s.replace(instAnchor, "  const configPanel = new ConfigPanel(log);\n\n" + instAnchor);
n++;

// 3. 替换整个旧 QuickPick 对话框 register 块为 configPanel.show()
const start = s.indexOf("  register('autoCmakeFlash.openSettings', async () => {");
const endMarker = "  register('autoCmakeFlash.showWarnings', async () => {";
const start2 = s.indexOf(endMarker);
if (start < 0 || start2 < 0 || start2 <= start) { console.log('BLOCK MISS', start, start2); process.exit(1); }
s = s.slice(0, start) + "  register('autoCmakeFlash.openSettings', () => {\n    configPanel.show();\n  });\n\n" + s.slice(start2);
n++;

fs.writeFileSync(f, s);
console.log('applied', n);
