# Embedded Debug (STM32)

> 原「Auto CMake Flash」——扩展标识不变，老版本可直接升级，设置与工作区数据无需迁移。

STM32 工程自动识别、CMake 编译、ST-LINK 烧录、在线调试与实时监控一体化的 VS Code / Trae 插件。

从「打开工程」到「看变量波形」只需侧边栏按钮：**扫描工程 → 检测环境 → 编译 → 烧录 / 调试**。所有调试数据（外设寄存器、变量、内存）来自标准 DAP 接口与 ELF/DWARF 离线解析，不侵入固件、不需要在代码里埋任何打印。

> 当前版本仅支持 STM32（Cortex-M）。架构按「检测器 / 编译器 / 烧录器 / 调试后端」接口划分，便于后续扩展 GD32、CH32、ESP32 等平台。

## 功能总览

### 工程与构建
- **工程自动识别**：扫描 `CMakeLists.txt`、CubeMX `.ioc`、`Core/Inc`、`Core/Src`、HAL/CMSIS 目录、启动文件、链接脚本与已有构建产物。
- **芯片型号推断（多证据加权）**：综合 `.ioc`、编译宏、CMakeLists、链接脚本名、启动文件、HAL 目录输出**型号 + 可信度（高/中/低）+ 证据列表**；证据不足时明确显示"芯片型号待确认"，可手动选择，绝不虚构型号。
- **工具链自动检测**：cmake / ninja / arm-none-eabi-gcc 系 / STM32_Programmer_CLI / arm-none-eabi-gdb / ST-LINK_gdbserver，搜索顺序：用户设置 → 系统 PATH → STM32CubeCLT 默认目录；找到后运行版本命令确认可用。
- **CMake 配置与编译**：构建目录为两级结构 `build/<构建类型>`（Debug → `build/Debug`），不污染工程；失败时解析编译器错误写入问题面板；支持取消与超时。
- **编译自愈**：交叉编译器检查失败（`compiler - broken`）、缺 `-mcpu/-mthumb` 等 CLion/CubeMX 转换工程常见问题，弹窗征求同意后用插件生成的工具链文件重试，不改你的 CMakeLists.txt。

### 烧录
- **防误烧旧固件**：烧录前校验最近一次构建**成功**且产物比构建开始时间新，任一不满足即阻止。
- **ST-LINK 检测**：基于 `STM32_Programmer_CLI -l`，区分「CLI 已安装 / 检测到探头 / 目标可连接」三层。
- **全程模态确认**：每次烧录弹出确认窗口（工程 / MCU / 探头 / 固件路径 / 格式 / BIN 地址 / 操作），**无法通过任何设置绕过**。
- **校验**：使用 CubeProgrammer `-v` 并解析输出判定校验状态；无法确认时如实显示"校验状态未确认"，绝不把退出码 0 当校验成功。

### 调试
- **probe-rs 引擎**（旁路直读）：支持**程序运行中**实时读内存/寄存器，不打断目标；烧录走 CubeProgrammer 链路，调试会话 attach 接管。
- **会话管理**：调试会话按 `调试器 工程名 · 引擎 · 模式` 命名，可区分多个会话；启动新调试前自动清理插件残留会话（探针独占）。
- **构建类型检查**：Release/MinSizeRel（ELF 无调试信息）启动调试前提示确认。
- **调试面板四个视图**（详见下节）：外设寄存器 / 变量监控 / 波形 / 内存视图，未调试时统一显示「未在调试中」遮罩。

## 调试面板（底部「调试器」）

### 外设寄存器
- 加载芯片 SVD（设置 `svdFile` 或按型号自动定位）后展示外设 → 寄存器树，实时刷新值。
- 寄存器详情：十六进制值输入框（回车写回）、**位域图**（按 SVD 描述分组命名，可点击翻转 bit 写入）、GPIO 外设提供 **LED 点灯面板**（点击引脚翻转输出电平）。
- 值变化的寄存器/位域高亮闪烁，一眼看出谁在动。

