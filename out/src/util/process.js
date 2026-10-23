"use strict";
/**
 * 安全的外部进程调用封装。
 *
 * 安全策略：
 * - 一律使用 child_process.spawn(file, args) 且 shell: false，
 *   参数以数组形式传递，不经过 shell 解析，用户输入不会被拼接执行。
 * - 拒绝执行 .bat/.cmd（Windows 上此类文件会隐式经过 cmd.exe）。
 * - 支持超时与取消（终止整个进程树）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NULL_CANCEL_TOKEN = void 0;
exports.quoteForDisplay = quoteForDisplay;
exports.commandLineFor = commandLineFor;
exports.execFileSafe = execFileSafe;
const child_process_1 = require("child_process");
const string_decoder_1 = require("string_decoder");
exports.NULL_CANCEL_TOKEN = { isCancellationRequested: false };
/** 仅用于展示的引号包装（不要用于实际执行） */
function quoteForDisplay(s) {
    return /[\s"]/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s;
}
function commandLineFor(file, args) {
    return [file, ...args].map(quoteForDisplay).join(' ');
}
const DEFAULT_MAX_CAPTURE = 32 * 1024 * 1024;
function killTree(pid) {
    if (process.platform === 'win32') {
        try {
            // taskkill /T 终止整个进程树（cmake -> ninja -> gcc 链）
            const killer = (0, child_process_1.spawn)('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
                windowsHide: true,
                stdio: 'ignore',
            });
            killer.on('error', () => {
                try {
                    process.kill(pid);
                }
                catch {
                    /* 进程可能已退出 */
                }
            });
        }
        catch {
            try {
                process.kill(pid);
            }
            catch {
                /* ignore */
            }
        }
    }
    else {
        try {
            process.kill(-pid, 'SIGTERM');
        }
        catch {
            try {
                process.kill(pid, 'SIGTERM');
            }
            catch {
                /* ignore */
            }
        }
    }
}
async function execFileSafe(file, args, opts = {}) {
    const started = Date.now();
    const result = {
        file,
        args,
        commandLine: commandLineFor(file, args),
        exitCode: null,
        stdout: '',
        stderr: '',
        signal: null,
        timedOut: false,
        cancelled: false,
        durationMs: 0,
    };
    // 安全防护：.bat/.cmd 在 Windows 上会隐式经过 cmd.exe，存在参数注入风险。
    if (/\.bat$|\.cmd$/i.test(file)) {
        result.spawnError = `拒绝执行脚本文件（安全策略，仅允许真正的可执行程序）: ${file}`;
        result.durationMs = Date.now() - started;
        return result;
    }
    const maxCapture = opts.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE;
    const outDecoder = new string_decoder_1.StringDecoder('utf8');
    const errDecoder = new string_decoder_1.StringDecoder('utf8');
    let outSize = 0;
    let errSize = 0;
    let child;
    try {
        child = (0, child_process_1.spawn)(file, args, {
            cwd: opts.cwd,
            env: opts.env,
            shell: false,
            windowsHide: true,
        });
    }
    catch (e) {
        result.spawnError = e instanceof Error ? e.message : String(e);
        result.durationMs = Date.now() - started;
        return result;
    }
    const emit = (text) => {
        if (text && opts.onOutput) {
            opts.onOutput(text);
        }
    };
    child.stdout.on('data', (buf) => {
        if (outSize < maxCapture) {
            const text = outDecoder.write(buf);
            outSize += buf.length;
            result.stdout += text;
            emit(text);
        }
        outSize += buf.length;
    });
    child.stderr.on('data', (buf) => {
        if (errSize < maxCapture) {
            const text = errDecoder.write(buf);
            errSize += buf.length;
            result.stderr += text;
            emit(text);
        }
        errSize += buf.length;
    });
    let timer;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
        timer = setTimeout(() => {
            result.timedOut = true;
            if (child.pid !== undefined) {
                killTree(child.pid);
            }
        }, opts.timeoutMs);
    }
    const poll = setInterval(() => {
        if (opts.token?.isCancellationRequested && !result.cancelled) {
            result.cancelled = true;
            if (child.pid !== undefined) {
                killTree(child.pid);
            }
        }
    }, 200);
    await new Promise((resolve) => {
        let spawnFailed = false;
        child.on('error', (e) => {
            spawnFailed = true;
            result.spawnError = e.message;
            resolve();
        });
        child.on('close', (code, signal) => {
            result.exitCode = code;
            result.signal = signal;
            resolve();
        });
        // 保证 error 后仍会结束（close 可能不会触发）
        child.once('exit', () => {
            if (spawnFailed) {
                resolve();
            }
        });
    });
    if (timer) {
        clearTimeout(timer);
    }
    clearInterval(poll);
    // 冲刷解码器尾部，避免多字节字符截断
    result.stdout += outDecoder.end();
    result.stderr += errDecoder.end();
    result.durationMs = Date.now() - started;
    return result;
}
//# sourceMappingURL=process.js.map