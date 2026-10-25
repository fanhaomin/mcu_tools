"use strict";
/**
 * 确认窗口与用户交互（模态确认/型号选择/BIN 地址输入）。
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
exports.confirmFlashDialog = confirmFlashDialog;
exports.chooseMcuDialog = chooseMcuDialog;
exports.inputBinAddressDialog = inputBinAddressDialog;
exports.confirmReuseBuildDirDialog = confirmReuseBuildDirDialog;
exports.confirmCleanDialog = confirmCleanDialog;
const vscode = __importStar(require("vscode"));
const artifacts_1 = require("../cmake/artifacts");
/**
 * 烧录确认窗口（模态）。
 * 展示：工程路径 / MCU 型号 / 烧录器与探头状态 / 目标连接状态 /
 * 烧录文件完整路径 / 文件格式 / BIN 地址 / 即将执行的操作。
 */
async function confirmFlashDialog(info) {
    // 烧录前确认弹窗已按需求移除，直接执行烧录。
    // BIN 格式仍会经由 inputBinAddressDialog 要求输入烧录地址（必要安全检查）。
    return true;
}
/**
 * 手动选择芯片型号：列出识别过程中的候选 + 手动输入。
 * 返回用户选择的型号字符串（如 STM32G431RBTx 或 STM32G431xx）。
 */
async function chooseMcuDialog(candidates, family) {
    const items = candidates.map((c) => ({
        label: c,
        description: '来自工程识别证据',
    }));
    if (family) {
        items.push({
            label: `${family}xx`,
            description: '按家族推测的宏形式',
        });
    }
    items.push({
        label: '$(edit) 手动输入型号...',
        description: '例如 STM32G431RBTx 或 STM32G431xx',
    });
    const pick = await vscode.window.showQuickPick(items, {
        title: 'Embedded Debug — 选择芯片型号',
        placeHolder: '当前证据不足以自动确定芯片型号，请选择或输入',
        ignoreFocusOut: true,
    });
    if (!pick) {
        return undefined;
    }
    if (!pick.label.startsWith('$(edit)')) {
        return pick.label;
    }
    return vscode.window.showInputBox({
        title: '输入芯片型号',
        prompt: '完整型号（STM32G431RBTx）或宏形式（STM32G431xx）',
        ignoreFocusOut: true,
        validateInput: (v) => {
            if (!/^STM32[A-Z0-9]{4,20}$/i.test(v.trim())) {
                return '格式应为 STM32 开头的型号，如 STM32G431xx';
            }
            return undefined;
        },
    });
}
/** BIN 烧录地址输入框（带校验） */
async function inputBinAddressDialog(current) {
    return vscode.window.showInputBox({
        title: 'BIN 文件烧录地址',
        prompt: 'BIN 文件不含地址信息，必须确认烧录地址（如 0x08000000）',
        value: current,
        ignoreFocusOut: true,
        validateInput: (v) => {
            if (!(0, artifacts_1.isValidHexAddress)(v)) {
                return '请输入合法的十六进制地址，如 0x08000000';
            }
            return undefined;
        },
    });
}
/** 构建目录复用确认（目录非空且非插件创建时） */
async function confirmReuseBuildDirDialog(dir) {
    const choice = await vscode.window.showWarningMessage('Embedded Debug — 使用已存在的构建目录？', {
        modal: true,
        detail: `目录 ${dir} 已存在且不是 Embedded Debug 创建的。\n` +
            '插件不会删除其中内容，但会在其中执行 CMake 配置。\n建议：如这是其他工具的构建目录，请改用独立目录（设置 autoCmakeFlash.buildDir）。',
    }, { title: '使用该目录', value: 'ok' });
    return choice?.value === 'ok';
}
/** 清理非插件创建的构建目录前确认 */
async function confirmCleanDialog(dir, isOurs) {
    const choice = await vscode.window.showWarningMessage(`确认删除构建目录？`, {
        modal: true,
        detail: isOurs
            ? `目录 ${dir} 由 Embedded Debug 创建，删除后需要重新配置与编译。`
            : `目录 ${dir} 不是 Embedded Debug 创建的（没有插件标记文件）。删除后无法恢复，请确认其中没有需要保留的内容。`,
    }, { title: '删除', value: 'ok' });
    return choice?.value === 'ok';
}
//# sourceMappingURL=confirmation.js.map