### 变量监控
- **ELF/DWARF 离线解析**：用 `arm-none-eabi-readelf` 解析调试信息，拿到全局/静态变量的名字、类型、地址、大小——不占目标资源、不依赖 gdb。
- **支持类型**：整数（8/16/32/64 位有/无符号）、浮点、布尔、枚举（显示枚举名）、指针、**多维数组（嵌套展开，点哪层展开哪层，不拍平成一维）**、结构体（成员偏移解码）。
- **添加方式**：面板输入框直接填变量名（支持 `数组[下标].成员` 路径）；**编辑器里选中变量右键 →「添加到变量监控」**；「浏览」对话框可搜索/多选 ELF 全部变量；打断点时局部变量自动捕获。
- **右键变量菜单**：
  - **指针可解引用**：展开指针行按 DWARF 被指类型读目标内存——`char*` 直接显示字符串（NUL 截止）、`结构体*` 展开成员、`uint8_t*` 看元素；NULL 指针如实显示，支持多级指针嵌套。
- **显示格式**：自动 / 十进制 / 十六进制 / **同时显示（10 = 16）** / 二进制 / **字符**，随条目持久化；
  - **设置值**：修改变量值（标准 writeMemory，两种引擎都可用）；
  - **移除**。
- **表格化显示**：变量名 | 当前值 | 数据类型 | 地址，按 DWARF 类型着色（整数蓝 / 浮点琥珀 / 枚举紫 / 指针青 / 布尔绿），值变化闪烁提示。
- **存在性门禁**：ELF 里查无此名（已删除/未编译）或 **DWARF 地址为 0（被优化消除/未实例化）** 的变量，值列红色「不在 ELF 中」并停止读取——绝不显示旧地址的脏值；重编译后符号恢复自动解除标红。开调试、添加变量、重编译后各核验一次，读取周期内不重复判定。
- **性能**：增量刷新——只有变化的单元格更新 DOM，不整表重绘；列宽可拖拽调整（双击表头复位）。

### 波形
- 以 canvas 绘制实时曲线，**变量来源由面板顶部「变量 ▾」下拉框选择**（多选，最多 8 条曲线，8 色区分）。
- 工具栏：时间窗口（10s / 30s / 60s / 全部）、暂停、清空、锁定 Y 轴；Y 轴刻度自适应边距。
- 只能勾选标量类型（整数/浮点/布尔）；数组/结构体展开后的叶子成员也可勾选。

### 内存视图
- 按地址实时显示内存内容：回车跳转地址、滚轮逐行 / Shift+滚轮整页、**右侧拖动滚动条快速跳转**（一次拖动覆盖 ±32KB）。
- **点击字节格即可编辑写回**（支持 8/16/32 位写入），颜色标识：琥珀 = 程序修改、绿 = 手动修改。
- probe-rs 引擎运行中直接旁路读，不停机。

### 调用栈
- 目标**停机时（断点/手动暂停）自动显示**完整调用栈：帧号 / 函数 / 文件:行 / PC，栈顶帧高亮。
- 运行中对目标**零干扰**：不主动停机、不读取（读调用栈必须停机，保持只在自然停机时显示）。

### 反汇编
- **源码 ↔ 汇编混合显示**（Keil Mixed Source/Assembly 风格）：`objdump -d -S -l` 离线解析，源码行交错标注在对应指令上方。
- 目标停机时**自动定位到栈顶 PC**：当前指令高亮（▶ + 蓝底）并滚动到视口中央，断点所在源码行淡绿标示。
- 点击源码行直接跳转编辑器对应位置；单步时随 PC 自动刷新（超长函数只显示 PC 前后窗口）。

## 界面布局

| 位置 | 内容 |
| --- | --- |
| 活动栏「Embedded Debug」 | 工程与环境面板：工程/MCU/工具链/ST-LINK 状态 + 全部操作按钮 |
| 底部「调试器」面板 | 外设寄存器 / 变量监控 / 波形 / 内存视图 / 调用栈 / 反汇编 六个功能 |
| 编辑器标签页 | 「Embedded Debug 配置」设置面板（卡片分组，保存到当前工程的工作区设置） |
| 状态栏 | 当前工程 / 构建类型 / 调试状态快捷入口 |
| 输出通道 | `Embedded Debug`，详细日志（verboseLogging 开启后更全） |

> 如果调试面板出现多个重复的「调试器」分组，是旧版本拖拽视图留下的位置记录，执行命令面板「视图： 重置视图位置」即可恢复。

## 快速开始

1. 打开 STM32 工程（CubeMX 导出的 CMake 工程或任意含 `CMakeLists.txt` 的工程）。
2. 侧边栏点击 **扫描工程** → 确认 MCU 型号与可信度。
3. 点击 **检测开发环境** → 确认组件全部就绪。
4. 点击 **编译工程**。
5. 连接 ST-LINK 与目标板，点击 **编译并烧录** → 确认窗口核对 → **确认烧录**。
6. 调试：点击 **编译并调试**（停在 `main`）；打开底部「调试器」面板查看外设/变量/波形/内存。

