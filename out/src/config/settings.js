"use strict";
/**
 * 用户配置（VS Code Settings）读取与监听。
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
exports.loadSettings = loadSettings;
exports.onSettingsChange = onSettingsChange;
const vscode = __importStar(require("vscode"));
const SECTION = 'autoCmakeFlash';
function loadSettings() {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    const buildType = cfg.get('buildType', 'Debug');
    const validTypes = [
        'Debug',
        'Release',
        'RelWithDebInfo',
        'MinSizeRel',
    ];
    const iface = cfg.get('downloadInterface', 'SWD');
    const reset = cfg.get('resetAfterFlash', 'hardware');
    return {
        buildDir: cfg.get('buildDir', 'build-auto') || 'build-auto',
        buildType: validTypes.includes(buildType)
            ? buildType
            : 'Debug',
        generator: cfg.get('generator', 'Ninja') || 'Ninja',
        cmakePath: cfg.get('cmakePath', ''),
        ninjaPath: cfg.get('ninjaPath', ''),
        armToolchainPath: cfg.get('armToolchainPath', ''),
        programmerCliPath: cfg.get('programmerCliPath', ''),
        cmakeToolchainFile: cfg.get('cmakeToolchainFile', ''),
        cmakeExtraArgs: cfg.get('cmakeExtraArgs', ''),
        downloadInterface: iface === 'JTAG' ? 'JTAG' : 'SWD',
        downloadSpeedKhz: clampNumber(cfg.get('downloadSpeedKhz', 4000), 100, 24000, 4000),
        resetAfterFlash: reset === 'software' || reset === 'none' ? reset : 'hardware',
        binFlashAddress: cfg.get('binFlashAddress', ''),
        verboseLogging: cfg.get('verboseLogging', false),
        buildTimeoutSec: clampNumber(cfg.get('buildTimeoutSec', 600), 10, 7200, 600),
        flashTimeoutSec: clampNumber(cfg.get('flashTimeoutSec', 300), 10, 3600, 300),
    };
}
function clampNumber(v, min, max, dflt) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
        return dflt;
    }
    return Math.min(max, Math.max(min, Math.round(v)));
}
/** 监听设置变化（刷新 UI / 日志开关） */
function onSettingsChange(cb) {
    return vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(SECTION)) {
            cb();
        }
    });
}
//# sourceMappingURL=settings.js.map