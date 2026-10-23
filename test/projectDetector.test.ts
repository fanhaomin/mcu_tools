/**
 * 工程识别测试：CubeMX CMake 工程 / 普通 CMake 工程 / 芯片宏提取 /
 * 链接脚本识别 / 家族级证据 / 非 STM32 工程 / 证据冲突。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { detectProject } from '../src/detection/projectDetector';
import { extractChipTokens, parseChipToken, combineEvidence } from '../src/detection/stm32Detector';
import { makeTempDir, write, cleanup } from './helpers/fixtures';

function makeCubeMxProject(root: string): void {
  write(
    root,
    'test.ioc',
    [
      '# MicroXplorer Creator studio file',
      'Mcu.Family=STM32G4',
      'Mcu.Name=STM32G431RBTx',
      'ProjectManager.DeviceId=STM32G431RBTx',
    ].join('\n'),
  );
  write(
    root,
    'CMakeLists.txt',
    [
      'cmake_minimum_required(VERSION 3.22)',
      'project(stm32demo C ASM)',
      'add_compile_definitions(DEBUG STM32G431xx)',
      'add_executable(stm32demo Core/Src/main.c Core/Startup/startup_stm32g431xx.s)',
    ].join('\n'),
  );
  write(root, 'cmake/gcc-arm-none-eabi.cmake', 'set(CMAKE_C_COMPILER arm-none-eabi-gcc)');
  write(root, 'Core/Inc/main.h', '');
  write(root, 'Core/Src/main.c', 'int main(void){return 0;}');
  write(root, 'Core/Startup/startup_stm32g431xx.s', '');
  write(root, 'Drivers/STM32G4xx_HAL_Driver/Src/stm32g4xx_hal.c', '');
  write(root, 'Drivers/CMSIS/Include/cmsis_gcc.h', '');
  write(root, 'STM32G431RBTX_FLASH.ld', '');
}

test('CubeMX CMake 工程：识别 .ioc/Core/HAL/CMSIS/启动文件/链接脚本，芯片为 STM32G431 高可信度', async () => {
  const root = makeTempDir();
  try {
    makeCubeMxProject(root);
    const info = await detectProject(root);

    assert.equal(info.hasCMakeLists, true);
    assert.equal(info.hasIoc, true);
    assert.equal(info.isCubeMxCMake, true);
    assert.equal(info.hasCoreDirs, true);
    assert.equal(info.hasHalDriver, true);
    assert.equal(info.hasCmsis, true);
    assert.equal(info.recognized, true);

    assert.equal(info.mcu.base, 'STM32G431');
    assert.equal(info.mcu.family, 'STM32G4');
    assert.equal(info.mcu.macro, 'STM32G431xx');
    assert.equal(info.mcu.confidence, 'high');
    assert.equal(info.mcu.confirmedByUser, false);
    assert.equal(info.mcu.warnings.length, 0);

    assert.ok(info.startupFiles.some((f) => f.endsWith('startup_stm32g431xx.s')));
    assert.ok(info.linkerScripts.some((f) => path.basename(f) === 'STM32G431RBTX_FLASH.ld'));
    assert.equal(info.hasToolchainConfig, true, '存在 cmake/gcc-arm-none-eabi.cmake 应视为已配置工具链');
  } finally {
    cleanup(root);
  }
});

test('普通 CMake 工程（无 .ioc）：通过编译宏/启动文件/链接脚本识别 STM32F407', async () => {
  const root = makeTempDir();
  try {
    write(
      root,
      'CMakeLists.txt',
      'project(f4demo C ASM)\nadd_compile_definitions(STM32F407xx USE_HAL_DRIVER)',
    );
    write(root, 'Core/Inc/main.h', '');
    write(root, 'Core/Src/main.c', '');
    write(root, 'Core/Startup/startup_stm32f407xx.s', '');
    write(root, 'Drivers/STM32F4xx_HAL_Driver/Src/stm32f4xx_hal.c', '');
    write(root, 'Drivers/CMSIS/Include/core_cm4.h', '');
    write(root, 'STM32F407VGTX_FLASH.ld', '');

    const info = await detectProject(root);
    assert.equal(info.hasIoc, false);
    assert.equal(info.recognized, true);
    assert.equal(info.mcu.base, 'STM32F407');
    assert.equal(info.mcu.macro, 'STM32F407xx');
    assert.equal(info.mcu.confidence, 'high', '编译宏+启动文件+链接脚本三重证据应为高可信度');
    assert.equal(info.mcu.confirmedByUser, false);
  } finally {
    cleanup(root);
  }
});

test('仅有家族级证据（HAL 目录）时：型号待确认，不虚构型号', async () => {
  const root = makeTempDir();
  try {
    write(root, 'CMakeLists.txt', 'project(mystery C)');
    write(root, 'Drivers/STM32L4xx_HAL_Driver/Src/stm32l4xx_hal.c', '');
    const info = await detectProject(root);

    assert.equal(info.recognized, true);
    assert.equal(info.mcu.model, '', '不能凭文件夹名称认定具体型号');
    assert.equal(info.mcu.base, '');
    assert.equal(info.mcu.family, 'STM32L4');
    assert.equal(info.mcu.confidence, 'low');
    assert.ok(info.mcu.warnings.some((w) => w.includes('待确认')));
  } finally {
    cleanup(root);
  }
});

test('非 STM32 工程：不误报', async () => {
  const root = makeTempDir();
  try {
    write(root, 'CMakeLists.txt', 'cmake_minimum_required(VERSION 3.10)\nproject(hello C)');
    write(root, 'main.c', 'int main(){return 0;}');
    const info = await detectProject(root);
    assert.equal(info.recognized, false);
    assert.equal(info.mcu.confidence, 'none');
    assert.equal(info.mcu.family, '');
  } finally {
    cleanup(root);
  }
});

test('芯片宏提取：常见型号与宏形式', () => {
  const chip1 = parseChipToken('STM32G474RETx')!;
  assert.equal(chip1.base, 'STM32G474');
  assert.equal(chip1.family, 'STM32G4');
  assert.equal(chip1.macro, 'STM32G474xx');

  const chip2 = parseChipToken('STM32G431XX')!;
  assert.equal(chip2.base, 'STM32G431');
  assert.equal(chip2.macro, 'STM32G431xx');

  const chip3 = parseChipToken('stm32h743xx')!;
  assert.equal(chip3.base, 'STM32H743');
  assert.equal(chip3.family, 'STM32H7');

  const chip4 = parseChipToken('STM32L431RCTx')!;
  assert.equal(chip4.base, 'STM32L431');
  assert.equal(chip4.family, 'STM32L4');

  const chip5 = parseChipToken('STM32WB55CC')!;
  assert.equal(chip5.base, 'STM32WB55');
  assert.equal(chip5.family, 'STM32WB');

  assert.equal(parseChipToken('ESP32-S3'), undefined, '非 STM32 平台不应匹配');
  assert.equal(parseChipToken('GD32F303'), undefined);
});

test('从文本批量提取芯片宏', () => {
  const text = [
    'add_compile_definitions(STM32F407xx USE_HAL_DRIVER)',
    '# -DSTM32F411xE',
    'arm-none-eabi-gcc -mcpu=cortex-m4 -DSTM32F407xx',
  ].join('\n');
  const chips = extractChipTokens(text);
  const bases = new Set(chips.map((c) => c.base));
  assert.ok(bases.has('STM32F407'));
  assert.ok(bases.has('STM32F411'));
  assert.equal(chips.every((c) => c.family === 'STM32F4'), true);
});

test('链接脚本识别：STM32F103C8TX_FLASH.ld', async () => {
  const root = makeTempDir();
  try {
    write(root, 'CMakeLists.txt', 'project(bluepill C ASM)');
    write(root, 'STM32F103C8TX_FLASH.ld', '');
    write(root, 'startup_stm32f103xb.s', '');
    const info = await detectProject(root);
    assert.ok(info.linkerScripts.some((f) => f.endsWith('STM32F103C8TX_FLASH.ld')));
    assert.equal(info.mcu.base, 'STM32F103');
    const ldEvidence = info.mcu.evidence.find((e) => e.source === 'linkerScript');
    assert.ok(ldEvidence, '链接脚本应作为证据出现');
    assert.equal(ldEvidence!.base, 'STM32F103');
  } finally {
    cleanup(root);
  }
});

test('证据冲突：.ioc 与编译宏不一致时降级可信度并给出警告', async () => {
  const root = makeTempDir();
  try {
    write(root, 'device.ioc', 'Mcu.Name=STM32G431RBTx\nMcu.Family=STM32G4');
    write(root, 'CMakeLists.txt', 'project(mixed C)\nadd_compile_definitions(STM32F407xx)');
    const info = await detectProject(root);

    assert.equal(info.mcu.base, 'STM32G431', '.ioc 权重更高，应胜出');
    assert.notEqual(info.mcu.confidence, 'high', '存在竞争证据时不得给出高可信度');
    assert.ok(info.mcu.warnings.length > 0, '应输出冲突警告');
  } finally {
    cleanup(root);
  }
});

test('工具链配置判定：仅提及 toolchain 字样不算已配置（Trae 实测回归场景）', async () => {
  const root = makeTempDir();
  try {
    write(
      root,
      'CMakeLists.txt',
      [
        '# This project may need a toolchain file for cross compilation.',
        '# arm-none-eabi-gcc is recommended.',
        'project(mention_only C)',
      ].join('\n'),
    );
    const info = await detectProject(root);
    assert.equal(
      info.hasToolchainConfig,
      false,
      '文本提及 toolchain/arm-none-eabi 不构成可用的工具链配置',
    );
  } finally {
    cleanup(root);
  }
});

test('工具链配置判定：set(CMAKE_C_COMPILER) 或 CMakeLists 引用工具链文件时视为已配置', async () => {
  const root1 = makeTempDir();
  try {
    write(root1, 'CMakeLists.txt', 'project(a C)\nset(CMAKE_C_COMPILER arm-none-eabi-gcc)');
    assert.equal((await detectProject(root1)).hasToolchainConfig, true);
  } finally {
    cleanup(root1);
  }
  const root2 = makeTempDir();
  try {
    write(root2, 'CMakeLists.txt', 'project(b C)\nset(CMAKE_TOOLCHAIN_FILE ${CMAKE_SOURCE_DIR}/cmake/tc.cmake)');
    write(root2, 'cmake/tc.cmake', 'message(STATUS only, no compiler settings)');
    assert.equal((await detectProject(root2)).hasToolchainConfig, true);
  } finally {
    cleanup(root2);
  }
  const root3 = makeTempDir();
  try {
    // .cmake 文件存在但不设置编译器 → 不算
    write(root3, 'CMakeLists.txt', 'project(c C)\ninclude(cmake/utils.cmake)');
    write(root3, 'cmake/utils.cmake', 'function(my_helper) endfunction()');
    assert.equal((await detectProject(root3)).hasToolchainConfig, false);
  } finally {
    cleanup(root3);
  }
});

test('CLion 工程：cmake-build-debug 识别、CMakeCache 证据、CLion 构建产物可被发现、内联工具链不注入', async () => {
  const root = makeTempDir();
  try {
    // CLion 模板风格：CMakeLists 内联设置编译器，链接脚本无 _FLASH 后缀
    write(
      root,
      'CMakeLists.txt',
      [
        'cmake_minimum_required(VERSION 3.28)',
        'set(CMAKE_C_COMPILER arm-none-eabi-gcc)',
        'set(CMAKE_CXX_COMPILER arm-none-eabi-g++)',
        'project(clion_stm32 C ASM)',
        'add_executable(clion_stm32 startup/startup_stm32f103xb.s src/main.c)',
      ].join('\n'),
    );
    write(root, 'STM32F103C8Tx.ld', '');
    write(root, 'startup/startup_stm32f103xb.s', '');
    write(root, 'src/main.c', '');
    write(root, '.idea/workspace.xml', '');
    // CLion 默认构建目录：含 CMakeCache（生成器 + 芯片宏证据）和编译出的 ELF
    write(
      root,
      'cmake-build-debug/CMakeCache.txt',
      [
        'CMAKE_GENERATOR:INTERNAL=Ninja',
        'CMAKE_BUILD_TYPE:STRING=Debug',
        'CMAKE_C_FLAGS:STRING=-mcpu=cortex-m3 -DSTM32F103xB',
      ].join('\n'),
    );
    write(root, 'cmake-build-debug/clion_stm32.elf', 'elf-from-clion');

    const info = await detectProject(root);
    assert.equal(info.recognized, true);
    assert.equal(info.mcu.base, 'STM32F103');
    assert.equal(info.mcu.confidence, 'high', 'CMakeCache 宏 + 链接脚本 + 启动文件 = 10 分');
    assert.equal(info.hasToolchainConfig, true, 'CLion 内联 set(CMAKE_C_COMPILER) 应视为已配置工具链');

    assert.ok(
      info.foreignBuildDirs.some((d) => d.endsWith('cmake-build-debug')),
      'cmake-build-debug 应识别为外部构建目录（只读，不改动）',
    );
    assert.deepEqual(info.cmakeGenerators, ['Ninja']);
    assert.ok(
      info.artifacts.some((a) => a.path.endsWith('clion_stm32.elf')),
      'CLion 编译出的 ELF 应可被“烧录现有固件”发现',
    );
    assert.ok(info.linkerScripts.some((f) => f.endsWith('STM32F103C8Tx.ld')));
  } finally {
    cleanup(root);
  }
});

test('家族宏（-DSTM32G4xx）是家族级证据，不得据此确定精确型号', async () => {
  const root = makeTempDir();
  try {
    write(root, 'CMakeLists.txt', 'project(fam C)\nadd_compile_definitions(STM32G4xx)');
    write(root, 'Drivers/STM32G4xx_HAL_Driver/Src/stm32g4xx_hal.c', '');
    const info = await detectProject(root);
    assert.equal(info.mcu.family, 'STM32G4');
    assert.equal(info.mcu.base, '', '家族宏不能作为精确型号参与烧录门禁');
    assert.equal(info.mcu.model, '');
    assert.equal(info.mcu.confidence, 'low');
  } finally {
    cleanup(root);
  }
});

test('链接脚本命名兼容：_FLASH 后缀与 CLion 风格无后缀均可识别', async () => {
  const root = makeTempDir();
  try {
    write(root, 'CMakeLists.txt', 'project(ldnames C ASM)');
    write(root, 'STM32G431RBTX_FLASH.ld', '');
    write(root, 'ld/STM32F103C8Tx.ld', '');
    const info = await detectProject(root);
    const ldEvidence = info.mcu.evidence.filter((e) => e.source === 'linkerScript');
    const bases = new Set(ldEvidence.map((e) => e.base));
    assert.ok(bases.has('STM32G431'), 'CubeMX 风格 _FLASH 命名');
    assert.ok(bases.has('STM32F103'), 'CLion 风格无后缀命名');
  } finally {
    cleanup(root);
  }
});

test('家族 → CPU 编译选项推导（自愈缺失 -mcpu 的工程）', async () => {
  const { familyCpuFlags } = await import('../src/detection/stm32Detector');
  assert.equal(familyCpuFlags('STM32F1'), '-mcpu=cortex-m3 -mthumb');
  assert.equal(familyCpuFlags('STM32G4'), '-mcpu=cortex-m4 -mthumb');
  assert.equal(familyCpuFlags('STM32H7'), '-mcpu=cortex-m7 -mthumb');
  assert.equal(familyCpuFlags('STM32C0'), '-mcpu=cortex-m0plus -mthumb');
  assert.equal(familyCpuFlags('STM32L4'), '-mcpu=cortex-m4 -mthumb');
  assert.equal(familyCpuFlags('STM32MP1'), undefined, 'MP1 为 Cortex-A，不盲目注入');
  assert.equal(familyCpuFlags(''), undefined);
});

test('自愈工具链文件：包含原工具链、TRY_COMPILE 跳过、家族 CPU 选项', async () => {
  const { generateToolchainFileContent } = await import('../src/cmake/configure');
  const text = generateToolchainFileContent('C:\\ARM\\bin\\arm-none-eabi-gcc.exe', 'C:\\ARM\\bin\\arm-none-eabi-g++.exe', {
    cpuFlags: '-mcpu=cortex-m3 -mthumb',
    includeOriginalToolchain: 'D:\\cs\\cs\\cmake\\gcc-arm-none-eabi.cmake',
  });
  assert.ok(text.includes('include("D:/cs/cs/cmake/gcc-arm-none-eabi.cmake")'), '应保留工程原工具链设置');
  assert.ok(text.includes('set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)'));
  assert.ok(text.includes('CMAKE_C_FLAGS_INIT "${CMAKE_C_FLAGS_INIT} -mcpu=cortex-m3 -mthumb"'));
  assert.ok(text.includes('CMAKE_ASM_FLAGS_INIT'));
  assert.ok(text.includes('C:/ARM/bin/arm-none-eabi-gcc.exe'), '编译器用完整路径且正斜杠');

  // 不带可选参数时保持向后兼容
  const plain = generateToolchainFileContent('gcc', 'g++');
  assert.ok(plain.includes('set(CMAKE_SYSTEM_NAME Generic)'));
  assert.ok(!plain.includes('include('));
});

test('证据聚合：用户手动确认型号具有最高优先级', () => {
  const mcu = combineEvidence(
    [
      {
        source: 'halDriver',
        detail: 'Drivers/STM32G4xx_HAL_Driver',
        family: 'STM32G4',
        weight: 1,
      },
    ],
    'STM32G474RETx',
  );
  assert.equal(mcu.confirmedByUser, true);
  assert.equal(mcu.base, 'STM32G474');
  assert.equal(mcu.confidence, 'high');
});
