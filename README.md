# Auto CMake Flash (STM32)

STM32 工程自动识别、CMake 配置编译、ST-LINK 烧录与校验一体化 VS Code / Trae 插件。

> **第一版仅支持 STM32。** 架构已按「检测器 / 编译器 / 烧录器」接口划分，便于后续扩展 GD32、CH32、ESP32 等平台（见文末扩展方案）。

## 功能总览

- **工程自动识别**：扫描工作区中的 `CMakeLists.txt`、CubeMX `.ioc`、`Core/Inc`、`Core/Src`、`Drivers/STM32xx_HAL_Driver`、`Drivers/CMSIS`、`startup_stm32xxxx.s`、链接脚本 `.ld`、已有构建目录与 `.elf/.hex/.bin` 产物。
- **芯片型号推断（多证据加权）**：综合 `.ioc`、编译宏 `-DSTM32xxxx`、CMakeLists、工具链文件、链接脚本名、启动文件名、HAL 目录。输出**型号 + 可信度（高/中/低）+ 证据列表**；证据不足时明确显示"芯片型号待确认"，可手动选择，绝不凭文件夹名虚构型号。
- **工具链自动检测**：`cmake` / `ninja` / `arm-none-eabi-gcc|g++|objcopy|size` / `STM32_Programmer_CLI.exe`。搜索顺序：用户设置 → 系统 PATH → STM32CubeCLT 默认目录。找到文件后**必须运行版本命令确认可用**，未找到时给出原因、搜索过的路径与安装建议。
- **CMake 配置**：只使用插件专用目录（默认 `build-auto`），不覆盖用户 CMakeLists.txt 与已有构建目录；工程已自带工具链配置（如 CubeMX 生成的 CMake 工程）时**不注入** `CMAKE_TOOLCHAIN_FILE`；Ninja 缺失时提示安装或切换生成器。
- **编译**：`cmake --build <build-auto> --parallel`，支持取消与超时；失败时解析编译器错误（文件:行:列）写入 VS Code 问题面板；完整日志落盘 `build-auto/auto-cmake-flash-last-build.log` 并记录到输出通道。
- **防误烧旧固件**：每次构建生成独立 `BuildRecord`（成功/失败、时间戳），持久化于 `build-auto/auto-cmake-flash.buildstate.json`。烧录前校验：最近一次构建**成功**且产物 mtime **晚于构建开始时间**，任一不满足即阻止。
- **ST-LINK 检测**：基于 `STM32_Programmer_CLI.exe -l`，严格区分「CLI 已安装」「检测到 ST-LINK 探头」「目标芯片可连接」三个层级。
- **烧录**：全程模态确认窗口（工程路径 / MCU 型号 / 烧录器与探头 / 目标连接状态 / 文件完整路径 / 格式 / BIN 地址 / 即将执行的操作），**每次烧录都必须用户确认，无法通过任何设置绕过**。BIN 文件必须确认烧录地址（设置或运行时输入）。
- **校验**：优先使用 STM32CubeProgrammer 的下载校验（`-v`），并**解析输出内容**判定校验状态；输出无法确认时如实显示"下载命令执行完成，校验状态未确认"，绝不把退出码 0 等同于校验成功。
- **界面**：侧边栏面板（工程/环境/构建/烧录四组状态 + 全部操作按钮）、状态栏、输出通道 `Auto CMake Flash`、通知与问题面板。

## 环境要求

| 组件 | 说明 |
| --- | --- |
| Windows 10 / 11 | 第一版面向 Windows 验证 |
| VS Code 或 Trae | `engines.vscode: ^1.85.0`（Trae CN 1.107 内核已验证可安装） |
| STM32CubeCLT | 一次安装即含 CMake、Ninja、GNU-tools-for-STM32、STM32CubeProgrammer CLI |
| Node.js 20+ | 仅构建/测试时需要 |

## 安装（VSIX）

```powershell
# VS Code
code --install-extension auto-cmake-flash-0.1.0.vsix
# Trae / Trae CN
& "$env:LOCALAPPDATA\Programs\Trae CN\Trae CN.exe" --install-extension auto-cmake-flash-0.1.0.vsix
```

安装后重新加载窗口，活动栏出现 **Auto CMake Flash** 图标；打开任意含 `CMakeLists.txt` 或 `.ioc` 的文件夹后插件会自动扫描。

## 快速开始

