# Changelog

All notable changes to this project will be documented in this file.

## [0.8.8] - 2026-10-24

### Fixed
- 修复移除顶部工具条时误删了两栏布局容器（#main）的开标签，导致面板塌成单列竖排：已恢复，左 1/4 寄存器列表 + 右侧详情的横向布局回来。

## [0.9.1] - 2026-10-24

### Changed — 内存视图大区域支持（增量渲染）
- 单区域上限从 4096B 提升到 **16KB**（此前输入更大值会被静默截断——现在会弹提示说明）。
- 渲染改为增量式：表格结构只在添加/删除区域时重建，数值刷新只更新文本变化的单元格——16KB（约 1.6 万格）每 50ms 刷新也不会卡。
- 超限/超量提示改为面板内 toast；读取失败的卡片半透明标识。

## [0.9.0] - 2026-10-24

### Added — 变量监控 + 内存视图（底部面板两个新窗口）
- 「变量监控」：添加变量名/表达式（如 uwTick、&结构体字段、0x20000000），自动解析地址与大小（&expr + sizeof）后按内存实时读取；每条目独立显示地址/字节数/实时值；刷新可选 50/100/200/500ms；条目持久化（每工程独立，最多 16 个）。
- 「内存视图」：添加地址区间（16-4096B，默认 256B）后以 hexdump 展示（地址 + 16 列字节 + ASCII）；**点击任意字节格直接编辑写回**（高亮已修改字节）；刷新可选 50/100/200/500ms；区域持久化（最多 8 个）。
- 双引擎适配：probe-rs 运行中旁路直读（50ms 也可流畅）；cortex-debug 自动微停机采样（暂停→读取→恢复）。
- 与外设面板并列于底部「ACF 调试」面板，三者共享 200ms 级会话与设计语言。
- 关于 100Hz：SWD 单次读取往返即 1-5ms 加 DAP 开销，10ms/轮物理不可达；面板提供 50ms（20Hz）档，为实际可达上限，probe-rs 引擎下已足够流畅。

## [0.8.7] - 2026-10-24

### Changed — 外设面板移除顶部工具条
- 移除过滤框 / 状态行 / 刷新与运行监视按钮：面板直接从寄存器列表开始，始终 200ms 自动刷新。
- cortex-debug 引擎的微停机采样改为自动启用（仅在目标运行中且读取失败时短暂暂停采样，probe-rs 引擎本就是旁路直读不受影响）。
- 会话断开时自动清空旧值显示。

## [0.8.6] - 2026-10-24

### Added — 状态栏构建类型选择按钮
- 状态栏新增构建类型按钮（编译与烧录之间）：显示当前类型（Debug 等），点击弹出 Debug / Release / RelWithDebInfo / MinSizeRel 选择，写入当前工程工作区设置。
- 切换类型后构建目录自动跟随（cmake-build-debug ↔ cmake-build-release），与 CLion 多类型目录行为一致；刷新即时生效。

## [0.8.5] - 2026-10-24

### Changed
- 面板标题栏精简为 4 个按钮：编译 / 烧录 / 调试 / 刷新。「打开 .ioc」从标题栏移除（入口保留：侧边栏工程分组、资源管理器点开 .ioc、右键菜单、命令面板）。

## [0.8.4] - 2026-10-24

### Fixed
- 配置面板不再横向分栏（此前 viewColumn=Beside 会把编辑器劈成两栏）：改为在当前编辑器栏直接打开，标题栏可随时切回代码文件。

## [0.8.3] - 2026-10-24

### Changed — 配置面板改为编辑器内表单页
- 「打开配置面板」不再弹顶部下拉选择器：改为在编辑器区域打开一个配置标签页（与外设面板同一设计语言），卡片分组的表单界面——构建 / 烧录 / 调试 / 工具路径 / 高级五组。
- 顶部「保存」一次性写回所有修改项到当前工程工作区设置；「全部恢复默认」一键清空自定义值；字段留空 = 恢复默认。
- 只保存有变化的项，日志记录每一项变更。

## [0.8.2] - 2026-10-24

### Changed — 配置入口收敛到插件自己的面板
- 侧边栏新增「配置」分组：「打开配置面板」（交互式设置：构建/烧录/调试引擎/路径/超时，保存到当前工程工作区）与「切换调试引擎」一键切换（cortex-debug ↔ probe-rs）。
- 配置面板新增「调试引擎」「probe-rs 芯片名」两项。
- 移除 package.json 的 VS Code 设置页声明（contributes.configuration）：autoCmakeFlash.* 不再出现在 VS Code 设置 UI，全部通过插件配置面板管理。已有的 settings.json 值仍然生效。

