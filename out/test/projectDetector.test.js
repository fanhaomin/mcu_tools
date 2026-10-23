"use strict";
/**
 * 工程识别测试：CubeMX CMake 工程 / 普通 CMake 工程 / 芯片宏提取 /
 * 链接脚本识别 / 家族级证据 / 非 STM32 工程 / 证据冲突。
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const path = __importStar(require("path"));
const projectDetector_1 = require("../src/detection/projectDetector");
const stm32Detector_1 = require("../src/detection/stm32Detector");
const fixtures_1 = require("./helpers/fixtures");
function makeCubeMxProject(root) {
    (0, fixtures_1.write)(root, 'test.ioc', [
        '# MicroXplorer Creator studio file',
        'Mcu.Family=STM32G4',
        'Mcu.Name=STM32G431RBTx',
        'ProjectManager.DeviceId=STM32G431RBTx',
    ].join('\n'));
    (0, fixtures_1.write)(root, 'CMakeLists.txt', [
        'cmake_minimum_required(VERSION 3.22)',
        'project(stm32demo C ASM)',
        'add_compile_definitions(DEBUG STM32G431xx)',
        'add_executable(stm32demo Core/Src/main.c Core/Startup/startup_stm32g431xx.s)',
    ].join('\n'));
    (0, fixtures_1.write)(root, 'cmake/gcc-arm-none-eabi.cmake', 'set(CMAKE_C_COMPILER arm-none-eabi-gcc)');
    (0, fixtures_1.write)(root, 'Core/Inc/main.h', '');
    (0, fixtures_1.write)(root, 'Core/Src/main.c', 'int main(void){return 0;}');
    (0, fixtures_1.write)(root, 'Core/Startup/startup_stm32g431xx.s', '');
    (0, fixtures_1.write)(root, 'Drivers/STM32G4xx_HAL_Driver/Src/stm32g4xx_hal.c', '');
    (0, fixtures_1.write)(root, 'Drivers/CMSIS/Include/cmsis_gcc.h', '');
    (0, fixtures_1.write)(root, 'STM32G431RBTX_FLASH.ld', '');
}
(0, node_test_1.test)('CubeMX CMake 工程：识别 .ioc/Core/HAL/CMSIS/启动文件/链接脚本，芯片为 STM32G431 高可信度', async () => {
    const root = (0, fixtures_1.makeTempDir)();
    try {
        makeCubeMxProject(root);
        const info = await (0, projectDetector_1.detectProject)(root);
        strict_1.default.equal(info.hasCMakeLists, true);
        strict_1.default.equal(info.hasIoc, true);
        strict_1.default.equal(info.isCubeMxCMake, true);
        strict_1.default.equal(info.hasCoreDirs, true);
        strict_1.default.equal(info.hasHalDriver, true);
        strict_1.default.equal(info.hasCmsis, true);
        strict_1.default.equal(info.recognized, true);
        strict_1.default.equal(info.mcu.base, 'STM32G431');
        strict_1.default.equal(info.mcu.family, 'STM32G4');
        strict_1.default.equal(info.mcu.macro, 'STM32G431xx');
        strict_1.default.equal(info.mcu.confidence, 'high');
        strict_1.default.equal(info.mcu.confirmedByUser, false);
        strict_1.default.equal(info.mcu.warnings.length, 0);
        strict_1.default.ok(info.startupFiles.some((f) => f.endsWith('startup_stm32g431xx.s')));
        strict_1.default.ok(info.linkerScripts.some((f) => path.basename(f) === 'STM32G431RBTX_FLASH.ld'));
        strict_1.default.equal(info.hasToolchainConfig, true, '存在 cmake/gcc-arm-none-eabi.cmake 应视为已配置工具链');
    }
    finally {
        (0, fixtures_1.cleanup)(root);
    }
});
(0, node_test_1.test)('普通 CMake 工程（无 .ioc）：通过编译宏/启动文件/链接脚本识别 STM32F407', async () => {
    const root = (0, fixtures_1.makeTempDir)();
    try {
        (0, fixtures_1.write)(root, 'CMakeLists.txt', 'project(f4demo C ASM)\nadd_compile_definitions(STM32F407xx USE_HAL_DRIVER)');
        (0, fixtures_1.write)(root, 'Core/Inc/main.h', '');
        (0, fixtures_1.write)(root, 'Core/Src/main.c', '');
        (0, fixtures_1.write)(root, 'Core/Startup/startup_stm32f407xx.s', '');
        (0, fixtures_1.write)(root, 'Drivers/STM32F4xx_HAL_Driver/Src/stm32f4xx_hal.c', '');
        (0, fixtures_1.write)(root, 'Drivers/CMSIS/Include/core_cm4.h', '');
        (0, fixtures_1.write)(root, 'STM32F407VGTX_FLASH.ld', '');
        const info = await (0, projectDetector_1.detectProject)(root);
        strict_1.default.equal(info.hasIoc, false);
        strict_1.default.equal(info.recognized, true);
        strict_1.default.equal(info.mcu.base, 'STM32F407');
        strict_1.default.equal(info.mcu.macro, 'STM32F407xx');
        strict_1.default.equal(info.mcu.confidence, 'high', '编译宏+启动文件+链接脚本三重证据应为高可信度');
        strict_1.default.equal(info.mcu.confirmedByUser, false);
    }
    finally {
        (0, fixtures_1.cleanup)(root);
    }
});
(0, node_test_1.test)('仅有家族级证据（HAL 目录）时：型号待确认，不虚构型号', async () => {
    const root = (0, fixtures_1.makeTempDir)();
    try {
        (0, fixtures_1.write)(root, 'CMakeLists.txt', 'project(mystery C)');
        (0, fixtures_1.write)(root, 'Drivers/STM32L4xx_HAL_Driver/Src/stm32l4xx_hal.c', '');
        const info = await (0, projectDetector_1.detectProject)(root);
        strict_1.default.equal(info.recognized, true);
        strict_1.default.equal(info.mcu.model, '', '不能凭文件夹名称认定具体型号');
        strict_1.default.equal(info.mcu.base, '');
        strict_1.default.equal(info.mcu.family, 'STM32L4');
        strict_1.default.equal(info.mcu.confidence, 'low');
        strict_1.default.ok(info.mcu.warnings.some((w) => w.includes('待确认')));
    }
    finally {
        (0, fixtures_1.cleanup)(root);
    }
});
(0, node_test_1.test)('非 STM32 工程：不误报', async () => {
    const root = (0, fixtures_1.makeTempDir)();
    try {
        (0, fixtures_1.write)(root, 'CMakeLists.txt', 'cmake_minimum_required(VERSION 3.10)\nproject(hello C)');
        (0, fixtures_1.write)(root, 'main.c', 'int main(){return 0;}');
        const info = await (0, projectDetector_1.detectProject)(root);
        strict_1.default.equal(info.recognized, false);
        strict_1.default.equal(info.mcu.confidence, 'none');
        strict_1.default.equal(info.mcu.family, '');
    }
    finally {
        (0, fixtures_1.cleanup)(root);
    }
});
(0, node_test_1.test)('芯片宏提取：常见型号与宏形式', () => {
    const chip1 = (0, stm32Detector_1.parseChipToken)('STM32G474RETx');
    strict_1.default.equal(chip1.base, 'STM32G474');
    strict_1.default.equal(chip1.family, 'STM32G4');
    strict_1.default.equal(chip1.macro, 'STM32G474xx');
    const chip2 = (0, stm32Detector_1.parseChipToken)('STM32G431XX');
    strict_1.default.equal(chip2.base, 'STM32G431');
    strict_1.default.equal(chip2.macro, 'STM32G431xx');
    const chip3 = (0, stm32Detector_1.parseChipToken)('stm32h743xx');
    strict_1.default.equal(chip3.base, 'STM32H743');
    strict_1.default.equal(chip3.family, 'STM32H7');
    const chip4 = (0, stm32Detector_1.parseChipToken)('STM32L431RCTx');
    strict_1.default.equal(chip4.base, 'STM32L431');
    strict_1.default.equal(chip4.family, 'STM32L4');
    const chip5 = (0, stm32Detector_1.parseChipToken)('STM32WB55CC');
    strict_1.default.equal(chip5.base, 'STM32WB55');
    strict_1.default.equal(chip5.family, 'STM32WB');
    strict_1.default.equal((0, stm32Detector_1.parseChipToken)('ESP32-S3'), undefined, '非 STM32 平台不应匹配');
    strict_1.default.equal((0, stm32Detector_1.parseChipToken)('GD32F303'), undefined);
});
(0, node_test_1.test)('从文本批量提取芯片宏', () => {
    const text = [
        'add_compile_definitions(STM32F407xx USE_HAL_DRIVER)',
        '# -DSTM32F411xE',
        'arm-none-eabi-gcc -mcpu=cortex-m4 -DSTM32F407xx',
    ].join('\n');
    const chips = (0, stm32Detector_1.extractChipTokens)(text);
    const bases = new Set(chips.map((c) => c.base));
    strict_1.default.ok(bases.has('STM32F407'));
    strict_1.default.ok(bases.has('STM32F411'));
    strict_1.default.equal(chips.every((c) => c.family === 'STM32F4'), true);
});
(0, node_test_1.test)('链接脚本识别：STM32F103C8TX_FLASH.ld', async () => {
    const root = (0, fixtures_1.makeTempDir)();
    try {
        (0, fixtures_1.write)(root, 'CMakeLists.txt', 'project(bluepill C ASM)');
        (0, fixtures_1.write)(root, 'STM32F103C8TX_FLASH.ld', '');
        (0, fixtures_1.write)(root, 'startup_stm32f103xb.s', '');
        const info = await (0, projectDetector_1.detectProject)(root);
        strict_1.default.ok(info.linkerScripts.some((f) => f.endsWith('STM32F103C8TX_FLASH.ld')));
        strict_1.default.equal(info.mcu.base, 'STM32F103');
        const ldEvidence = info.mcu.evidence.find((e) => e.source === 'linkerScript');
        strict_1.default.ok(ldEvidence, '链接脚本应作为证据出现');
        strict_1.default.equal(ldEvidence.base, 'STM32F103');
    }
    finally {
        (0, fixtures_1.cleanup)(root);
    }
});
(0, node_test_1.test)('证据冲突：.ioc 与编译宏不一致时降级可信度并给出警告', async () => {
    const root = (0, fixtures_1.makeTempDir)();
    try {
        (0, fixtures_1.write)(root, 'device.ioc', 'Mcu.Name=STM32G431RBTx\nMcu.Family=STM32G4');
        (0, fixtures_1.write)(root, 'CMakeLists.txt', 'project(mixed C)\nadd_compile_definitions(STM32F407xx)');
        const info = await (0, projectDetector_1.detectProject)(root);
        strict_1.default.equal(info.mcu.base, 'STM32G431', '.ioc 权重更高，应胜出');
        strict_1.default.notEqual(info.mcu.confidence, 'high', '存在竞争证据时不得给出高可信度');
        strict_1.default.ok(info.mcu.warnings.length > 0, '应输出冲突警告');
    }
    finally {
        (0, fixtures_1.cleanup)(root);
    }
});
(0, node_test_1.test)('工具链配置判定：仅提及 toolchain 字样不算已配置（Trae 实测回归场景）', async () => {
    const root = (0, fixtures_1.makeTempDir)();
    try {
        (0, fixtures_1.write)(root, 'CMakeLists.txt', [
            '# This project may need a toolchain file for cross compilation.',
            '# arm-none-eabi-gcc is recommended.',
            'project(mention_only C)',
        ].join('\n'));
        const info = await (0, projectDetector_1.detectProject)(root);
        strict_1.default.equal(info.hasToolchainConfig, false, '文本提及 toolchain/arm-none-eabi 不构成可用的工具链配置');
    }
    finally {
        (0, fixtures_1.cleanup)(root);
    }
});
(0, node_test_1.test)('工具链配置判定：set(CMAKE_C_COMPILER) 或 CMakeLists 引用工具链文件时视为已配置', async () => {
    const root1 = (0, fixtures_1.makeTempDir)();
    try {
        (0, fixtures_1.write)(root1, 'CMakeLists.txt', 'project(a C)\nset(CMAKE_C_COMPILER arm-none-eabi-gcc)');
        strict_1.default.equal((await (0, projectDetector_1.detectProject)(root1)).hasToolchainConfig, true);
    }
    finally {
        (0, fixtures_1.cleanup)(root1);
    }
    const root2 = (0, fixtures_1.makeTempDir)();
    try {
        (0, fixtures_1.write)(root2, 'CMakeLists.txt', 'project(b C)\nset(CMAKE_TOOLCHAIN_FILE ${CMAKE_SOURCE_DIR}/cmake/tc.cmake)');
        (0, fixtures_1.write)(root2, 'cmake/tc.cmake', 'message(STATUS only, no compiler settings)');
        strict_1.default.equal((await (0, projectDetector_1.detectProject)(root2)).hasToolchainConfig, true);
    }
    finally {
        (0, fixtures_1.cleanup)(root2);
    }
    const root3 = (0, fixtures_1.makeTempDir)();
    try {
        // .cmake 文件存在但不设置编译器 → 不算
        (0, fixtures_1.write)(root3, 'CMakeLists.txt', 'project(c C)\ninclude(cmake/utils.cmake)');
        (0, fixtures_1.write)(root3, 'cmake/utils.cmake', 'function(my_helper) endfunction()');
        strict_1.default.equal((await (0, projectDetector_1.detectProject)(root3)).hasToolchainConfig, false);
    }
    finally {
        (0, fixtures_1.cleanup)(root3);
    }
});
(0, node_test_1.test)('CLion 工程：cmake-build-debug 识别、CMakeCache 证据、CLion 构建产物可被发现、内联工具链不注入', async () => {
    const root = (0, fixtures_1.makeTempDir)();
    try {
        // CLion 模板风格：CMakeLists 内联设置编译器，链接脚本无 _FLASH 后缀
        (0, fixtures_1.write)(root, 'CMakeLists.txt', [
            'cmake_minimum_required(VERSION 3.28)',
            'set(CMAKE_C_COMPILER arm-none-eabi-gcc)',
            'set(CMAKE_CXX_COMPILER arm-none-eabi-g++)',
            'project(clion_stm32 C ASM)',
            'add_executable(clion_stm32 startup/startup_stm32f103xb.s src/main.c)',
        ].join('\n'));
        (0, fixtures_1.write)(root, 'STM32F103C8Tx.ld', '');
        (0, fixtures_1.write)(root, 'startup/startup_stm32f103xb.s', '');
        (0, fixtures_1.write)(root, 'src/main.c', '');
        (0, fixtures_1.write)(root, '.idea/workspace.xml', '');
        // CLion 默认构建目录：含 CMakeCache（生成器 + 芯片宏证据）和编译出的 ELF
        (0, fixtures_1.write)(root, 'cmake-build-debug/CMakeCache.txt', [
            'CMAKE_GENERATOR:INTERNAL=Ninja',
            'CMAKE_BUILD_TYPE:STRING=Debug',
            'CMAKE_C_FLAGS:STRING=-mcpu=cortex-m3 -DSTM32F103xB',
        ].join('\n'));
        (0, fixtures_1.write)(root, 'cmake-build-debug/clion_stm32.elf', 'elf-from-clion');
        const info = await (0, projectDetector_1.detectProject)(root);
        strict_1.default.equal(info.recognized, true);
        strict_1.default.equal(info.mcu.base, 'STM32F103');
        strict_1.default.equal(info.mcu.confidence, 'high', 'CMakeCache 宏 + 链接脚本 + 启动文件 = 10 分');
        strict_1.default.equal(info.hasToolchainConfig, true, 'CLion 内联 set(CMAKE_C_COMPILER) 应视为已配置工具链');
        strict_1.default.ok(info.foreignBuildDirs.some((d) => d.endsWith('cmake-build-debug')), 'cmake-build-debug 应识别为外部构建目录（只读，不改动）');
        strict_1.default.deepEqual(info.cmakeGenerators, ['Ninja']);
        strict_1.default.ok(info.artifacts.some((a) => a.path.endsWith('clion_stm32.elf')), 'CLion 编译出的 ELF 应可被“烧录现有固件”发现');
        strict_1.default.ok(info.linkerScripts.some((f) => f.endsWith('STM32F103C8Tx.ld')));
    }
    finally {
        (0, fixtures_1.cleanup)(root);
    }
});
(0, node_test_1.test)('家族宏（-DSTM32G4xx）是家族级证据，不得据此确定精确型号', async () => {
    const root = (0, fixtures_1.makeTempDir)();
    try {
        (0, fixtures_1.write)(root, 'CMakeLists.txt', 'project(fam C)\nadd_compile_definitions(STM32G4xx)');
        (0, fixtures_1.write)(root, 'Drivers/STM32G4xx_HAL_Driver/Src/stm32g4xx_hal.c', '');
        const info = await (0, projectDetector_1.detectProject)(root);
        strict_1.default.equal(info.mcu.family, 'STM32G4');
        strict_1.default.equal(info.mcu.base, '', '家族宏不能作为精确型号参与烧录门禁');
        strict_1.default.equal(info.mcu.model, '');
        strict_1.default.equal(info.mcu.confidence, 'low');
    }
    finally {
        (0, fixtures_1.cleanup)(root);
    }
});
(0, node_test_1.test)('链接脚本命名兼容：_FLASH 后缀与 CLion 风格无后缀均可识别', async () => {
    const root = (0, fixtures_1.makeTempDir)();
    try {
        (0, fixtures_1.write)(root, 'CMakeLists.txt', 'project(ldnames C ASM)');
        (0, fixtures_1.write)(root, 'STM32G431RBTX_FLASH.ld', '');
        (0, fixtures_1.write)(root, 'ld/STM32F103C8Tx.ld', '');
        const info = await (0, projectDetector_1.detectProject)(root);
        const ldEvidence = info.mcu.evidence.filter((e) => e.source === 'linkerScript');
        const bases = new Set(ldEvidence.map((e) => e.base));
        strict_1.default.ok(bases.has('STM32G431'), 'CubeMX 风格 _FLASH 命名');
        strict_1.default.ok(bases.has('STM32F103'), 'CLion 风格无后缀命名');
    }
    finally {
        (0, fixtures_1.cleanup)(root);
    }
});
(0, node_test_1.test)('家族 → CPU 编译选项推导（自愈缺失 -mcpu 的工程）', async () => {
    const { familyCpuFlags } = await Promise.resolve().then(() => __importStar(require('../src/detection/stm32Detector')));
    strict_1.default.equal(familyCpuFlags('STM32F1'), '-mcpu=cortex-m3 -mthumb');
    strict_1.default.equal(familyCpuFlags('STM32G4'), '-mcpu=cortex-m4 -mthumb');
    strict_1.default.equal(familyCpuFlags('STM32H7'), '-mcpu=cortex-m7 -mthumb');
    strict_1.default.equal(familyCpuFlags('STM32C0'), '-mcpu=cortex-m0plus -mthumb');
    strict_1.default.equal(familyCpuFlags('STM32L4'), '-mcpu=cortex-m4 -mthumb');
    strict_1.default.equal(familyCpuFlags('STM32MP1'), undefined, 'MP1 为 Cortex-A，不盲目注入');
    strict_1.default.equal(familyCpuFlags(''), undefined);
});
(0, node_test_1.test)('自愈工具链文件：包含原工具链、TRY_COMPILE 跳过、家族 CPU 选项', async () => {
    const { generateToolchainFileContent } = await Promise.resolve().then(() => __importStar(require('../src/cmake/configure')));
    const text = generateToolchainFileContent('C:\\ARM\\bin\\arm-none-eabi-gcc.exe', 'C:\\ARM\\bin\\arm-none-eabi-g++.exe', {
        cpuFlags: '-mcpu=cortex-m3 -mthumb',
        includeOriginalToolchain: 'D:\\cs\\cs\\cmake\\gcc-arm-none-eabi.cmake',
    });
    strict_1.default.ok(text.includes('include("D:/cs/cs/cmake/gcc-arm-none-eabi.cmake")'), '应保留工程原工具链设置');
    strict_1.default.ok(text.includes('set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)'));
    strict_1.default.ok(text.includes('CMAKE_C_FLAGS_INIT "${CMAKE_C_FLAGS_INIT} -mcpu=cortex-m3 -mthumb"'));
    strict_1.default.ok(text.includes('CMAKE_ASM_FLAGS_INIT'));
    strict_1.default.ok(text.includes('C:/ARM/bin/arm-none-eabi-gcc.exe'), '编译器用完整路径且正斜杠');
    // 不带可选参数时保持向后兼容
    const plain = generateToolchainFileContent('gcc', 'g++');
    strict_1.default.ok(plain.includes('set(CMAKE_SYSTEM_NAME Generic)'));
    strict_1.default.ok(!plain.includes('include('));
});
(0, node_test_1.test)('证据聚合：用户手动确认型号具有最高优先级', () => {
    const mcu = (0, stm32Detector_1.combineEvidence)([
        {
            source: 'halDriver',
            detail: 'Drivers/STM32G4xx_HAL_Driver',
            family: 'STM32G4',
            weight: 1,
        },
    ], 'STM32G474RETx');
    strict_1.default.equal(mcu.confirmedByUser, true);
    strict_1.default.equal(mcu.base, 'STM32G474');
    strict_1.default.equal(mcu.confidence, 'high');
});
//# sourceMappingURL=projectDetector.test.js.map