## 命令列表（命令面板搜索 "Embedded Debug"）

| 命令 | 说明 |
| --- | --- |
| 扫描工程与环境 | 识别工程结构、推断芯片型号、读取上次构建记录 |
| 检测开发环境 / 检测 ST-LINK 连接 | 工具链检测（路径 + 版本确认）/ 探头列表 |
| 配置 CMake / 编译工程 / 重新配置并编译 | CMake 配置与构建，可取消 |
| 编译并烧录 / 烧录现有固件 | 编译→门禁→确认→烧录 / 显式烧录已有产物 |
| 编译并调试 | 编译后启动调试会话（probe-rs） |
| 附加调试运行中的目标 | 不重新编译、不写固件，连接运行中的芯片 |
| 添加到变量监控 | 编辑器右键（选中变量后），加入实时监控 |
| 浏览 ELF 变量并添加监控 | 搜索/多选 ELF 中全部全局/静态变量 |
| 手动选择芯片型号 | 证据不足时人工确认 |
| 清理插件构建目录 / 打开构建目录 / 显示构建产物信息 / 定位 ELF | 构建目录管理 |
| 在 STM32CubeMX 中打开 .ioc | 快捷跳转 CubeMX |
| 查看日志 / 打开设置 | 输出通道 / Embedded Debug 配置面板 |

## 设置（`autoCmakeFlash.*`）

设置保存在**当前工程**的 `.vscode/settings.json`（工作区文件夹级），推荐用「Embedded Debug 配置」面板修改。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `buildDir` | `build/${buildType}` | 构建目录（两级结构，如 `build/Debug`） |
| `buildType` | `Debug` | Debug / Release / RelWithDebInfo / MinSizeRel |
| `generator` | `Ninja` | CMake 生成器 |
| `cmakeToolchainFile` / `cmakeExtraArgs` | 空 | 自定义工具链文件 / 额外配置参数 |
| `cmakePath` / `ninjaPath` / `programmerCliPath` / `armToolchainPath` / `cubemxPath` | 空 | 工具路径，留空自动探测 |
| `probeRsChip` | 空 | probe-rs 芯片名（如 `STM32F103C8`），留空按识别型号推导 |
| `svdFile` | 空 | SVD 文件路径，外设寄存器视图用 |
| `debugRefreshMs` | `200` | 调试面板刷新间隔（50-5000ms） |
| `downloadInterface` / `downloadSpeedKhz` | `SWD` / `4000` | 烧录/调试接口与速度 |
| `resetAfterFlash` | `hardware` | 烧录后复位：hardware / software / none |
| `binFlashAddress` | 空 | BIN 烧录地址（烧 ELF/HEX 留空） |
| `verboseLogging` | `false` | 详细日志 |
| `buildTimeoutSec` / `flashTimeoutSec` | `600` / `300` | 编译/烧录超时（秒） |

## 环境要求

| 组件 | 说明 |
| --- | --- |
| Windows 10 / 11 | 面向 Windows 验证 |
| VS Code 或 Trae | `engines.vscode: ^1.85.0`（Trae CN 已验证） |
| STM32CubeCLT | 一次安装即含 CMake、Ninja、GNU-tools-for-STM32、STM32CubeProgrammer |
| Embedded Debug（probe-rs）扩展 | 调试用，首次使用时引导安装 |

## 安装（VSIX）

```powershell
# VS Code
code --install-extension auto-cmake-flash-<版本>.vsix
# Trae / Trae CN（应用运行中 CLI 可能静默失败，先关闭 Trae）
& "$env:LOCALAPPDATA\Programs\Trae CN\bin\trae-cn.cmd" --install-extension auto-cmake-flash-<版本>.vsix
```

安装后重新加载窗口，活动栏出现 **Embedded Debug** 图标；打开含 `CMakeLists.txt` 或 `.ioc` 的文件夹后自动扫描。

## STM32CubeProgrammer CLI 手动验证

插件使用的全部参数形式（均以参数数组传递给子进程，不经 shell）：

```powershell
$cli = "C:\ST\STM32CubeCLT_<版本>\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe"

& $cli --version                 # 版本确认
& $cli -l                        # 列出已连接的 ST-LINK 探头
& $cli -c port=SWD freq=4000     # 目标连接预检
& $cli -c port=SWD freq=4000 -d <固件.elf> -v        # 下载 ELF 并校验
& $cli -c port=SWD freq=4000 -d <固件.bin> 0x08000000 -v   # 下载 BIN（必须带地址）
& $cli -c port=SWD freq=4000 -rst hw                # 硬件复位
```

