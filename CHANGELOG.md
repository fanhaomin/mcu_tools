# Changelog

All notable changes to this project will be documented in this file.

## [0.6.2] - 2026-10-24

### Fixed
- probe-rs `wireProtocol` 枚举变体大小写：传 `Swd`/`Jtag`（全小写报 unknown variant）。

## [0.6.1] - 2026-10-24

### Fixed
- probe-rs 0.32 不接受 `probe: "auto"`（选择器必须是 VID:PID 格式，否则报 Serialization error）：省略该字段即为自动选择第一个探针；需要指定探针时在设置中提供 VID:PID。

## [0.7.2] - 2026-10-24

### Changed — 只写寄存器的点阵位直接控制
- BSRR 等只写（write-only）寄存器的点阵位改为**直接控制按钮**：点 BSx = 对应引脚拉高，点 BRx = 拉低，点击后格子闪绿光确认已发送（只写寄存器读不回状态，结果看引脚 LED 板）。
- 普通 RW 寄存器的点阵保持原“读-改-写”翻转语义。

## [0.7.1] - 2026-10-24

### Fixed
- 外设下拉框点开即关闭：每 200ms 值刷新时重建了整个左栏（下拉框被销毁）——改为只更新寄存器行的文字节点，左栏结构仅在切换外设/搜索时重建。
- 移除右栏冗余的外设标题卡（外设名/基址已在左栏下拉框中）。

## [0.7.0] - 2026-10-24

### Changed — 外设面板全面重设计（双栏 · 位域点阵 · GPIO LED 状态板）
- 布局：左侧 1/4 为外设列表 + 当前外设寄存器列表（带实时小值）；右侧为选中寄存器内容卡 + GPIO 引脚 LED 状态板。
- GPIO 直观 IO 状态：16 个发光 LED 圆点对应 PIN0-15，实时反映引脚电平，**点 LED 直接翻转输出**。
- 位域点阵：选中寄存器按位渲染格子（位号 + 位域名 + 0/1 状态，按位域分色），RW 位**点击即翻转写回**；位域行显示枚举语义标签与当前值。
- 刷新固定 200ms（去掉间隔下拉框），probe-rs 引擎下旁路直读零停机零闪烁；运行监视按钮仅 cortex-debug 会话显示。
- 选中寄存器默认第一个；大号十六进制值直接编辑回车写入。

## [0.6.9] - 2026-10-24

### Changed
- probe-rs 引擎的调试会话中自动隐藏「运行监视」按钮（旁路直读无需微停机采样），cortex-debug 会话下正常显示。

## [0.6.8] - 2026-10-24

### Fixed — probe-rs 引擎下外设面板不再闪烁
- 根因：「运行监视」的微停机采样在 probe-rs 引擎下同样生效，每秒暂停芯片几十毫秒导致程序顿挫、调试状态闪烁。
- 改为：probe-rs 引擎下**纯旁路直读、绝不暂停**（probe-rs 支持运行中读内存，Keil 同机制）——LED 不再顿挫、调试状态栏不闪；读取失败的瞬间保留旧值。微停机采样仅保留给 cortex-debug 停机式引擎。

## [0.6.7] - 2026-10-24

### Added — probe-rs 电压闸门自动重试
- 兼容款 ST-LINK 的电压读数乱跳（0V↔6.3V），probe-rs 读到无效电压会直接拒绝启动调试。现在插件在启动调试前先用 `probe-rs info` 试探电压读数，读到无效值自动等待重试（6 次 × 1.2s），读到有效值才放行启动——把"碰运气"变成插件自动碰。
- 说明：标准版 probe-rs 没有关闭电压检测的开关（写死在 ST-Link 驱动里）；若需彻底绕过，需改源码重编译（需要 Rust 工具链）。

## [0.6.6] - 2026-10-24

### Changed — probe-rs 引擎只做调试，烧录回归 CubeProgrammer
- probe-rs 引擎的「编译并调试」改为：CubeProgrammer 烧录（已验证稳定，烧后不复位保持停机）→ probe-rs 以 attach 方式接管调试。probe-rs 不再执行擦除/烧写——其 Flash Loader 在本机 SWD 线路上不稳定（SwdApWdataError）。
- 烧录失败时明确提示并取消进入调试；附加成功后提示重启复位与运行方法。
- 用户要求：probe-rs 仅用于调试，其他场合（烧录）一律不用。

## [0.6.5] - 2026-10-24

### Fixed — 外设面板在 probe-rs 会话下读不到值
- 根因：面板会话获取只认 cortex-debug 类型（文件被外部改动回退），probe-rs 会话被过滤为"无会话"，所有读取直接短路。
- 改为插件自行跟踪引擎会话生命周期（启动/终止事件），不再依赖 activeDebugSession（多个或失效会话存在时它可能指向非引擎会话）。
- 已通过 DAP 层实测确认：probe-rs 运行中 readMemory、暂停、暂停后读取、恢复全部可用（scripts/dap-probe-test.js 为可复跑的实测脚本）。

