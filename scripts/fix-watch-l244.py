import io
f = 'src/ui/watchView.ts'
s = io.open(f, encoding='utf-8').read()
i = s.find('const ref = e.memRef')
print('before:', repr(s[i:i+130]))
# 统一修复：把这段里的错误转义（反引号前的反斜杠、\${）替换为正确模板字符串
seg_start = i
seg_end = s.find(';', i) + 1
seg = s[seg_start:seg_end]
fixed = seg.replace('\\`', '`').replace('\\${', '${')
s = s[:seg_start] + fixed + s[seg_end:]
# 388 行附近：html() 模板字符串里被同样破坏的地方检查
io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('fixed seg:', repr(fixed))
