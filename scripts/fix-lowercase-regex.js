const fs = require('fs');
const f = 'src/extension.ts';
let s = fs.readFileSync(f, 'utf8');
// 文件中的实际文本（正则字面量里 [\\/] = 两个反斜杠字符）
const old1 = "resolved = resolved.replace(/([\\\\/])cmake-build-([^\\\\/]+)$/i, (m0, sep, t) => sep + 'cmake-build-' + t.toLowerCase());";
const new1 = "resolved = resolved.replace(/(^|[\\\\/])cmake-build-([^\\\\/]+)$/i, (m0, sep, t) => (sep || '') + 'cmake-build-' + t.toLowerCase());";
if (!s.includes(old1)) {
  if (s.includes(new1)) { console.log('already fixed'); process.exit(0); }
  console.log('PATTERN NOT FOUND'); process.exit(1);
}
s = s.replace(old1, new1);
fs.writeFileSync(f, s);
console.log('regex fixed: separator optional');
