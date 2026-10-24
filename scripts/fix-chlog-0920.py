import io
f = 'CHANGELOG.md'
s = io.open(f, encoding='utf-8').read()
entry = '''## [0.9.20] - 2026-10-24

### Added — 变量监控树形展开（数组/结构体）
- 监控条目带展开箭头：数组/结构体条目（断点暂停时自动从 DAP variables 捕获子节点，最多 32 个）可展开查看每个元素/成员。
- 子节点实时刷新：数组按基址整块读后切片（一次读取）；结构体成员逐个读。
- 类型自动从 DAP 标注解析（如 (volatile uint16_t) 84 → uint16_t），用户显式指定的类型优先。

'''
assert '## [0.9.19]' in s
s = s.replace('## [0.9.19] - 2026-10-24', entry + '## [0.9.19] - 2026-10-24', 1)
io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('changelog ok')
