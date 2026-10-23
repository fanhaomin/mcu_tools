/**
 * 端到端真实环境验证驱动（不烧录，仅到确认窗口为止）。
 * 用法: node scripts/e2e-real-check.js <工程根目录>
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
const path = require('path');
const { detectProject } = require('../out/src/detection/projectDetector');
const {
  detectToolchain,
  defaultDetectionEnv,
} = require('../out/src/detection/toolchainDetector');
const { detectStLink } = require('../out/src/detection/stlinkDetector');
const { configureProject, generateToolchainFileContent } = require('../out/src/cmake/configure');
const { buildProject, isConfigured } = require('../out/src/cmake/build');
const { findArtifacts, checkFlashPreconditions, readPersistedState } = require('../out/src/cmake/artifacts');
const { Stm32CubeProgrammerCli } = require('../out/src/flash/stm32CubeProgrammer');
const { performFlash } = require('../out/src/flash/programmer');

const root = process.argv[2];
if (!root) {
  console.error('用法: node scripts/e2e-real-check.js <工程根目录>');
  process.exit(2);
}

const log = (m) => console.log('[ACF] ' + m);

(async () => {
  // 1. 工程识别
  const project = await detectProject(root);
  log(`工程识别: name=${project.name} recognized=${project.recognized} ioc=${project.hasIoc} cmake=${project.hasCMakeLists}`);
  log(`芯片结论: model=${project.mcu.model || '(待确认)'} base=${project.mcu.base} family=${project.mcu.family} 置信度=${project.mcu.confidence}`);
  for (const w of project.warnings) log('警告: ' + w);

  // 2. 工具链检测（真实环境）
  const tc = await detectToolchain(defaultDetectionEnv(), { timeoutMs: 20000 });
  for (const t of Object.values(tc.tools)) {
    log(`工具 ${t.name}: ${t.found ? t.path + ' @ ' + t.version : '未找到: ' + t.error}`);
  }

  // 3. CMake 配置
  const buildDir = path.join(root, 'build-auto');
  const fs = require('fs');
  const tcDir = path.join(root, '.auto-cmake-flash');
  fs.mkdirSync(tcDir, { recursive: true });
  const tcFile = path.join(tcDir, 'auto-cmake-flash.toolchain.cmake');
  fs.writeFileSync(
    tcFile,
    generateToolchainFileContent(tc.tools.armGcc.path, tc.tools.armGpp.path),
    'utf8',
  );
  log(`生成工具链文件: ${tcFile}`);

  if (!(await isConfigured(buildDir))) {
    const cfg = await configureProject({
      root,
      buildDir,
      generator: 'Ninja',
      buildType: 'Debug',
      cmakePath: tc.tools.cmake.path,
      ninjaAvailable: tc.tools.ninja.found,
      hasExistingToolchain: false,
      generatedToolchainFile: tcFile,
      extraArgs: [],
      confirmReuseForeignBuildDir: async () => false,
      log,
    });
    if (cfg.result) {
      log(`cmake 配置退出码: ${cfg.result.exitCode}`);
      if (!cfg.ok) console.log(cfg.result.stdout + cfg.result.stderr);
    }
    if (!cfg.ok) process.exit(1);
  }

  // 4. 编译
  const outcome = await buildProject({
    root,
    buildDir,
    cmakePath: tc.tools.cmake.path,
    buildType: 'Debug',
    timeoutMs: 300000,
    log,
  });
  log(`编译结果: ok=${outcome.ok} exit=${outcome.record.exitCode} 耗时=${(outcome.record.durationMs / 1000).toFixed(1)}s`);
  if (!outcome.ok) {
    console.log(outcome.result.stdout.slice(-3000));
    console.log(outcome.result.stderr.slice(-3000));
    process.exit(1);
  }

  // 5. 产物
  const arts = await findArtifacts(buildDir);
  for (const a of arts) log(`产物: [${a.format}] ${a.path} (${(a.sizeBytes / 1024).toFixed(1)} KB)`);

  // 6. 烧录预检（真实硬件）——确认窗口返回 false，绝不写芯片
  const persisted = await readPersistedState(buildDir);
  const all = arts.length ? arts : project.artifacts;
  const precheck = checkFlashPreconditions({
    lastBuild: outcome.record ?? persisted?.lastBuild,
    artifacts: all,
    mcu: project.mcu,
  });
  const cli = new Stm32CubeProgrammerCli(tc.tools.programmerCli.path);
  const flash = await performFlash({
    cli,
    workspaceRoot: root,
    mcu: project.mcu,
    precheck,
    settings: { iface: 'SWD', speedKhz: 4000, resetAfterFlash: 'hardware' },
    confirm: async (info) => {
      log('—— 烧录确认窗口（真实内容，此处模拟用户取消）——');
      for (const [k, v] of Object.entries(info)) {
        log(`  ${k}: ${Array.isArray(v) ? v.join(',') : v}`);
      }
      return false; // 明确取消：不烧录真实芯片
    },
    log,
  });
  log(`烧录流程结果（预期 cancelled）: status=${flash.status}`);
  if (flash.status !== 'cancelled') process.exit(1);
  log('端到端验证全部通过（未写芯片）。');
})().catch((e) => {
  console.error('[ACF][FATAL]', e);
  process.exit(1);
});
