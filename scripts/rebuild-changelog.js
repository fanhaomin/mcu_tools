const fs = require('fs');
const s = fs.readFileSync('CHANGELOG.md', 'utf8');
const anchor = '## [0.5.0]';
const idx = s.indexOf(anchor);
if (idx < 0) { console.log('ANCHOR 0.5.0 NOT FOUND'); process.exit(1); }
const tail = s.slice(idx);

const top = `# Changelog

All notable changes to this project will be documented in this file.

## [0.8.0] - 2026-10-24

### Changed — 构建目录与产物命名全面对齐 CLion 风格（去掉 auto）
- 默认构建目录：\`build-auto\` → \`cmake-build-\${buildType}\`（\${buildType} 自动小写：Debug → \`cmake-build-debug\`，Release → \`cmake-build-release\`）。与 CLion 共用同名目录：CLion 先建过则复用（弹确认），其 CMakeCache 证据与固件产物照常发现。
- 构建目录内文件改名：\`auto-cmake-flash-last-build.log\` → \`last-build.log\`；\`auto-cmake-flash.buildstate.json\` → \`buildstate.json\`。
- projectDetector：\`cmake-build-*\` 归类为插件构建目录（不再视为外部只读目录）。
- 状态栏新增「调试」按钮（烧录右侧），busy 时转圈。
- 升级注意：旧 \`build-auto\` 目录不会自动迁移/删除，可手动删除；首次构建会在新目录重新 configure。

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
- 「在 STM32CubeMX 中打开 .ioc」增强：资源管理器点击/双击 .ioc 直接启动 CubeMX（自定义编辑器），右键菜单入口；探测路径含 %LOCALAPPDATA%\\Programs\\STM32CubeMX。

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

`;

fs.writeFileSync('CHANGELOG.md', top + tail);
console.log('changelog rewritten, tail starts at', idx);