## [0.6.0] - 2026-10-24

### Added — 双调试引擎（cortex-debug / probe-rs 可切换）
- 新设置 `autoCmakeFlash.debugEngine`：`cortex-debug`（默认，ST-LINK GDB Server 停机式）或 `probe-rs`（直连 DAP，Keil 式——目标运行中可直接读内存，外设面板零停机采样、零卡顿）。
- probe-rs 引擎：自动生成 `probe-rs-debug` 启动配置（芯片名按识别型号自动推导，如 STM32F103C8T6 → STM32F103C8；可用 `autoCmakeFlash.probeRsChip` 覆盖）；launch 时由调试会话烧写固件并复位停机；SVD 自动下发给 probe-rs（其自带外设视图也能用）；未安装扩展时引导一键安装。
- probe-rs 首次使用注意：扩展在首次调试时会自动下载 probe-rs 内核（需联网，一次性）；目标芯片须在 probe-rs 支持列表内（STM32 全系覆盖）。
- 外设面板同时支持两种引擎的调试会话（运行监视的微停机采样在 probe-rs 下通常用不上——直读即可）。
- 新增 4 个 probe-rs 配置生成测试；全量 73 个测试通过。

## [0.5.5] - 2026-10-24

### Fixed — 运行监视卡顿
- 读取改为按地址分组批量进行（相邻寄存器合并，单组一次 readMemory 往返）：微停机窗口从"每寄存器一次往返"的几百毫秒压缩到一至两次往返的几十毫秒，每秒采样对程序几乎无感。
- 面板不可见时自动停止采样，不再后台空转。

## [0.5.4] - 2026-10-24

### Fixed
- 运行监视恢复运行失败（"Cannot read properties of undefined (reading threadId)"）：GDB 在目标运行中列不出线程，此前在暂停前取线程 ID 导致 continue 收到空参数。现改为暂停后再取线程 ID（停机状态可靠）、带重试；取不到时保持暂停并在日志明确提示手动继续，绝不发送空参数。

## [0.5.3] - 2026-10-24

### Added — 运行监视（微停机采样）
- 外设面板新增「⏸ 运行监视」开关：程序**运行中**也能看寄存器值。原理与 Keil 相同——每次采样短暂暂停目标（几十毫秒）读取后立即恢复；默认关闭，开启后面板状态点变黄提示采样中。
- 说明：普通读取只在目标暂停（断点）时成功；运行中读取受 Cortex-M 停机式调试的硬件约束，微停机采样是该约束下与 Keil 一致的标准解法。

## [0.5.2] - 2026-10-24

### Changed
- 「外设寄存器」面板默认位置移到底部面板区（与终端/调试控制台并列的宽页签，ACF 调试），Keil/CLion 式布局；视图仍可随意拖拽到侧边栏或副侧边栏。

## [0.5.1] - 2026-10-24

### Fixed
- SVD 自动探测适配 STM32CubeIDE 官方安装器的嵌套布局（`STM32CubeIDE_x.y.zSTM32CubeIDEplugins...`），此前只查了平铺布局导致"未找到 SVD"。已在本机实测：定位 STM32F103.svd（11ms）→ 解析 61 个外设（67ms），GPIOA/RCC 寄存器与位域完整。

## [0.5.0] - 2026-10-24

### Added — 外设寄存器视图（SVD 解析 + 实时刷新，自研 Keil 风格面板）
- 侧边栏新增「外设寄存器」Webview 面板：识别到芯片型号后自动定位并解析对应 SVD，展开外设即实时读取寄存器值（可调 0.5s/1s/2s/手动刷新），寄存器与位域双层展示，位域带枚举语义标签（如 TXE=EMPTY）。
- 直接在面板里**写寄存器/位域**：值输入框回车即写（GDB `set`），位域走读-改-写；只读寄存器标记 RO 不可写。
- SVD 自动探测顺序：设置 `autoCmakeFlash.svdFile` → STM32CubeIDE 的 CMSIS 资源目录（本机 CubeIDE 自带全系列 SVD）→ Keil MDK DFP 包 → `C:\ST` 散置文件；文件名按基础型号（STM32F103.svd）优先、家族名（STM32F1xx.svd）回退。
- SVD 解析器为零依赖纯函数（支持 derivedFrom 派生外设、bitRange/bitOffset 双写法、枚举值），9 个新自动化测试。
- cortex-debug 仅作为后台调试引擎，此面板为插件自研界面——按用户希望的样式持续迭代。
- 已知限制：目标运行中（未暂停）时寄存器值读不到，显示 `…`，断在断点处即为准确值（与 Keil 相同的硬件约束）。

