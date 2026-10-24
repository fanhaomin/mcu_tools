const fs = require('fs');
const f = 'scripts/verify-builddir.js';
let s = fs.readFileSync(f, 'utf8');
const old1 = "const rel = buildDirOf(root, 'cmake-build-${buildType}'.replace('Debug', 'Release'));";
const new1 = "settings.buildType = 'Release';\nconst rel = buildDirOf(root, 'cmake-build-${buildType}');";
if (!s.includes(old1)) { console.log('MISS'); process.exit(1); }
s = s.replace(old1, new1);
fs.writeFileSync(f, s);
console.log('fixed');
