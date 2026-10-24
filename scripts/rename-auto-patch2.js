const fs = require('fs');
let n = 0;
function patch(f, pairs) {
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) { console.log('MISS in ' + f + ':', JSON.stringify(a.slice(0, 80))); continue; }
    s = s.split(a).join(b); n++;
  }
  fs.writeFileSync(f, s);
}

// extension.ts
patch('src/extension.ts', [
  ["      path.join(buildDir, 'auto-cmake-flash-last-build.log'),", "      path.join(buildDir, 'last-build.log'),"],
  ["    const skipDirs = new Set(['.git', '.auto-cmake-flash', 'build', 'build-auto']);",
   "    const skipDirs = new Set(['.git', '.auto-cmake-flash', 'build', 'build-auto', 'cmake-build-debug', 'cmake-build-release']);"],
  ["'将写入 .auto-cmake-flash/ 目录并清理 build-auto 的 CMake 缓存残留；你的 CMakeLists.txt 不会被修改。'",
   "'将写入 .auto-cmake-flash/ 目录并清理构建目录的 CMake 缓存残留；你的 CMakeLists.txt 不会被修改。'"],
  ["    let resolved = bd.split('${buildType}').join(settings.buildType);",
   "    let resolved = bd.split('${buildType}').join(settings.buildType);\n    // CLion 命名统一：cmake-build-<Type> 的类型段统一小写（cmake-build-debug / release）\n    resolved = resolved.replace(/([\\\\/])cmake-build-([^\\\\/]+)$/i, (m0, sep, t) => sep + 'cmake-build-' + t.toLowerCase());"],
]);

// projectDetector.ts
patch('src/detection/projectDetector.ts', [
  ["        if (/^build-auto$/i.test(ent.name)) {", "        if (/^(build-auto|cmake-build-.+)$/i.test(ent.name)) {"],
  ["插件只会使用专用目录 build-auto，不会改动它们。", "插件只会使用专用构建目录，不会改动它们。"],
]);

// configure.ts 注释
patch('src/cmake/configure.ts', [
  [" * - 只在插件专用构建目录（默认 build-auto）中生成文件；", " * - 只在插件专用构建目录（默认 cmake-build-<小写buildType>，CLion 风格）中生成文件；"],
]);

// 测试里的路径字面量（纯字符串，不影响断言语义）
patch('test/artifactDetector.test.ts', [
  ["C:\\proj\\build-auto", "C:\\proj\\cmake-build-debug"],
]);
patch('test/flashFlow.test.ts', [
  ["C:\\proj\\build-auto", "C:\\proj\\cmake-build-debug"],
]);
patch('test/debugConfig.test.ts', [
  ["D:\\work\\proj\\build-auto", "D:\\work\\proj\\cmake-build-debug"],
]);
patch('test/probeRs.test.ts', [
  ["D:\\work\\proj\\build-auto", "D:\\work\\proj\\cmake-build-debug"],
]);

console.log('done, total', n);
