"use strict";
/**
 * 工程设置写入器：把 autoCmakeFlash.* 写入当前工程的 .vscode/settings.json。
 *
 * 所有键已在 package.json contributes.configuration 注册（scope: resource），
 * 走 VS Code Configuration API 正规写入——值传 undefined 即移除自定义项（恢复默认）。
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
exports.cleanupLegacyDeadKeys = cleanupLegacyDeadKeys;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** 旧版写入 bug 可能落进 settings.json 顶层的无前缀死键（与配置项同名） */
const LEGACY_DEAD_KEYS = new Set([
    'buildDir', 'buildType', 'generator', 'cmakeToolchainFile', 'cmakeExtraArgs',
    'downloadInterface', 'downloadSpeedKhz', 'resetAfterFlash', 'binFlashAddress',
    'debugEngine', 'probeRsChip', 'gdbPath', 'gdbServerPath', 'svdFile',
    'cmakePath', 'ninjaPath', 'armToolchainPath', 'programmerCliPath', 'cubemxPath',
    'verboseLogging', 'buildTimeoutSec', 'flashTimeoutSec', 'debugRefreshMs',
]);
async function updateWorkspaceSetting(key, value) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
        // 文件夹级写入：scopeUri 在 getConfiguration 上指定（update 本身无此参数）
        await vscode.workspace
            .getConfiguration('autoCmakeFlash', folder.uri)
            .update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
    }
    else {
        await vscode.workspace
            .getConfiguration('autoCmakeFlash')
            .update(key, value, vscode.ConfigurationTarget.Workspace);
    }
}
/**
 * 一次性清理：删除 settings.json 顶层的旧无前缀死键（0.9.39 前的写入 bug 遗留）。
 * 返回被删除的键名（空数组 = 无需清理/文件不可解析）。
 */
async function cleanupLegacyDeadKeys() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return [];
    }
    const file = path.join(folder.uri.fsPath, '.vscode', 'settings.json');
    let raw = '';
    try {
        raw = fs.readFileSync(file, 'utf8');
    }
    catch {
        return [];
    }
    let obj;
    try {
        const stripped = raw
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1')
            .replace(/,(\s*[}\]])/g, '$1');
        obj = JSON.parse(stripped || '{}');
    }
    catch {
        return [];
    }
    const removed = [];
    for (const k of Object.keys(obj)) {
        if (LEGACY_DEAD_KEYS.has(k)) {
            delete obj[k];
            removed.push(k);
        }
    }
    if (removed.length === 0) {
        return [];
    }
    await fs.promises.writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    return removed;
}
//# sourceMappingURL=workspaceSettings.js.map