"use strict";
/**
 * 日志器：与 VS Code 解耦，通过 LogSink 注入输出通道，
 * 便于单元测试使用内存 sink。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.MemoryLogSink = void 0;
class MemoryLogSink {
    lines = [];
    appendLine(value) {
        this.lines.push(value);
    }
    text() {
        return this.lines.join('\n');
    }
}
exports.MemoryLogSink = MemoryLogSink;
class Logger {
    sink;
    verbose;
    constructor(sink, verbose = () => false) {
        this.sink = sink;
        this.verbose = verbose;
    }
    write(level, msg) {
        for (const line of String(msg).split(/\r?\n/)) {
            // INFO 直接输出；WARN/ERROR/DEBUG 保留短标记便于扫读（时间戳可由输出面板自带功能显示）
            this.sink.appendLine(level === 'INFO' ? line : `[${level}] ${line}`);
        }
    }
    info(msg) {
        this.write('INFO', msg);
    }
    warn(msg) {
        this.write('WARN', msg);
    }
    error(msg) {
        this.write('ERROR', msg);
    }
    /** 仅在启用详细日志时输出 */
    debug(msg) {
        if (this.verbose()) {
            this.write('DEBUG', msg);
        }
    }
    section(title) {
        this.sink.appendLine('');
        this.sink.appendLine(`===== ${title} =====`);
    }
    command(cmdLine, cwd) {
        this.write('CMD', `$ ${cmdLine}${cwd ? `    (工作目录: ${cwd})` : ''}`);
    }
    /** 记录外部命令的完整结果：退出码 + stdout + stderr */
    procResult(result, stdoutLabel = 'stdout') {
        this.write('PROC', `命令: ${result.commandLine}`);
        this.write('PROC', `退出码: ${result.exitCode === null ? '<无>' : result.exitCode}` +
            `  耗时: ${(result.durationMs / 1000).toFixed(1)}s` +
            (result.timedOut ? '  [超时终止]' : '') +
            (result.cancelled ? '  [用户取消]' : '') +
            (result.spawnError ? `  [启动失败: ${result.spawnError}]` : ''));
        const out = result.stdout.trimEnd();
        const err = result.stderr.trimEnd();
        if (out) {
            this.write('PROC', `--- ${stdoutLabel} 开始 ---`);
            this.write('PROC', out);
            this.write('PROC', `--- ${stdoutLabel} 结束 ---`);
        }
        if (err) {
            this.write('PROC', '--- stderr 开始 ---');
            this.write('PROC', err);
            this.write('PROC', '--- stderr 结束 ---');
        }
        if (!out && !err && !result.spawnError) {
            this.write('PROC', '(无输出)');
        }
    }
}
exports.Logger = Logger;
//# sourceMappingURL=logger.js.map