1. 打开 STM32 工程（CubeMX 导出的 CMake 工程或任意含 `CMakeLists.txt` 的工程）。
2. 侧边栏点击 **扫描工程** → 确认 MCU 型号与可信度。
3. 点击 **检测开发环境** → 确认 7 个组件全部就绪。
4. 点击 **编译工程**（或命令面板 `Auto CMake Flash: 配置 CMake` 后编译）。
5. 连接 ST-LINK 与目标板，点击 **编译并烧录** → 在模态窗口中核对信息 → **确认烧录**。

## 命令列表（命令面板搜索 "Auto CMake Flash"）

| 命令 | 说明 |
| --- | --- |
| 扫描工程与环境 | 识别工程结构、推断芯片型号、读取上次构建记录 |
| 检测开发环境 | 检测 7 个工具（路径 + 版本确认 + 缺失建议） |
| 检测 ST-LINK 连接 | 运行 `STM32_Programmer_CLI -l`，报告探头数量与序列号 |
| 配置 CMake | 在专用构建目录执行 `cmake -S -B -G ...` |
| 编译工程 | `cmake --build build-auto --parallel`，可取消 |
| 重新配置并编译 | 先配置后编译 |
| 编译并烧录 | 一次任务内完成编译→烧录门禁→确认→烧录 |
| 烧录现有固件 | 显式选择烧录已有产物（不要求本次构建，确认窗口显著提示） |
| 清理插件构建目录 | 仅 `build-auto`；非插件创建的目录需额外确认 |
| 打开构建目录 / 显示构建产物信息 / 定位 ELF 文件 | 资源管理器打开 / QuickPick 列表 / 系统文件管理器定位 |
| 手动选择芯片型号 | 证据不足时人工确认型号 |
| 查看日志 / 打开设置 | 输出通道 / 设置页 |

## 设置（`autoCmakeFlash.*`）

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `buildDir` | `build-auto` | 插件专用构建目录（相对工作区或绝对路径） |
| `buildType` | `Debug` | Debug / Release / RelWithDebInfo / MinSizeRel |
| `generator` | `Ninja` | CMake 生成器；Ninja 缺失时可改 `"MinGW Makefiles"` 等 |
| `cmakePath` / `ninjaPath` / `programmerCliPath` | 空 | 手动指定可执行文件完整路径 |
| `armToolchainPath` | 空 | ARM GCC 的 bin 目录或 `arm-none-eabi-gcc.exe` 完整路径 |
| `cmakeToolchainFile` | 空 | 可选自定义工具链文件 |
| `cmakeExtraArgs` | 空 | 追加的 CMake 配置参数（支持引号内空格） |
| `downloadInterface` | `SWD` | SWD / JTAG |
| `downloadSpeedKhz` | `4000` | 下载接口速度（kHz） |
| `resetAfterFlash` | `hardware` | hardware / software / none |
| `binFlashAddress` | 空 | BIN 烧录地址（如 `0x08000000`）；留空则烧录时询问 |
| `verboseLogging` | `false` | 详细日志 |
| `buildTimeoutSec` / `flashTimeoutSec` | `600` / `300` | 超时时间 |

> 涉及擦除、下载地址等高风险操作不会通过普通设置绕过安全确认。第一版不提供整片擦除。

## 芯片识别可信度规则

| 证据 | 来源 | 权重 |
| --- | --- | --- |
| `.ioc` 的 `Mcu.Name` | STM32CubeMX | 5 |
| 编译宏 `-DSTM32xxxx` | CMakeLists / 工具链文件 / CMakeCache | 4 |
| 链接脚本 `STM32xxx_FLASH.ld` | 根目录（Drivers 内权重 2） | 3 |
| 启动文件 `startup_stm32xxxx.s` | 工程目录 | 3 |
| CMakeLists 型号字符串 | 文本提及 | 2 |
| HAL 目录 `STM32G4xx_HAL_Driver` | 仅家族级 | 1 |

聚合规则：同一来源对同一型号只计一次；总分 ≥8 高、≥5 中、≥3 低；存在多个竞争型号时封顶为"中"并输出警告；只有家族级证据（如仅有 HAL 目录）时显示"芯片型号待确认"。

## STM32CubeProgrammer CLI 手动验证

插件使用的全部参数形式如下（均以参数数组传递给子进程，不经 shell）：