## [0.4.11] - 2026-10-24

### Fixed
- 输出面板自动滚动增强：编译/烧录/配置/调试**开始**时强制重新钉底（先隐藏再显示输出视图），即便面板停留在上次滚动的位置，新输出也会从头跟随；任务结束时再次钉底。任务进行中只要你停在底部就持续跟随（VS Code 规则），向上滚动可随时暂停阅读历史。

## [0.4.10] - 2026-10-24

### Changed
- .ioc 启动页视觉重设计：居中卡片布局、芯片图标、主题自适应配色（成功/警告/错误三态状态卡）、主次分级按钮。

## [0.4.9] - 2026-10-24

### Fixed — 多目标工程的编译/烧录目标一致性
- 选定目标后，构建记录优先锁定 `<目标名>.elf`（此前取"最新链接的 ELF"，多目标工程会误认到另一个目标的固件——例如选 cs_test 却记录 cs.elf）。
- 结尾不再重复整块内存占用表（已随 ninja 流式输出紧跟各自的目标链接行显示过）。
- 说明：目标选择为空时编译"全部"（CMake ALL）；选中后带 `--target <目标>` 只构建该目标及其公共依赖。

## [0.4.8] - 2026-10-24

### Changed
- 目标选择器精简：只列出工程的 CMake 目标（`add_executable` / `add_custom_target`），不再混入工作区工程切换项；已选目标时顶部提供「清除目标选择（编译全部）」；一个目标都没有时给出明确提示。

## [0.4.7] - 2026-10-24

### Added — 资源管理器中点 .ioc 直接用 STM32CubeMX 打开（CLion 行为）
- 注册 `.ioc` 自定义编辑器（`*.ioc`，默认优先）：在资源管理器中点击/双击 `.ioc` 文件即自动启动 STM32CubeMX 加载工程；页面内提供「重新启动」「用文本编辑器查看」按钮（找不到 CubeMX 时提供「打开设置」）。
- 资源管理器右键 `.ioc` 文件新增「在 STM32CubeMX 中打开 .ioc」菜单项（`resourceExtname == .ioc` 条件显示）。
- 探测路径补充：`%LOCALAPPDATA%\Programs\STM32CubeMX`（CubeMX 6.x 新版安装器的默认位置）。
- 想以文本方式查看 `.ioc`：右键文件 → 「打开方式...」→ 文本编辑器，或使用页面内的「用文本编辑器查看」。

## [0.4.6] - 2026-10-24

### Changed — 「打开 .ioc」现在像 CLion 一样在 STM32CubeMX 中打开
- 点击「打开 .ioc」按钮/命令改为启动 STM32CubeMX 并加载该 `.ioc`（分离启动、不阻塞编辑器；启动失败回退到编辑器打开）。
- 新增 STM32CubeMX 探测：设置 `autoCmakeFlash.cubemxPath` 优先 → 标准安装目录（Program Files）→ `C:\ST\STM32CubeMX_<版本>` 版本化目录（自动取最新版本）。注意 STM32CubeCLT 不包含 CubeMX（两者分开安装）。
- CubeMX 未安装/未找到时：模态提示并保留「在编辑器中打开」回退。
- 命令标题更新为「在 STM32CubeMX 中打开 .ioc」；插件内配置对话框新增 STM32CubeMX 路径项。

## [0.4.5] - 2026-10-24

### Added
- 「打开 .ioc 文件」按钮：面板标题栏（仅在工程检测到 .ioc 时显示，由 `autoCmakeFlash.hasIoc` 上下文键驱动）+ 工程分区的行入口 + 命令面板；点击在编辑器中打开检测到的 CubeMX `.ioc` 文件。

## [0.4.4] - 2026-10-24

### Fixed — 调试 "Error finishing flash operation (from target-download)"
- 调试配置新增 `stm32cubeprogrammer` 字段，钉死为检测到的 STM32CubeProgrammer bin 目录。此前 cortex-debug 会自行搜索 STM32CubeIDE 安装并把它内带的 CubeProgrammer 库喂给 CubeCLT 的 gdbserver——版本不配套时 gdb load 阶段即失败（连接/复位正常，仅下载失败，与实测症状一致）。
- 排查提示：如果调试会话的 gdbserver 启动行来自 `STLink-gdb-server\bin` 且 `-cp` 指向 STM32CubeIDE 插件目录，说明跑的不是插件生成的配置——请使用「编译并调试」命令（插件配置全部使用检测到的 CubeCLT 组件）。

## [0.4.3] - 2026-10-24