## [0.8.1] - 2026-10-24

### Fixed — 默认构建目录两处关键修正
- settings.ts 默认值曾被转义问题截断为 'cmake-build-'（无类型段）：已恢复完整 'cmake-build-'。
- 小写化正则要求 cmake-build- 前必须有路径分隔符，相对路径默认值不匹配导致 cmake-build-Debug 保持大写：分隔符改为可选，相对/绝对路径均正确小写。
- 已用脚本（scripts/verify-builddir.js）固化验证：Debug → cmake-build-debug、Release → cmake-build-release。

## [0.8.0] - 2026-10-24

### Changed — 构建目录与产物命名全面对齐 CLion 风格（去掉 auto）
- 默认构建目录：`build-auto` → `cmake-build-${buildType}`（${buildType} 自动小写：Debug → `cmake-build-debug`，Release → `cmake-build-release`）。与 CLion 共用同名目录：CLion 先建过则复用（弹确认），其 CMakeCache 证据与固件产物照常发现。
- 构建目录内文件改名：`auto-cmake-flash-last-build.log` → `last-build.log`；`auto-cmake-flash.buildstate.json` → `buildstate.json`。
- projectDetector：`cmake-build-*` 归类为插件构建目录（不再视为外部只读目录）。
- 状态栏新增「调试」按钮（烧录右侧），busy 时转圈。
- 升级注意：旧 `build-auto` 目录不会自动迁移/删除，可手动删除；首次构建会在新目录重新 configure。

## [0.7.12] - 2026-10-24

### Added
- 状态栏新增「调试」按钮（烧录右侧）：一键编译并调试，busy 时转圈。

## [0.7.11] - 2026-10-24

### Changed
- 左栏寄存器列表的实时值放大加粗并使用主题蓝色，一眼可辨。

## [0.7.10] - 2026-10-24

### Fixed — LED 板消失与数值不刷新的总根源
- buildBits() 中残留已移除的位域明细代码（引用未定义变量），每次渲染到该处即抛异常，导致后续 buildLeds()、bindDetail()、updateVals() 全部跳过——LED 板空白、寄存器值不刷新、位域点阵冻结均由此而来。已删除残留代码。

## [0.7.9] - 2026-10-24

### Fixed
- 面板会话跟踪加固：窗口重载时自动认领已在运行的调试会话（此前要等新会话事件），跟踪 activeDebugSession 切换；tick 不再被过时的会话标志阻断。

## [0.7.8] - 2026-10-24

### Changed
- 点阵格子统一 46×46 正方形，位域名完整显示不再裁切。

## [0.7.7] - 2026-10-24

### Fixed
- 点阵格子统一固定等宽（此前随内容伸缩导致大小不一），超宽位域名自动裁切、悬停看全名。

## [0.7.6] - 2026-10-24

### Changed
- 位域明细行整个移除（AFSEL/PUPD 等重复信息）：寄存器内容 = 点阵 + 大号值，位域语义保留在格子内与悬停提示中。
- 点阵间距收紧。

## [0.7.5] - 2026-10-24

### Changed
- 点阵格子 hover 提示"点击翻转 bit N 并写入"；16 列点阵网格。

## [0.7.4] - 2026-10-24

### Changed
- 寄存器点阵固定 16 列网格：上行 31-16（高半字）、下行 15-0（低半字）。

## [0.7.3] - 2026-10-24

### Changed
- ODR/IDR/BSRR 这类"一脚一位、无枚举"的寄存器不再显示重复的位域明细行（信息已在 LED 板与位点阵中）；仅当寄存器含多位字段或枚举语义时显示明细与输入框。

## [0.7.2] - 2026-10-24

### Changed — 只写寄存器的点阵位直接控制
- BSRR 等只写（write-only）寄存器的点阵位改为直接控制按钮：点 BSx = 对应引脚拉高，点 BRx = 拉低，点击后格子闪绿光确认已发送。
- 普通 RW 寄存器的点阵保持"读-改-写"翻转语义。

## [0.7.1] - 2026-10-24

