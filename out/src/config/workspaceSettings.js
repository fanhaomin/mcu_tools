"use strict";
/**
 * 工程设置写入器：把 autoCmakeFlash.* 写入当前工程的 .vscode/settings.json。
 *
 * VS Code 对未在 contributes.configuration 声明的键拒绝 Configuration API 的
 * 文件夹级写入（"没有注册配置 ... 因此无法写入文件夹设置"），因此直接编辑
 * settings.json 文件（尽力保留注释：去注释解析后回写格式化 JSON）。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateWorkspaceSetting = updateWorkspaceSetting;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function updateWorkspaceSetting(key, value) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        // 无工作区：退回全局设置（用户级对未注册键可写）
        await vscode.workspace.getConfiguration('autoCmakeFlash').update(key, value, vscode.ConfigurationTarget.Global);
        return;
    }
    const file = path.join(folder.uri.fsPath, '.vscode', 'settings.json');
    let obj = {};
    try {
        const raw = fs.readFileSync(file, 'utf8');
        // 尽力剥离注释与尾逗号（容忍 JSONC）
        const stripped = raw
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1')
            .replace(/,(\s*[}\]])/g, '$1');
        obj = JSON.parse(stripped || '{}');
    }
    catch {
        // 文件不存在 → 从空对象开始；解析失败 → 退回全局写
        if (fs.existsSync(file)) {
            await vscode.workspace.getConfiguration('autoCmakeFlash').update(key, value, vscode.ConfigurationTarget.Global);
            return;
        }
    }
    if (value === undefined) {
        delete obj[key];
    }
    else {
        obj[key] = value;
    }
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
//# sourceMappingURL=workspaceSettings.js.map