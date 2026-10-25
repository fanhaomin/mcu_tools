"use strict";
/**
 * webview 背景图：按设置读取图片，生成注入各面板 <style> 的 CSS。
 * 图片转 base64 data-URI（webview 本地资源需 localResourceRoots 白名单，
 * base64 一次读取缓存，最省事且随 html 走）；路径为空/文件不存在 → 空串。
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
exports.loadBgSettings = loadBgSettings;
exports.webviewBackgroundCss = webviewBackgroundCss;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function loadBgSettings(cfg) {
    return {
        imagePath: cfg.get('backgroundImage', ''),
        opacity: Math.min(1, Math.max(0.05, cfg.get('backgroundOpacity', 0.18))),
        blur: Math.min(30, Math.max(0, cfg.get('backgroundBlur', 0))),
        scale: cfg.get('backgroundScale', 'cover') === 'center' ? 'center' : 'cover',
    };
}
const mimeByExt = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
};
/** data-URI 缓存（路径+mtime → data）：多面板共享，图片不重复读盘/编码 */
const dataCache = new Map();
function imageDataUri(abs) {
    let mtimeMs = 0;
    try {
        mtimeMs = fs.statSync(abs).mtimeMs;
    }
    catch {
        return undefined;
    }
    const key = abs.toLowerCase() + '|' + mtimeMs;
    const hit = dataCache.get(key);
    if (hit !== undefined) {
        return hit;
    }
    try {
        const buf = fs.readFileSync(abs);
        // >8MB 的图不内嵌（webview html 会超限卡死），提示换小图
        if (buf.length > 8 * 1024 * 1024) {
            return undefined;
        }
        const mime = mimeByExt[path.extname(abs).toLowerCase()] ?? 'image/png';
        const data = `data:${mime};base64,${buf.toString('base64')}`;
        dataCache.set(key, data);
        return data;
    }
    catch {
        return undefined;
    }
}
/** 生成面板背景 CSS（图片 data-URI + 固定铺底层）；无效设置返回空串 */
function webviewBackgroundCss(cfg) {
    const s = loadBgSettings(cfg);
    const p = s.imagePath.trim();
    if (!p) {
        return '';
    }
    const abs = path.isAbsolute(p) ? p : path.resolve(p);
    const data = imageDataUri(abs);
    if (!data) {
        return '';
    }
    const bg = `url("${data}") ${s.scale === 'center' ? 'center center / auto no-repeat' : 'center center / cover no-repeat'}`;
    // 固定铺底层 ::before 承载图片（可加模糊），内容 z-index 抬高
    return `
    html, body { background: transparent !important; position: relative; }
    body::before {
      content: ''; position: fixed; inset: 0; z-index: 0;
      background: ${bg};
      opacity: ${s.opacity};
      filter: ${s.blur > 0 ? `blur(${s.blur}px)` : 'none'};
      pointer-events: none;
    }
    body > *:not(style) { position: relative; z-index: 1; }
  `;
}
//# sourceMappingURL=webviewBackground.js.map