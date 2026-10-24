"use strict";
/**
 * Auto CMake Flash — 共享类型定义。
 *
 * 注意：本文件不得 import 'vscode'，以便核心逻辑可在纯 Node 环境下单元测试。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_LABELS = exports.DEBUG_TOOL_NAMES = exports.ALL_TOOL_NAMES = void 0;
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
/**
 * 调试组件：可选，不参与 complete/missing 判定。
 * 缺失只影响调试功能（随 STM32CubeCLT 安装：gdb 在 GNU-tools-for-STM32，
 * GDB Server 在 STM32CubeProgrammer/bin）。
 */
exports.DEBUG_TOOL_NAMES = ['armGdb', 'stlinkGdbServer'];
exports.TOOL_LABELS = {
    cmake: 'CMake',
    ninja: 'Ninja',
    armGcc: 'ARM GCC (arm-none-eabi-gcc)',
    armGpp: 'ARM G++ (arm-none-eabi-g++)',
    objcopy: 'arm-none-eabi-objcopy',
    size: 'arm-none-eabi-size',
    programmerCli: 'STM32CubeProgrammer CLI',
    armGdb: 'ARM GDB (arm-none-eabi-gdb)',
    stlinkGdbServer: 'ST-LINK GDB Server',
};
//# sourceMappingURL=types.js.map