解析器以"内容判定 + 原始输出留档"为原则，无法确认时显示"校验状态未确认"而不是谎报成功。

## 与 CLion STM32 工程互通

- **构建目录隔离**：插件只用 `build/<类型>`；CLion 的 `cmake-build-*` 被识别为外部构建目录，只读展示、绝不改动。
- **复用 CLion 产物**："烧录现有固件"会同时扫描 `cmake-build-debug` 中的产物（仍需确认窗口确认）。
- **模板 CMakeLists 兼容**：内联工具链写法被识别为"工程已配置工具链"，不再注入 `CMAKE_TOOLCHAIN_FILE`；CMakeCache 作为芯片识别证据。
- **自愈**：交叉编译器检查失败、缺 CPU 选项（`-mcpu/-mthumb`）时弹窗征求同意，生成补齐选项的工具链文件重试。
- CLion 与 VS Code/Trae 之间切换无需任何配置：各自独立构建目录，共享同一份源码。

## 测试

```powershell
npm install
npm run compile
npm test          # tsc + node --test，101 个用例，无硬件依赖
```

覆盖：工程识别 / 芯片宏与可信度 / 工具链检测与缺失原因 / 路径含空格（真实进程）/ ELF/HEX/BIN 选择 / 构建失败与旧产物阻止烧录 / BIN 无地址阻止 / 连接与校验失败路径 / DWARF 解析（真实 readelf 输出夹具：标量/数组/多维/结构体/枚举/指针/typedef）等。

## 构建与打包

```powershell
npm run compile
npm test
npx @vscode/vsce package --no-dependencies --allow-missing-repository
```

## 已知限制

1. `-rst hw|sw` 基于 UM2237 实现；如 CLI 版本不支持，将 `resetAfterFlash` 设为 `none` 并手动复位。
2. 外部工具输出按 UTF-8 解码；本地化中文（GBK）输出可能乱码，不影响退出码与英文关键字解析。
3. BIN 烧录地址仅做格式校验，不校验是否落在合法 Flash 区域——请在确认窗口自行核对。
4. 变量监控依赖 ELF 调试信息：Release/MinSizeRel 构建无 DWARF，变量不可解析（调试前会提示）。
5. 未实现：整片擦除、Option Bytes 操作、GD32/CH32/ESP32、多板协同。

## 后续扩展方案

`detection/`、`cmake/`、`flash/`、`debug/` 四层均面向接口实现：

- **GD32 / CH32**：家族表加入前缀与厂商工具链目录；烧录后端接入 OpenOCD（实现同一 `performFlash` 流程）。
- **ESP32**：`toolchainDetector` 增加 `idf.py`；`flash/` 增加 `EsptoolBackend`，确认窗口与门禁逻辑复用。
- **调试后端抽象**：Cortex-M 家族走 probe-rs 后端；RISC-V 将来接入 cdt-gdb-vscode + 厂商 OpenOCD，只需新增后端并按家族分发。

## 目录结构

```text
auto-cmake-flash/
├── package.json / tsconfig.json / .vscodeignore / build.ps1
├── src/
│   ├── extension.ts            # 命令注册、并发控制、会话管理、装配
│   ├── types.ts                # 共享类型（不依赖 vscode）
│   ├── util/                   # process(安全子进程) / logger / path
│   ├── detection/              # projectDetector / stm32Detector / toolchainDetector / stlinkDetector
│   ├── cmake/                  # configure / build / artifacts(产物与烧录门禁)
│   ├── flash/                  # stm32CubeProgrammer(CLI) / verification / programmer
│   ├── debug/                  # dwarf.ts（ELF/DWARF 变量目录解析与类型化解码）
│   ├── ui/                     # sidebar / statusBar / confirmation / configPanel
│   │                           #  periphView（外设）/ watchView（变量）/ chartView（波形）/ memView（内存）
│   └── config/                 # settings / workspaceSettings（工程级设置读写与遗留清理）
├── test/                       # node:test 单元/集成测试（含 DWARF 夹具，无硬件依赖）
├── scripts/e2e-real-check.js   # 真机端到端验证脚本（止步于确认窗口，不写芯片）
└── resources/                  # 图标
```

## 版本记录

版本变更记录见 CHANGELOG.md。
