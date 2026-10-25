"use strict";
/**
 * 烧录流程编排（3.6 节）。
 *
 * 流程与安全门禁（顺序不可调换）：
 * 1. 前置条件检查（checkFlashPreconditions）：编译成功、产物存在且新鲜、
 *    BIN 地址已确认、芯片型号已确定 —— 任一不满足直接阻断，不弹确认框。
 * 2. CLI 可用性检查。
 * 3. `-l` 检测 ST-LINK 探头 —— 明确区分“工具存在”与“硬件在线”。
 * 4. `-c port=SWD` 预检目标连接。
 * 5. 弹出确认窗口（工程路径/MCU/烧录器/文件/格式/BIN 地址/目标状态/操作）。
 *    第一版：无论任何自动化设置，每次烧录都必须用户明确确认。
 * 6. 下载 + 校验（-d ... -v），按输出内容判定校验状态。
 * 7. 按配置复位（-rst hw|sw）。
 * 8. 返回结构化结果，下载/校验/复位状态分开呈现。
 *
 * 通过 FlashDeps 注入，可在单元测试中完整模拟硬件行为。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeProbeStatus = describeProbeStatus;
exports.performFlash = performFlash;
const path = __importStar(require("path"));
const verification_1 = require("./verification");
function describeProbeStatus(st) {
    if (!st || st.status === 'notChecked') {
        return '未检查';
    }
    switch (st.status) {
        case 'cliMissing':
            return 'STM32CubeProgrammer CLI 未找到';
        case 'probeDetected':
            return `已检测到 ${st.probeCount} 个 ST-LINK`;
        case 'noProbe':
            return '未检测到 ST-LINK';
        default:
            return '检测结果未知';
    }
}
function describeTarget(t) {
    if (!t.connected) {
        return '未连接';
    }
    const parts = [];
    if (t.deviceName) {
        parts.push(t.deviceName);
    }
    if (t.deviceId) {
        parts.push(`DeviceID ${t.deviceId}`);
    }
    return `已连接${parts.length ? `（${parts.join('，')}）` : '（输出中未含设备明细）'}`;
}
async function performFlash(deps) {
    const { log, cli, settings } = deps;
    const messages = [];
    /** 精简 CLI 成功输出：只保留关键信息行（进度条乱码/横幅/设备信息块/空行全部剔除） */
    const compactCliOutput = (text) => {
        const keep = /(^\s*File\s*:|^\s*Size\s*:|^\s*Address\s*:|Erasing internal|Erasing memory|download complete|Time elapsed|Download verified|Download in Progress)/i;
        return String(text ?? '')
            .replace(/\ufffd+/g, '')
            .split(/\r?\n/)
            .map((l) => l.replace(/\s+$/, ''))
            .filter((l) => l.length > 0 && keep.test(l))
            .join('\n');
    };
    // 1. 前置门禁
    if (!deps.precheck.ok) {
        const blocker = deps.precheck.blockers.join(' ');
        log(`烧录已阻断: ${blocker}`);
        return {
            status: 'blocked',
            downloaded: false,
            verify: 'skipped',
            messages: deps.precheck.blockers,
            blocker,
        };
    }
    const artifact = deps.precheck.artifact;
    const binAddress = deps.precheck.binAddress;
    // 2. CLI 可用性
    if (!cli || !cli.cliPath) {
        const blocker = '未找到 STM32CubeProgrammer CLI，无法烧录。请安装 STM32CubeCLT。';
        log(blocker);
        return { status: 'blocked', downloaded: false, verify: 'skipped', messages: [blocker], blocker };
    }
    // 3. ST-LINK 探头检测（硬件在线 ≠ 软件已安装）——成功路径不刷日志，失败才展开
    const probeRun = await cli.listProbes();
    const probes = (0, verification_1.parseProbeList)(probeRun.stdout);
    if (probes.count === 0 || probeRun.spawnError) {
        log(`检测 ST-LINK 探头: "${cli.cliPath}" -l`);
        log(`探头检测结果: ${probes.count} 个；退出码 ${probeRun.exitCode}` +
            (probeRun.spawnError ? `；错误: ${probeRun.spawnError}` : ''));
        log(`ST-LINK 列表命令原始输出:\n${probeRun.stdout}`);
    }
    if (probes.count > 0) {
        log(`ST-LINK: 已连接（${probes.count} 个探头）`);
    }
    if (deps.precheck.warnings.length > 0) {
        for (const w of deps.precheck.warnings) {
            log(`警告: ${w}`);
        }
        messages.push(...deps.precheck.warnings);
    }
    if (probes.count === 0) {
        log(`ST-LINK 列表命令原始输出:\n${probeRun.stdout}`);
        const hints = (0, verification_1.stlinkFailureHints)(`${probeRun.stdout}\n${probeRun.stderr}`);
        messages.push('未检测到 ST-LINK 适配器', ...hints);
        return {
            status: 'no-probe',
            downloaded: false,
            verify: 'skipped',
            messages,
            blocker: '未检测到 ST-LINK 适配器',
            exitCode: probeRun.exitCode,
        };
    }
    // 3.5 上次调试异常退出可能留下孤儿 GDB Server 占着 ST-LINK，连接预检前清掉
    await deps.killOrphanProbeHolders?.();
    // 4. 目标连接预检——成功一行，失败展开完整输出
    const connRun = await cli.connectProbe({
        iface: settings.iface,
        speedKhz: settings.speedKhz,
    });
    const target = (0, verification_1.parseConnectResult)(connRun.stdout, connRun.exitCode);
    if (!target.connected) {
        log(`连接目标预检: "${cli.cliPath}" -c port=${settings.iface} freq=${settings.speedKhz}`);
        log(`目标连接失败: ${describeTarget(target)}`);
        log(`连接命令原始输出:\n${connRun.stdout}${connRun.stderr ? `\n[stderr]\n${connRun.stderr}` : ''}`);
        // 连接成功时不再倒出完整原始输出，仅在失败时保留完整记录便于排查
        log(`连接命令原始输出:\n${connRun.stdout}${connRun.stderr ? `\n[stderr]\n${connRun.stderr}` : ''}`);
        const hints = (0, verification_1.stlinkFailureHints)(`${connRun.stdout}\n${connRun.stderr}`);
        messages.push(`目标芯片无法连接（${target.error ?? '未知原因'}）`, ...hints);
        return {
            status: 'connect-failed',
            downloaded: false,
            verify: 'skipped',
            messages,
            blocker: '目标芯片无法连接',
            exitCode: connRun.exitCode,
        };
    }
    // 5. 用户确认（第一版：每次烧录都必须确认）
    const mcuNote = deps.mcu.confirmedByUser
        ? '用户手动确认'
        : `自动识别（可信度: ${deps.mcu.confidence}）`;
    const info = {
        workspacePath: deps.workspaceRoot,
        mcuModel: deps.mcu.base || deps.mcu.family || '待确认',
        mcuNote,
        programmer: 'ST-LINK (STM32CubeProgrammer CLI)',
        probeStatus: `已检测到 ${probes.count} 个 ST-LINK`,
        targetStatus: describeTarget(target),
        filePath: artifact.path,
        format: artifact.format.toUpperCase(),
        binAddress,
        action: `通过 STM32CubeProgrammer CLI 将 ${path.basename(artifact.path)} 写入目标` +
            (binAddress ? `（地址 ${binAddress}）` : '') +
            '，随后校验' +
            (settings.resetAfterFlash !== 'none'
                ? `，完成后执行${settings.resetAfterFlash === 'hardware' ? '硬件' : '软件'}复位`
                : '，不复位'),
        stale: deps.precheck.stale,
    };
    const confirmed = await deps.confirm(info);
    if (!confirmed) {
        log('用户取消了烧录操作。');
        return { status: 'cancelled', downloaded: false, verify: 'skipped', messages: ['用户取消操作'] };
    }
    // 6. 下载 + 校验——成功只记结果行，失败保留命令与完整输出
    const dlRun = await cli.download({
        iface: settings.iface,
        speedKhz: settings.speedKhz,
        file: artifact.path,
        address: binAddress,
        verify: true,
    });
    const dl = (0, verification_1.parseDownloadResult)(dlRun.stdout, dlRun.exitCode, true);
    if (dl.downloaded) {
        log(`烧录成功: ${path.basename(artifact.path)}（${(artifact.sizeBytes / 1024).toFixed(1)} KB → 0x08000000），校验通过`);
    }
    else {
        log(`开始烧录: "${cli.cliPath}" -c port=${settings.iface} freq=${settings.speedKhz} ` +
            `-d "${artifact.path}"${binAddress ? ` ${binAddress}` : ''} -v`);
        log(`烧录失败: 退出码 ${dlRun.exitCode}；下载 ${dl.downloaded ? '成功' : '失败'}；校验 ${dl.verify}`);
        log(`烧录命令原始输出（失败，完整记录）:\n${dlRun.stdout}${dlRun.stderr ? `\n[stderr]\n${dlRun.stderr}` : ''}`);
    }
    messages.push(...dl.notes);
    // 7. 复位（仅在下载成功时执行）
    let resetFailed = false;
    if (dl.downloaded && settings.resetAfterFlash !== 'none') {
        try {
            const rstRun = await cli.reset({
                iface: settings.iface,
                speedKhz: settings.speedKhz,
                mode: settings.resetAfterFlash === 'hardware' ? 'hardware' : 'software',
            });
            if (rstRun.exitCode !== 0) {
                resetFailed = true;
                messages.push(`复位命令执行失败（退出码 ${rstRun.exitCode}），固件已写入，可手动复位。`);
                log(`复位失败: ${rstRun.stderr || rstRun.stdout}`);
            }
        }
        catch (e) {
            resetFailed = true;
            messages.push(`复位命令异常: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    // 8. 汇总结果（下载/校验/复位状态分开呈现）
    if (!dl.downloaded) {
        return {
            status: 'download-failed',
            downloaded: false,
            verify: 'failed',
            messages,
            exitCode: dlRun.exitCode,
        };
    }
    if (dl.verify === 'failed') {
        return {
            status: 'verify-failed',
            downloaded: true,
            verify: 'failed',
            messages,
            exitCode: dlRun.exitCode,
        };
    }
    if (dl.verify === 'unconfirmed') {
        return {
            status: 'verify-unconfirmed',
            downloaded: true,
            verify: 'unconfirmed',
            messages: [
                ...messages,
                '下载命令执行完成，校验状态未确认。请在日志中核对 STM32CubeProgrammer 输出。',
            ],
            exitCode: dlRun.exitCode,
        };
    }
    return {
        status: resetFailed ? 'reset-failed' : 'success',
        downloaded: true,
        verify: 'passed',
        messages,
        exitCode: dlRun.exitCode,
    };
}
//# sourceMappingURL=programmer.js.map