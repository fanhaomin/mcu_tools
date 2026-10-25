"use strict";
/**
 * 状态栏：工程/目标选择 + 编译 / 烧录 快捷按钮（一键执行，无需打开插件面板）。
 * 不再有独立的状态摘要项——结果看按钮图标与输出通道。
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
exports.StatusBar = void 0;
const vscode = __importStar(require("vscode"));
class StatusBar {
    buildBtn;
    flashBtn;
    debugBtn;
    projectBtn;
    typeBtn;
    constructor() {
        // 状态栏左侧快捷按钮：编译 / 构建类型 / 烧录 / 调试（一键执行，无需打开插件面板）
        this.buildBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 64);
        this.buildBtn.name = 'Embedded Debug 编译';
        this.buildBtn.text = '$(zap) 编译';
        this.buildBtn.tooltip = '编译工程（Embedded Debug）';
        this.buildBtn.command = 'autoCmakeFlash.build';
        // 构建类型按钮（编译与烧录之间）：显示当前类型，点击选择 Debug/Release 等
        this.typeBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 63);
        this.typeBtn.name = 'Embedded Debug 构建类型';
        this.typeBtn.tooltip = '选择构建类型：不同类型使用独立构建目录（cmake-build-debug / cmake-build-release）';
        this.typeBtn.command = 'autoCmakeFlash.chooseBuildType';
        this.flashBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 62);
        this.flashBtn.name = 'Embedded Debug 烧录';
        this.flashBtn.text = '$(rocket) 烧录';
        this.flashBtn.tooltip = '编译并烧录到目标芯片（Embedded Debug）';
        this.flashBtn.command = 'autoCmakeFlash.buildAndFlash';
        // 调试按钮（烧录右侧）：编译并调试
        this.debugBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 61);
        this.debugBtn.name = 'Embedded Debug 调试';
        this.debugBtn.text = '$(debug-alt) 调试';
        this.debugBtn.tooltip = '编译并调试（Embedded Debug）';
        this.debugBtn.command = 'autoCmakeFlash.debug';
        // 工程/目标选择按钮（最左）：显示当前工程名与编译目标，点击打开选择下拉框
        this.projectBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 65);
        this.projectBtn.name = 'Embedded Debug 工程/目标';
        this.projectBtn.command = 'autoCmakeFlash.chooseProject';
        this.update({ busy: 'none' }, 'Debug');
    }
    update(state, buildType) {
        // 工程/目标选择按钮（最左）：工程名·目标名，busy 时显示转圈
        const projectName = state.project?.name ??
            (state.root
                ? state.root.split(/[\\/]/).filter((s) => s.length > 0).pop()
                : undefined);
        this.projectBtn.text =
            state.busy !== 'none'
                ? '$(sync~spin)'
                : `$(folder) ${projectName ?? '选择工程'}${state.target ? `·${state.target}` : ''}`;
        this.projectBtn.tooltip = '选择工程或编译目标（Embedded Debug）';
        this.projectBtn.show();
        // 快捷按钮状态与显示
        this.buildBtn.text =
            state.busy === 'build' ? '$(sync~spin) 编译中' : '$(zap) 编译';
        this.flashBtn.text =
            state.busy === 'flash' ? '$(sync~spin) 烧录中' : '$(rocket) 烧录';
        this.debugBtn.text =
            state.busy === 'debug' ? '$(sync~spin) 调试中' : '$(debug-alt) 调试';
        this.typeBtn.text = '$(split-vertical) ' + buildType;
        this.buildBtn.show();
        this.flashBtn.show();
        this.debugBtn.show();
        this.typeBtn.show();
    }
    dispose() {
        this.projectBtn.dispose();
        this.buildBtn.dispose();
        this.flashBtn.dispose();
        this.debugBtn.dispose();
        this.typeBtn.dispose();
    }
}
exports.StatusBar = StatusBar;
//# sourceMappingURL=statusBar.js.map