### Fixed
- 输出面板自动跟随最新内容：编译开始/结束、烧录开始/结束、配置与调试开始时强制刷新输出面板（VS Code 只有在视图位于底部时才自动滚动，用户滚过一次就停住；关键节点重新 show 让它回到最新行，1 秒节流）。

## [0.4.2] - 2026-10-24

### Fixed
- 目标选择器在普通（非开发模式）安装下抛 `CANNOT use API proposal: quickPickItemTooltip`：QuickPickItem.tooltip 是受限提案 API，改用稳定的 `detail` 字段承载工程路径。（0.3.4 的 JS 实现就带此问题，移植时一并修正）

## [0.4.1] - 2026-10-23

### Fixed — 恢复 0.3.x 期间只写入编译产物（out/*.js）而未同步回 TypeScript 源码的全部 UI 改进
0.3.3→0.3.4 期间的多次 UI 改进当时只改了 `out/*.js` 编译产物，`src/` 源码从未同步；任何一次重新编译都会让 UI "变回旧版"（ACF 状态项复活、目标选择器消失）。本版本把 v0.3.4 发布产物中的全部改动移植回源码，从此源码即真相：
- **工程/目标选择器**：状态栏最左侧「工程名·目标名」按钮（`autoCmakeFlash.chooseProject`），下拉列出 CMake 目标（扫描 `add_executable`/`add_custom_target`）与工作区工程，选中目标后编译只构建该目标（`cmake --build --target`），烧录优先 `<目标名>.elf`。
- **状态栏**：移除 ACF 状态摘要项，仅保留 工程/编译/烧录 三键；busy 时按钮转圈。
- **侧边栏**：图标改用 `ThemeIcon`（`iconPath`），修复树节点 label 中 `$(codicon)` 显示为字面文本的问题；行文案精简（工具链/工程文件汇总为一行，详情进 tooltip）；新增「调试」分组与 GDB/GDBServer 状态行。
- **日志精简**：编译输出带分隔横幅并实时流式显示，结束后只补一行摘要 + 内存占用表（`arm-none-eabi-size` / `--print-memory-usage` 两种格式）；输出通道时间戳移除；烧录成功时只保留关键信息行，连接失败才倒出完整原始输出；ST-LINK 检测成功不再倒原始输出。
- **插件内配置对话框**：`打开设置` 改为 QuickPick 交互式配置（保存到工作区设置），并新增 GDB / GDB Server / SVD 三项。
- 刷新按钮合并：`扫描工程` 一次完成工程识别 + 工具链 + ST-LINK 检测。
- 构建记录新增 `timedOut` 字段并在摘要中显示。

## [0.4.0] - 2026-10-23

### Added — 在线调试（cortex-debug 后端，调试层按后端抽象设计以支持后续其他芯片家族）
- 新命令「编译并调试」：编译成功后自动生成并启动 ST-LINK 调试会话（cortex-debug `servertype=stlink`：ST-LINK_gdbserver + arm-none-eabi-gdb，均随 STM32CubeCLT 安装），固件经 gdb load 写入并停在 `main`。此路径不使用 STM32CubeProgrammer，避免与调试器争抢 ST-LINK。
- 新命令「附加调试运行中的目标」：不重新编译、不写固件，直接连接运行中的目标。
- 调试配置全自动：ELF 路径、芯片型号、SWD/JTAG、gdb 与 GDB Server 路径均来自已有检测结果；可选 `svdFile` 设置启用外设寄存器视图。
- 工具链检测新增 2 个**可选**组件：`arm-none-eabi-gdb` 与 `ST-LINK_gdbserver`。可选组件不参与「环境完整」判定（仍是 7 个核心组件），缺失只影响调试；`armToolchainPath` 指向目录/`gcc.exe` 时自动推导 gdb 路径。
- 未安装 cortex-debug（marus25.cortex-debug）时引导一键安装；构建类型为 Release/MinSizeRel 时启动调试前提示无调试信息。
- 新设置：`autoCmakeFlash.gdbPath` / `gdbServerPath` / `svdFile`。
- `package.json` 首次声明 `autoCmakeFlash.*` 设置 schema（此前设置可用但不出现在设置 UI）。
- 架构：新增 `src/debug/` 层（纯函数配置生成 + VS Code API 分离），按「调试后端」组织——Cortex-M 家族（STM32/GD32/CH32 非 V）共用 cortex-debug 后端；RISC-V（CH32V）/ESP32 将来接入 cdt-gdb-vscode 通用 GDB 适配器 + 厂商 OpenOCD，新增后端并按芯片家族分发即可。
- 侧边栏新增「调试」分组与 gdb/GDB Server 状态行；状态栏支持「调试准备中」状态。
- 新增 10 个自动化测试（launch/attach 配置字段、CMakeCache 构建类型解析、可调试判定、调试工具可选性、gdb 路径推导）。

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