```powershell
$cli = "C:\ST\STM32CubeCLT_<版本>\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe"

& $cli --version                 # 版本确认（2.23.0 实测可用；不支持时自动回退 -l 头部解析）
& $cli -l                        # 列出已连接的 ST-LINK 探头
& $cli -c port=SWD freq=4000     # 目标连接预检（输出 Device ID / Device name / CPU）
& $cli -c port=SWD freq=4000 -d <固件.elf> -v        # 下载 ELF 并校验
& $cli -c port=SWD freq=4000 -d <固件.bin> 0x08000000 -v   # 下载 BIN（必须带地址）
& $cli -c port=SWD freq=4000 -rst hw                # 硬件复位（软件复位为 -rst sw）
```

已在本机 **STM32CubeProgrammer v2.23.0** 实测：`--version`、`-l`、`-c port=SWD freq=4000` 输出格式与插件解析器匹配。若你的版本输出不同，请先手动运行上述命令核对；解析器以"内容判定 + 原始输出留档"为原则，无法确认时显示"校验状态未确认"而不是谎报成功。

## 测试

自动化测试不依赖 VS Code 宿主与真实硬件（真实进程集成测试使用本机 cmd.exe 副本模拟"含空格路径的可执行文件"）：

```powershell
npm install
npm run compile
npm test          # tsc + node --test out/test/**/*.test.js
```

覆盖场景：CubeMX CMake 工程识别 / 普通 CMake 工程识别 / 芯片宏提取 / 链接脚本识别 / 工具链缺失及原因 / 版本命令失败 / 覆盖优先级 / 路径含空格（真实进程）/ ELF/HEX/BIN 识别与选择 / 构建失败阻止烧录 / 旧产物阻止烧录 / 型号不确定阻止烧录 / BIN 无地址阻止烧录 / 无 ST-LINK / 用户取消烧录 / 连接失败 / 下载失败 / 校验失败 / 校验未确认 / 成功路径参数与确认窗口内容。

需要真实硬件/工具链的验证项单独列出（见下"实机验证流程"），不在单元测试中依赖。

## 构建与打包

```powershell
.\build.ps1                  # install + compile + test + package
# 或分步执行
npm install
npm run compile
npm test
npm run package              # npx vsce package --allow-missing-repository --no-dependencies
```

产物：`auto-cmake-flash-0.1.0.vsix`。

## 实机验证流程（STM32CubeCLT + ST-LINK）

以下为本项目在实际机器上已执行的验证（环境：STM32CubeCLT 1.22.0，STM32CubeProgrammer 2.23.0，ST-LINK V2-37 连接 STM32F103C8T6 目标板）：

1. **工具链**：插件检测 7 个组件全部找到且版本确认（cmake 4.3.1 / ninja 1.13.2 / arm-gcc 14.3.1 / CubeProgrammer CLI 2.23.0）。
2. **工程识别**：对随附演示工程 `stm32f103-blink-demo` 识别出 `STM32F103`（链接脚本 + 编译宏 + 启动文件三重证据，高可信度）。
3. **配置与编译**：插件生成工具链文件 → `cmake -S -B build-auto -G Ninja` 成功 → `cmake --build` 成功产出 `blink.elf`。
4. **硬件预检**：`-l` 检测到 1 个 ST-LINK（SN 序列号解析正确）；`-c port=SWD freq=4000` 连接成功，正确解析 `Device ID 0x410 / Device name STM32F101/F102/F103 Medium-density / CPU Cortex-M3`。
5. **确认窗口**：流程在模态确认处停止，信息完整；选择取消后不执行任何写入。

完整脚本见 `scripts/e2e-real-check.js`（复现第 2-5 步，确认窗口模拟用户取消，**不会写芯片**）。

## 与 CLion STM32 工程互通

插件与 CLion 的 STM32 工程完全共存、互不干扰，并可直接复用 CLion 的构建结果：

