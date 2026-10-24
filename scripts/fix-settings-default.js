const fs = require('fs');
const f = 'src/config/settings.ts';
let s = fs.readFileSync(f, 'utf8');
const bad = "    buildDir: cfg.get<string>('buildDir', 'cmake-build-') || 'cmake-build-',";
const good = "    buildDir: cfg.get<string>('buildDir', 'cmake-build-${buildType}') || 'cmake-build-${buildType}',";
if (!s.includes(bad)) {
  if (s.includes(good)) { console.log('already fixed'); process.exit(0); }
  console.log('PATTERN NOT FOUND'); process.exit(1);
}
s = s.replace(bad, good);
fs.writeFileSync(f, s);
console.log('settings.ts default fixed:', s.includes("cmake-build-${buildType}"));