### Fixed
- 外设下拉框点开即关闭：每 200ms 值刷新时重建了整个左栏（下拉框被销毁）——改为只更新寄存器行的文字节点。
- 移除右栏冗余的外设标题卡。

## [0.7.0] - 2026-10-24

### Changed — 外设面板全面重设计（双栏 · 位域点阵 · GPIO LED 状态板）
- 布局：左侧外设下拉 + 当前外设寄存器列表；右侧 GPIO 引脚 LED 状态板 + 选中寄存器内容卡。
- GPIO 直观 IO 状态：16 个发光 LED 圆点对应 PIN0-15，实时反映引脚电平，点 LED 直接翻转输出。
- 位域点阵：选中寄存器按位渲染格子（位号 + 位域名 + 0/1 状态），RW 位点击即翻转写回。
- 刷新固定 200ms（去掉间隔下拉框），probe-rs 引擎下旁路直读零停机零闪烁。

## [0.6.12] - 2026-10-24

### Fixed
- 目标选择器下拉改为只列出工程的 CMake 目标（add_executable / add_custom_target），不再混入工程切换项；已选目标时提供"清除目标选择（编译全部）"。

## [0.6.11] - 2026-10-24

### Fixed
- 多目标工程一致性：选定目标后构建记录优先锁定 <目标名>.elf；结尾不再重复整块内存占用表。

## [0.6.10] - 2026-10-24

### Added
- 「在 STM32CubeMX 中打开 .ioc」增强：资源管理器点击/双击 .ioc 直接启动 CubeMX（自定义编辑器），右键菜单入口；探测路径含 %LOCALAPPDATA%\Programs\STM32CubeMX。

## [0.6.9] - 2026-10-24

### Changed
- probe-rs 引擎的调试会话中自动隐藏「运行监视」按钮（旁路直读无需微停机采样）。

## [0.6.8] - 2026-10-24

### Fixed
- probe-rs 引擎下外设面板改为纯旁路直读、绝不暂停（运行监视微停机采样仅保留给 cortex-debug 引擎）——程序不再顿挫闪烁。

## [0.6.7] - 2026-10-24

### Added
- probe-rs 电压闸门自动重试：兼容款 ST-LINK 电压读数乱跳（0V↔6.3V），启动调试前先用 probe-rs info 试探，读到无效值自动等待重试（6 次 × 1.2s）。

## [0.6.6] - 2026-10-24

### Changed — probe-rs 引擎只做调试，烧录回归 CubeProgrammer
- probe-rs 引擎的「编译并调试」改为：CubeProgrammer 烧录（烧后不复位保持停机）→ probe-rs 以 attach 方式接管调试。probe-rs 不再执行擦除/烧写（其 Flash Loader 在部分 SWD 线路上不稳定）。

## [0.6.5] - 2026-10-24

### Fixed — 外设面板在 probe-rs 会话下读不到值
- 根因：面板会话获取只认 cortex-debug 类型，probe-rs 会话被过滤为"无会话"。改为插件自行跟踪引擎会话生命周期。
- 已通过 DAP 层实测确认 probe-rs 运行中 readMemory / 暂停 / 恢复全部可用（scripts/dap-probe-test.js）。

## [0.6.4] - 2026-10-24

### Fixed
- 输出面板自动滚动增强：编译/烧录/配置/调试开始时强制重新钉底（先隐藏再显示输出视图）。

## [0.6.3] - 2026-10-24

### Added
- 外设面板读取失败诊断：readMemory/pause 失败的真实报错限频写入插件日志，便于定位引擎差异。

## [0.6.2] - 2026-10-24

### Fixed
- 目标选择器在普通安装下抛 CANNOT use API proposal: quickPickItemTooltip：改用稳定的 detail 字段。

## [0.6.1] - 2026-10-24

### Fixed
- probe-rs 0.32 不接受 probe: "auto"：省略该字段即为自动选择第一个探针。

## [0.6.0] - 2026-10-24

### Added — 双调试引擎（cortex-debug / probe-rs 可切换）
- 新设置 autoCmakeFlash.debugEngine：cortex-debug（默认，停机式）或 probe-rs（直连 DAP，Keil 式运行中直读）。
- probe-rs：自动生成 probe-rs-debug 启动配置（芯片名自动推导 STM32F103C8T6 → STM32F103C8，可用 autoCmakeFlash.probeRsChip 覆盖）；SVD 自动下发；未装扩展时引导安装。

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
