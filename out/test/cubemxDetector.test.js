"use strict";
/**
 * STM32CubeMX 探测测试：设置覆盖 → 标准目录 → 版本化目录（取最新）。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const cubemxDetector_1 = require("../src/detection/cubemxDetector");
function fakeEnv(existing, dirs) {
    return {
        async exists(p) {
            return existing.has(p);
        },
        async listDirs(dir) {
            return dirs[dir] ?? [];
        },
    };
}
(0, node_test_1.test)('设置覆盖优先于一切候选', async () => {
    const env = fakeEnv(new Set(['D:\\my\\STM32CubeMX.exe']), {});
    const r = await (0, cubemxDetector_1.findCubeMx)(env, 'D:\\my\\STM32CubeMX.exe');
    strict_1.default.equal(r, 'D:\\my\\STM32CubeMX.exe');
});
(0, node_test_1.test)('标准安装目录命中', async () => {
    const std = 'C:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeMX\\STM32CubeMX.exe';
    const env = fakeEnv(new Set([std]), {});
    strict_1.default.equal(await (0, cubemxDetector_1.findCubeMx)(env, undefined), std);
});
(0, node_test_1.test)('版本化目录取最新版本', async () => {
    const old = 'C:\\ST\\STM32CubeMX_6.9.0\\STM32CubeMX.exe';
    const cur = 'C:\\ST\\STM32CubeMX_6.12.1\\STM32CubeMX.exe';
    const env = fakeEnv(new Set([old, cur]), {
        'C:\\ST': ['STM32CubeMX_6.9.0', 'STM32CubeMX_6.12.1'],
    });
    strict_1.default.equal(await (0, cubemxDetector_1.findCubeMx)(env, undefined), cur);
});
(0, node_test_1.test)('什么都不存在时返回 undefined', async () => {
    const env = fakeEnv(new Set(), {});
    strict_1.default.equal(await (0, cubemxDetector_1.findCubeMx)(env, undefined), undefined);
});
//# sourceMappingURL=cubemxDetector.test.js.map