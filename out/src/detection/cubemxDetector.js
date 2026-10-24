"use strict";
/**
 * STM32CubeMX 探测（纯函数，不依赖 vscode）。
 *
 * 用于「在 STM32CubeMX 中打开 .ioc」：定位 STM32CubeMX.exe。
 * 搜索顺序：用户设置 → 标准安装目录 → C:\ST 下的版本化目录（取最新版本）。
 * 注意 STM32CubeCLT 不包含 CubeMX（纯 CLI 工具集），CubeMX 是单独安装的 GUI。
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
exports.findCubeMx = findCubeMx;
const path = __importStar(require("path"));
const EXE = 'STM32CubeMX.exe';
/** 从目录名提取版本号（STM32CubeMX_6.12.1 → 6.12.1），无版本返回 0 */
function versionOf(name) {
    const m = /STM32CubeMX[_-]?(\d+)\.(\d+)(?:\.(\d+))?/i.exec(name);
    if (!m) {
        return 0;
    }
    return parseInt(m[1], 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[3] ?? '0', 10);
}
async function findCubeMx(env, override, platform = process.platform) {
    const candidates = [];
    const push = (p) => {
        if (p && p.trim() && !candidates.includes(p.trim())) {
            candidates.push(p.trim());
        }
    };
    push(override);
    if (platform === 'win32') {
        push(`C:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeMX\\${EXE}`);
        push(`C:\\Program Files (x86)\\STMicroelectronics\\STM32Cube\\STM32CubeMX\\${EXE}`);
        // CubeMX 6.x 新版安装器的默认位置：当前用户的 Programs 目录
        push(path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'STM32CubeMX', EXE));
        // 版本化安装目录（C:\ST\STM32CubeMX_6.12.1\...）：按版本号从新到旧
        const versioned = [];
        for (const parent of ['C:\\ST', 'C:\\Program Files\\STMicroelectronics\\STM32Cube']) {
            for (const name of await env.listDirs(parent)) {
                if (/^STM32CubeMX/i.test(name)) {
                    versioned.push({ dir: path.join(parent, name), v: versionOf(name) });
                }
            }
        }
        versioned.sort((a, b) => b.v - a.v);
        for (const d of versioned) {
            push(path.join(d.dir, EXE));
        }
    }
    else {
        push('/usr/local/STMicroelectronics/STM32CubeMX/STM32CubeMX');
    }
    for (const c of candidates) {
        if (await env.exists(c)) {
            return c;
        }
    }
    return undefined;
}
//# sourceMappingURL=cubemxDetector.js.map