"use strict";
/**
 * ST-LINK 孤儿进程清理。
 *
 * VS Code 异常退出/被强杀/扩展宿主崩溃时，调试引擎的子进程（ST-LINK GDB Server、
 * OpenOCD）可能残留：它们仍以独占方式握着 ST-LINK，之后烧录/调试报「端口被占用/
 * 无法连接目标」，只能手动杀进程或重插探头。
 *
 * 在「即将占用 ST-LINK」的时机清理：启动调试前、烧录预检前、调试会话结束后
 * （延迟等引擎先收自己的子进程）。仅在无活跃调试会话时执行，避免误杀正在
 * 运行的调试服务；非 Windows 平台无对应进程名，跳过。
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
exports.killOrphanProbeHolders = killOrphanProbeHolders;
const vscode = __importStar(require("vscode"));
const process_1 = require("../util/process");
/** 可能独占 ST-LINK 的调试服务进程（Windows） */
const HOLDERS = ['ST-LINK_gdbserver.exe', 'openocd.exe'];
async function killOrphanProbeHolders(reason, log) {
    if (process.platform !== 'win32' || vscode.debug.activeDebugSession) {
        return;
    }
    for (const name of HOLDERS) {
        try {
            const r = await (0, process_1.execFileSafe)('taskkill.exe', ['/F', '/IM', name], { timeoutMs: 8000 });
            // 退出码 0 = 确有进程被杀；128 = 进程不存在（正常情况，不刷屏）
            if (r.exitCode === 0) {
                log(`已清理残留的 ${name}（${reason}；上次调试异常退出遗留，此前一直占用 ST-LINK）`);
            }
        }
        catch {
            // taskkill 不可用等情形，忽略
        }
    }
}
//# sourceMappingURL=probeCleanup.js.map