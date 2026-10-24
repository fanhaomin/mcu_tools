const fs = require('fs');
let n = 0;
function patch(f, pairs) {
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) { console.log('MISS in ' + f + ':', JSON.stringify(a.slice(0, 80))); process.exit(1); }
    s = s.replace(a, b); n++;
  }
  fs.writeFileSync(f, s);
}

// 1. settings.ts 默认构建目录

// 2. build.ts 日志文件名
patch('src/cmake/build.ts', [
  ["path.join(buildDir, 'auto-cmake-flash-last-build.log')", "path.join(buildDir, 'last-build.log')"],
]);

// 3. artifacts.ts 状态文件名
patch('src/cmake/artifacts.ts', [
  ["export const BUILD_STATE_FILE = 'auto-cmake-flash.buildstate.json';", "export const BUILD_STATE_FILE = 'buildstate.json';"],
]);

// 4. extension.ts：读日志路径 + 目标扫描 skipDirs + 提示文案 + buildDirOf 小写化
patch('src/extension.ts', [
  ["      path.join(buildDir, 'auto-cmake-flash-last-build.log'),", "      path.join(buildDir, 'last-build.log'),"],
  ["    const skipDirs = new Set(['.git', '.auto-cmake-flash', 'build', 'build-auto']);",
   "    const skipDirs = new Set(['.git', '.auto-cmake-flash', 'build', 'build-auto', 'cmake-build-debug', 'cmake-build-release']);"],
  ["'将写入 .auto-cmake-flash/ 目录并清理 build-auto 的 CMake 缓存残留；你的 CMakeLists.txt 不会被修改。'",
   "'将写入 .auto-cmake-flash/ 目录并清理构建目录的 CMake 缓存残留；你的 CMakeLists.txt 不会被修改。'"],
]);

// 5. projectDetector：外设构建目录识别兼容 cmake-build-*
patch('src/detection/projectDetector.ts', [
  ["        if (/^build-auto$/i.test(ent.name)) {", "        if (/^(build-auto|cmake-build-.+)$/i.test(ent.name)) {"],
]);

// 6. 测试同步状态文件名
patch('test/artifactDetector.test.ts', [
  ["  assert.equal(BUILD_STATE_FILE, 'auto-cmake-flash.buildstate.json');", "  assert.equal(BUILD_STATE_FILE, 'buildstate.json');"],
]);

console.log('all patched, total', n);
