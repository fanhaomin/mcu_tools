import io, json

# 1. 版本 0.9.18
f = 'package.json'
p = json.load(io.open(f, encoding='utf-8'))
p['version'] = '0.9.18'
io.open(f, 'w', encoding='utf-8', newline='').write(json.dumps(p, indent=2) + '\n')
print('version:', p['version'])

# 2. CHANGELOG 顶部插入（反引号内容用字符串拼接，避免再被转义）
f = 'CHANGELOG.md'
s = io.open(f, encoding='utf-8').read()
BT = chr(96)
entry = (
    '## [0.9.18] - 2026-10-24\n\n'
    '### Added — 变量监控表格化：变量名 | 类型 | 值 | 地址（Keil Watch 同款布局）\n'
    '- 添加语法：' + BT + '变量:类型' + BT + '（如 ' + BT + 'led_toggle_count:uint32_t' + BT + '、'
    + BT + 'sensor_value:float' + BT + '、' + BT + 'motor_speed:int16_t' + BT + '、'
    + BT + '0x20000008:float' + BT + '），支持 uint/int 8-64 位、float、double；不带类型默认 uint32。\n'
    '- 值按类型小端解码为十进制/浮点显示；地址列显示符号解析地址或「已捕获」（断点捕获的局部变量）。\n'
    '- 全局/静态变量自动从 ELF 符号表解析（类型默认按符号大小）；局部变量走断点捕获。\n'
    '- 输入提示更新为「变量名/表达式/0x地址:类型」。\n\n'
)
assert '## [0.9.17]' in s
s = s.replace('## [0.9.17] - 2026-10-24', entry + '## [0.9.17] - 2026-10-24', 1)
io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('changelog ok')

# 3. 确认编译产物包含新表格
built = io.open('out/src/ui/watchView.js', encoding='utf-8').read()
print('whead in built:', 'whead' in built)
print('typed in built:', 'decodeTyped' in built)
