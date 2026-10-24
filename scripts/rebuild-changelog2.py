import io

BT = chr(96)
f = 'CHANGELOG.md'
s = io.open(f, encoding='utf-8').read()
anchor = '## [0.5.0]'
i = s.find(anchor)
assert i > 0, '0.5.0 anchor missing'
tail = s[i:]

def E(v, title, body):
    return '## [' + v + '] - 2026-10-24\n\n### ' + title + '\n' + body + '\n'

top = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n'
top += E('0.9.18', 'Added — 变量监控表格化：变量名 | 类型 | 值 | 地址（Keil Watch 同款布局）',
    '- 添加语法：' + BT + '变量:类型' + BT + '（如 ' + BT + 'led_toggle_count:uint32_t' + BT + '、'
    + BT + 'sensor_value:float' + BT + '、' + BT + 'motor_speed:int16_t' + BT + '、' + BT + '0x20000008:float' + BT +
    '），支持 uint/int 8-64 位、float、double；不带类型默认 uint32。\n'
    '- 值按类型小端解码为十进制/浮点显示；地址列显示符号解析地址或「已捕获」（断点捕获的局部变量）。\n'
    '- 全局/静态变量自动从 ELF 符号表解析（类型默认按符号大小）；局部变量走断点捕获。\n'
    '- 输入提示更新为「变量名/表达式/0x地址:类型」。\n')
top += E('0.9.17', 'Fixed',
    '- 修正 addr 可空类型（0.9.16 遗留编译错误）。\n')
top += E('0.9.16', 'Fixed — 断点捕获成功后面板仍显示「解析中」且反复微停机',
    '- 「未解析」过滤器只看地址、没看断点捕获的 memoryReference——已捕获的条目仍被当成未解析，反复触发 evaluate 失败与微停机。'
    '修复：未解析 = 无地址且无 memRef；微停机窗口内 memRef 条目照常读取；状态行新增「已捕获」。\n')
top += E('0.9.15', 'Added — 变量监控支持局部变量（断点捕获）',
    '- 局部变量（如 main() 里的 led_toggle_count）不在 ELF 符号表中，符号表解析永远找不到。\n'
    '- 目标暂停（断点/复位停机）时自动走 DAP 变量作用域（threads→stack→scopes→variables）按名字匹配并记下 memoryReference——继续运行后旁路直读。\n'
    '- ss 工程构建目录恢复默认 cmake-build-${buildType}（此前被配置面板历史值 build 钉住）。\n')
top += E('0.9.14', 'Fixed — 变量监控「解析中…」卡住：找不到 ELF',
    '- 取不到记录路径（重载/删旧目录后）时自动扫描构建目录找最新 .elf；换了新 ELF 自动清除解析失败标记并重试；符号表为空时限频输出诊断日志。\n')
top += E('0.9.13', 'Changed',
    '- 内存视图底部提示更新（移除残留刷新下拉框）。\n')
top += E('0.9.12', 'Fixed — 刷新间隔选择后不生效',
    '- 直写 settings.json 后 Configuration API 读取有延迟，推送给面板的还是旧值——改为直接用刚写入的值推送。移除面板内残留的间隔下拉框。\n')
top += E('0.9.11', 'Added — 内存视图变化高亮',
    '- 每轮刷新与上一轮逐字节比较：值变化的字节琥珀色加粗标注；用户手改字节仍为绿色；滚动/跳转后重建基准。\n')
top += E('0.9.10', 'Fixed',
    '- 配置面板保存也换用工程 settings.json 直接写入（未注册键）。\n')
top += E('0.9.9', 'Fixed — 未注册设置键的写入报错',
    '- 「没有注册配置 autoCmakeFlash.debugRefreshMs」：0.8.2 移除设置声明后 VS Code 拒绝 Configuration API 对未注册键的文件夹级写入。'
    '改为直接编辑当前工程 .vscode/settings.json（尽力保留注释），刷新间隔/切换引擎/配置面板保存三处全部换用。\n')
