import io
f = 'scripts/patch-buildtype-btn.js'
s = io.open(f, encoding='utf-8').read()
# 1. 修复被误替换的 patch() 辅助函数 log 行
s = s.replace(
    "console.log('构建类型已切换为 ' + pick.label + '；构建目录随类型自动切换');process.exit(1);",
    "console.log('MISS in ' + f + ':', JSON.stringify(a.slice(0, 70)));process.exit(1);")
# 2. 替换命令里的模板字符串 log 行（定位特征：log( 反引号）
marker = 'log(\\'
i = s.find(marker)
if i < 0:
    print('TARGET LOG MISS')
    raise SystemExit(1)
j = s.find(');', i)
old = s[i:j + 2]
print('replacing:', repr(old[:90]))
new = "log('构建类型已切换为 ' + pick.label + '；构建目录随类型自动切换');"
s = s.replace(old, new)
io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('script repaired')
