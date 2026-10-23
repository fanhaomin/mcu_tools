# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-10-23

### Added — 缺失 CPU 编译选项自愈（Trae 实测 d:\cs\cs 工程发现）
- 编译失败且日志命中 `selected processor does not support ...`（工程未提供 `-mcpu/-mthumb` 的典型症状）时，弹出模态确认：插件重新配置并自动补齐按芯片家族推导的 CPU 选项后重新编译。不会修改用户的 CMakeLists.txt；每个工程每次会话只提示一次。
- 家族 → 内核映射：F1/F2→cortex-m3，F3/F4/G4/L4/WB/WL→cortex-m4，F7/H7→cortex-m7，C0/G0/L0/U0→cortex-m0(+)/m0plus，H5/L5/U5→cortex-m33；MP1 等未知内核不盲目注入。
- 自愈/重试生成的工具链文件改为"补充式"：先 `include()` 工程原有工具链文件（如 CubeMX 的 `cmake/gcc-arm-none-eabi.cmake`）保留其设置，再用完整路径覆盖编译器，避免丢失原工具链携带的编译选项。
- 生成工具链文件时即按识别出的家族附带 CPU 选项（`CMAKE_*_FLAGS_INIT`，不覆盖工程自身选项）。
- 完整编译日志落盘移入 `buildProject` 内部，任何调用路径都会保留 `auto-cmake-flash-last-build.log`。

### Verified（真机）
- 夹具工程复现：无 `-mcpu` 时编译失败并命中症状 → 自愈补齐 `-mcpu=cortex-m3 -mthumb` → 重新配置编译成功。

## [0.2.0] - 2026-10-23

### Added — CLion STM32 工程互通
- 识别 CLion 默认构建目录 `cmake-build-debug`/`cmake-build-release`（只读，绝不改动），可发现并烧录其中编译出的 ELF（"烧录现有固件"）。
- 支持 CLion 模板的 CMakeLists 内联工具链写法（`set(CMAKE_C_COMPILER ...)`）——视为工程已配置工具链，不注入 `CMAKE_TOOLCHAIN_FILE`。
- 链接脚本命名兼容无 `_FLASH` 后缀的 CLion/社区模板风格（如 `STM32F103C8Tx.ld`）。
- 从 CLion 构建目录的 CMakeCache.txt 提取芯片宏与生成器作为识别证据。
- 跳过 `.idea` 元数据目录。
- 新增自愈路径：configure 因裸机交叉编译器默认链接测试失败（`is not able to compile a simple test program`）时，经用户确认后用插件工具链（含 `CMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY`）重试。
- CLion 风格工程真机验证：失败 → 确认重试 → Ninja 编译成功全链路通过。

### Fixed
- 芯片型号解析：家族宏（如 `-DSTM32G4xx`）不再被误解析为精确型号；家族级证据不参与烧录门禁的"型号已确定"判定，仍显示"芯片型号待确认"。

## [0.1.2] - 2026-10-23

### Fixed
- 工具链配置判定收紧：仅当 CMakeLists 实际执行 `set(CMAKE_TOOLCHAIN_FILE)` / `set(CMAKE_C/CXX_COMPILER)`，或工程内 `.cmake` 文件确实设置编译器时，才认为"工程已自带工具链配置"。此前仅凭文本中提及 `toolchain`/`arm-none-eabi` 字样即跳过工具链注入，导致 `No CMAKE_C_COMPILER could be found`。（Trae CN 实测 d:\cs\cs 工程发现）
- 编译器缺失时的自愈路径：configure 因 `No CMAKE_C(CXX)_COMPILER could be found` 失败且未注入工具链时，经用户模态确认后，插件生成指向已检测到 ARM GCC 的工具链文件、清理构建目录中的 CMake 缓存残留（CMakeCache.txt / CMakeFiles）并重试一次；不修改用户的 CMakeLists.txt。
- 误报"旧产物"修复：Ninja 判定无需重做时不会重写 ELF（mtime 不变），此前第二次编译后烧录会被误判为旧产物。现在构建记录会记录成功时刻定位的 ELF 路径，烧录门禁认可该产物。

## [0.1.1] - 2026-10-23

### Fixed
- 编译前"是否已配置"判定更严格：失败的 CMake 配置会残留含 `CMAKE_GENERATOR` 的 `CMakeCache.txt` 但没有 `build.ninja`/`Makefile`，此前会被误判为已配置而跳过配置、直接编译并报 `ninja: error: loading 'build.ninja'`。现在必须存在生成器对应的实际构建文件才视为已配置，缺失时自动先执行 CMake 配置。（Trae CN 实测发现）

## [0.1.0] - 2026-10-23

### Added
- STM32 工程自动识别（CMakeLists.txt / .ioc / Core / HAL / CMSIS / 启动文件 / 链接脚本 / 构建目录 / 固件产物）
- 多证据加权芯片型号推断，输出可信度；证据不足时显示"芯片型号待确认"并支持手动选择
- 工具链自动检测（cmake / ninja / arm-none-eabi-gcc|g++|objcopy|size / STM32_Programmer_CLI），版本命令确认与缺失建议
- CMake 配置（专用 build-auto 目录、不覆盖用户工程与构建目录、已有工具链时不注入 CMAKE_TOOLCHAIN_FILE、Ninja 缺失提示切换）
- 编译（并行、可取消、超时、编译错误写入问题面板、完整日志落盘与输出通道）
- 防误烧旧固件门禁（构建记录持久化 + 产物新鲜度校验）
- ST-LINK 检测（-l 探头列表）与目标连接预检（-c port=SWD）
- 烧录流程（模态确认、BIN 地址强制确认、下载 + 校验解析、复位、分级结果展示）
- 侧边栏 / 状态栏 / 输出通道 `Auto CMake Flash` / 命令面板 15 个命令
- 41 个自动化测试（无硬件依赖）与真机端到端验证脚本
