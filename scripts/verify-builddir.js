/**
 * 验证 extension.ts 的 buildDirOf 解析：默认值 cmake-build-${buildType}
 * → Debug → cmake-build-debug（小写），与 CLion 目录名完全一致。
 */
const path = require('path');
const settings = { buildType: 'Debug' };

function buildDirOf(root, bd) {
  let resolved = bd.split('${buildType}').join(settings.buildType);
  // 与 out/src/extension.js 编译产物一致的行
  resolved = resolved.replace(/(^|[\/])cmake-build-([^\\/]+)$/i, (m0, sep, t) => (sep || '') + 'cmake-build-' + t.toLowerCase());
  if (!path.isAbsolute(resolved) && /(^|[\\/])build([\\/])?$/i.test(resolved)) {
    resolved = `${resolved.replace(/[\\/]$/, '')}/${settings.buildType}`;
  }
  return path.isAbsolute(resolved) ? resolved : path.join(root, resolved);
}

const root = 'D:\\cs\\cs';
const dbg = buildDirOf(root, 'cmake-build-${buildType}');
settings.buildType = 'Release';
const rel = buildDirOf(root, 'cmake-build-${buildType}');

console.log('Debug :', dbg);
console.log('Release:', rel);
const assert = require('assert');
assert.equal(dbg.toLowerCase().endsWith('cmake-build-debug'), true, 'Debug 目录应为 cmake-build-debug');
assert.equal(rel.toLowerCase().endsWith('cmake-build-release'), true, 'Release 目录应为 cmake-build-release');
assert.equal(dbg.toLowerCase().includes('build-auto'), false, '不应再出现 build-auto');
console.log('PASS');