top += E('0.9.8', 'Changed — 刷新间隔全局化',
    '- 侧边栏「调试」分组新增「刷新间隔设置」：50/100/200/500/1000ms，写入工程设置，外设/变量/内存三面板共用即时生效；各面板内下拉框移除。\n')
top += E('0.9.7', 'Changed',
    '- 内存视图 hexdump 紧凑靠左（去掉 width:100% 拉伸）。\n')
top += E('0.9.6', 'Fixed — 变量监控解析重做：ELF 符号表离线解析',
    '- 变量→地址解析不再依赖 GDB evaluate（probe-rs 运行中不支持、cortex-debug 需暂停），改用 arm-none-eabi-nm --defined-only -S 离线读取符号表（按 ELF mtime 缓存）：零停顿、双引擎通用。evaluate 降级为表达式回退（上限 3 次）。\n')
top += E('0.9.5', 'Changed — 内存视图重构为滚动视口模式',
    '- 单一 256 字节视口：地址回车跳转（历史下拉 12 条，按工程持久化）、滚轮逐行/Shift+滚轮整页；每轮只读可见的 256 字节；增量单元格更新；字节编辑写回保留。\n')
top += E('0.9.4', 'Fixed',
    '- 解析失败的条目显示「无法解析 — 请改用 0x 地址」。\n')
top += E('0.9.3', 'Fixed — 不可解析变量导致目标被反复暂停',
    '- 依赖 CMSIS 宏的表达式永远解析失败，自动微停机解析每 2 秒无限循环。每条目上限 3 次，失败后提示改用 0x 地址。\n')
top += E('0.9.2', 'Fixed — 变量监控解析卡在「解析中…」',
    '- probe-rs 运行中不支持 evaluate；0x 地址直填、失败 2 秒后微停机解析一次；提示 CMSIS 宏需 -g3。\n')
top += E('0.9.0', 'Added — 变量监控 + 内存视图（底部面板两个新窗口）',
    '- 变量监控：添加变量/表达式，自动解析地址与大小后实时读取；条目持久化（每工程独立，最多 16 个）。\n'
    '- 内存视图：地址区间 hexdump（16-4096B），字节点击编辑写回；区域持久化（最多 8 个）。\n'
    '- 双引擎适配：probe-rs 旁路直读；cortex-debug 自动微停机采样。\n'
    '- 100Hz 说明：SWD 单次读取往返 1-5ms 加 DAP 开销，10ms/轮物理不可达；提供 50ms（20Hz）档。\n')
top += E('0.8.8', 'Fixed',
    '- 恢复外设面板两栏布局容器（0.8.7 移除顶部栏时误删 #main 开标签导致塌成单列）。\n')
top += E('0.8.7', 'Changed — 外设面板移除顶部工具条',
    '- 移除过滤框/状态行/刷新与运行监视按钮，恒 200ms 自动刷新；cortex-debug 自动采样；会话断开清空旧值。\n')
top += E('0.8.6', 'Added — 状态栏构建类型选择按钮',
    '- 编译与烧录之间显示当前类型，点击选择 Debug/Release/RelWithDebInfo/MinSizeRel；目录随类型自动切换。\n')
top += E('0.8.5', 'Changed',
    '- 面板标题栏精简为编译/烧录/调试/刷新四键。\n')
top += E('0.8.4', 'Fixed',
    '- 配置面板在当前编辑器栏打开，不再横向分栏。\n')
top += E('0.8.3', 'Changed — 配置面板改为编辑器内表单页',
    '- 五组卡片表单（构建/烧录/调试/工具路径/高级）+ 保存/全部恢复默认，替代 QuickPick。\n')
top += E('0.8.2', 'Changed — 配置入口收敛到插件配置面板',
    '- 侧边栏「配置」分组（打开配置面板/切换调试引擎）；移除 VS Code 设置页声明。\n')
top += E('0.8.1', 'Fixed — 默认构建目录两处关键修正',
    '- 默认值曾被截断为 cmake-build-；小写化正则对相对路径不生效。Debug/Release 均正确解析。\n')
