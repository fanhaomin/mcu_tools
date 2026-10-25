"use strict";
/**
 * Embedded Debug — 共享类型定义。
 *
 * 注意：本文件不得 import 'vscode'，以便核心逻辑可在纯 Node 环境下单元测试。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_LABELS = exports.ALL_TOOL_NAMES = void 0;
exports.unknownMcu = unknownMcu;
function unknownMcu() {
    return {
        model: '',
        base: '',
        family: '',
        macro: '',
        confidence: 'none',
        evidence: [],
        confirmedByUser: false,
        warnings: [],
    };
}
/** 核心组件：编译与烧录必需，任一缺失即视为环境不完整 */
exports.ALL_TOOL_NAMES = [
    'cmake',
    'ninja',
    'armGcc',
    'armGpp',
    'objcopy',
    'size',
    'programmerCli',
];
exports.TOOL_LABELS = {
    cmake: 'CMake',
    ninja: 'Ninja',
    armGcc: 'ARM GCC (arm-none-eabi-gcc)',
    armGpp: 'ARM G++ (arm-none-eabi-g++)',
    objcopy: 'arm-none-eabi-objcopy',
    size: 'arm-none-eabi-size',
    programmerCli: 'STM32CubeProgrammer CLI',
};
//# sourceMappingURL=types.js.map