- **构建目录隔离**：插件只使用 `build-auto`；CLion 的 `cmake-build-debug` / `cmake-build-release` 会被识别为"外部构建目录"，只读展示、绝不改动，扫描时还会在通知中说明。
- **复用 CLion 构建产物**："烧录现有固件"会同时扫描 `cmake-build-debug` 中的 `.elf/.hex/.bin`——CLion 里编译完，切到 VS Code/Trae 即可烧录（仍需确认窗口确认）。
- **CLion 模板 CMakeLists 兼容**：内联工具链写法（`set(CMAKE_C_COMPILER arm-none-eabi-gcc)`）会被识别为"工程已配置工具链"，插件不再注入 `CMAKE_TOOLCHAIN_FILE`，避免冲突；链接脚本兼容无 `_FLASH` 后缀的命名（如 `STM32F103C8Tx.ld`）。
- **CMakeCache 证据**：CLion 构建目录中的 `CMakeCache.txt`（含芯片宏、生成器）会作为芯片识别证据。
- **交叉编译器检查失败自愈**：若 CLion 模板未写 `CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY`，CMake 对裸机工具链的默认链接测试会失败（`compiler - broken`）。此时插件会弹窗征求同意，用插件生成的工具链文件（含该项设置）重试，不修改你的 CMakeLists.txt。
- **缺失 CPU 编译选项自愈**：编译报 `selected processor does not support 'wfe'/'cpsid i' in ARM mode` 说明工程没提供 `-mcpu/-mthumb`（常见于 CubeMX/CLion 转换工程）。插件会弹窗征求同意，生成保留工程原工具链设置、并按识别出的芯片家族自动补齐 CPU 选项的工具链文件（F1→cortex-m3、F4/G4/L4→cortex-m4、H7→cortex-m7 等），重新配置并编译。
- **`.idea` 目录**被忽略，不参与识别与产物扫描。
- 在 CLion 与 VS Code/Trae 之间切换无需任何配置：两边各自使用独立构建目录，共享同一份源码。

## 已知限制

1. **烧录与校验的实机执行**：在本验证环境中流程止步于确认窗口（避免未经用户指示改动开发板内容）。`-d ... -v` 的真实下载在你的板上首次执行时，请先在日志中核对 CubeProgrammer 输出；若版本输出与解析器假设不同，插件会显示"校验状态未确认"而非误报。
2. `-rst hw|sw` 复位参数基于 UM2237 文档实现；如你的 CLI 版本不支持，请将 `resetAfterFlash` 设为 `none` 并手动复位（日志中会保留完整命令与退出码便于定位）。
3. 外部程序输出按 UTF-8 解码；若工具输出本地化中文（GBK），日志中可能显示乱码，不影响退出码与英文关键字解析。
4. 未实现：整片擦除、GD32/CH32/ESP32、Option Bytes 操作、多板协同。`startup/.ld` 模板目录（CMSIS Templates、MDK-ARM、EWARM）被排除在证据之外，避免模板文件造成型号误判。
5. BIN 烧录地址仅做格式校验（`0x` + 16 进制），不校验该地址是否落在芯片合法 Flash 区域 —— 请在确认窗口中自行核对。

## 后续扩展方案

`detection/`、`cmake/`、`flash/` 三层均面向接口实现：

- **GD32 / CH32**：`stm32Detector.ts` 的家族表与 `toolchainDetector.ts` 的默认目录表加入对应家族前缀与厂商工具链目录；烧录后端接入 OpenOCD（`flash/programmer.ts` 增加 `OpenOcdBackend` 实现同一 `performFlash` 流程）。
- **ESP32**：`toolchainDetector` 增加 `idf.py` 检测器；`flash/` 增加 `EsptoolBackend`（`esptool.py write_flash`），确认窗口与门禁逻辑复用。
- **烧录后端抽象**：`Stm32CubeProgrammerCli` 与 `performFlash(deps)` 已经把"探测/连接/下载/校验/复位"建模为可替换步骤，新后端只需提供相同签名的方法。

## 目录结构

```text
auto-cmake-flash/
├── package.json / tsconfig.json / .vscodeignore / build.ps1
├── src/
│   ├── extension.ts            # 命令注册、并发控制、装配
│   ├── types.ts                # 共享类型（不依赖 vscode）
│   ├── util/                   # process(安全子进程) / logger / path
│   ├── detection/              # projectDetector / stm32Detector / toolchainDetector / stlinkDetector
│   ├── cmake/                  # configure / build / artifacts(产物与烧录门禁)
│   ├── flash/                  # stm32CubeProgrammer(CLI) / verification(解析) / programmer(流程)
│   ├── ui/                     # sidebar / statusBar / confirmation
│   └── config/settings.ts
├── test/                       # node:test 单元/集成测试（无硬件依赖）
├── scripts/e2e-real-check.js   # 真机端到端验证脚本（止步于确认窗口）
└── resources/                  # 侧边栏图标
```