top += E('0.8.0', 'Changed — 构建目录与产物命名全面对齐 CLion 风格（去掉 auto）',
    '- build-auto → cmake-build-${buildType}（自动小写）；last-build.log / buildstate.json；状态栏调试按钮。\n')
top += E('0.7.12', 'Added',
    '- 状态栏新增「调试」按钮。\n')
top += E('0.7.11', 'Changed',
    '- 变量监控列表值放大加粗蓝色（外设面板左栏）。\n')
top += E('0.7.10', 'Fixed — LED 板消失与数值不刷新的总根源',
    '- buildBits() 残留已移除代码，渲染到该处即抛异常，后续全部跳过。已删除。\n')
top += E('0.7.9', 'Fixed',
    '- 面板会话跟踪加固：窗口重载自动认领运行中的调试会话。\n')
top += E('0.7.8', 'Changed',
    '- 点阵格子统一 46×46 正方形。\n')
top += E('0.7.7', 'Fixed',
    '- 点阵格子固定等宽。\n')
top += E('0.7.6', 'Changed',
    '- 位域明细行移除；点阵间距收紧。\n')
top += E('0.7.5', 'Changed',
    '- 点阵格子 hover 提示；16 列网格。\n')
top += E('0.7.4', 'Changed',
    '- 寄存器点阵固定 16 列（高/低半字两行）。\n')
top += E('0.7.3', 'Changed',
    '- 琐碎位域明细自动隐藏（仅多位字段/枚举显示）。\n')
top += E('0.7.2', 'Changed — 只写寄存器点阵位直接控制',
    '- BSRR 点阵位点击直接写（拉高/拉低），闪绿光确认。\n')
top += E('0.7.1', 'Fixed',
    '- 外设下拉框点开即关闭（值刷新重建左栏）；移除右栏冗余标题卡。\n')
top += E('0.7.0', 'Changed — 外设面板全面重设计（双栏 · 位域点阵 · GPIO LED 状态板）',
    '- 左外设+寄存器列表，右引脚 LED 板与寄存器内容卡；刷新固定 200ms。\n')
top += E('0.6.12', 'Changed',
    '- 目标选择器只列 CMake 目标，支持清除选择。\n')
top += E('0.6.11', 'Fixed',
    '- 多目标一致性：构建记录锁定 <目标名>.elf；内存表不重复输出。\n')
top += E('0.6.10', 'Added',
    -1 and '' or '- 资源管理器点 .ioc 直接启动 STM32CubeMX；右键菜单；LOCALAPPDATA 探测。\n')
top += E('0.6.9', 'Changed',
    '- probe-rs 会话隐藏「运行监视」按钮。\n')
top += E('0.6.8', 'Fixed',
    '- probe-rs 引擎纯旁路直读、绝不暂停。\n')
top += E('0.6.7', 'Added',
    '- probe-rs 电压闸门自动重试（兼容探针电压乱跳）。\n')
top += E('0.6.6', 'Changed — probe-rs 只做调试，烧录回归 CubeProgrammer',
    '- 编译并调试（probe-rs）= CubeProgrammer 烧录（不复位保持停机）→ probe-rs attach。\n')
top += E('0.6.5', 'Fixed — 外设面板在 probe-rs 会话下读不到值',
    '- 会话跟踪只认 cortex-debug；改为自行跟踪引擎会话生命周期。DAP 层实测通过。\n')
top += E('0.6.4', 'Fixed',
    '- 输出面板自动滚动增强（任务开始强制钉底）。\n')
top += E('0.6.3', 'Added',
    '- 外设面板读取失败诊断日志。\n')
top += E('0.6.2', 'Fixed',
    '- 目标选择器 quickPickItemTooltip 受限 API 报错改用 detail。\n')
top += E('0.6.1', 'Fixed',
    '- probe-rs 0.32 不接受 probe: "auto"。\n')
top += E('0.6.0', 'Added — 双调试引擎（cortex-debug / probe-rs 可切换）',
    '- 编译并调试/附加调试；调试配置全自动；SVD 自动下发；扩展引导安装。\n')

io.open(f, 'w', encoding='utf-8', newline='').write(top + tail)
print('changelog rebuilt')
