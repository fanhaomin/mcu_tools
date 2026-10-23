/**
 * 日志器：与 VS Code 解耦，通过 LogSink 注入输出通道，
 * 便于单元测试使用内存 sink。
 */

export interface LogSink {
  appendLine(value: string): void;
}

export class MemoryLogSink implements LogSink {
  public readonly lines: string[] = [];

  appendLine(value: string): void {
    this.lines.push(value);
  }

  text(): string {
    return this.lines.join('\n');
  }
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

export class Logger {
  constructor(
    private readonly sink: LogSink,
    private readonly verbose: () => boolean = () => false,
  ) {}

  private write(level: string, msg: string): void {
    for (const line of String(msg).split(/\r?\n/)) {
      this.sink.appendLine(`[${timestamp()}] [${level}] ${line}`);
    }
  }

  info(msg: string): void {
    this.write('INFO', msg);
  }

  warn(msg: string): void {
    this.write('WARN', msg);
  }

  error(msg: string): void {
    this.write('ERROR', msg);
  }

  /** 仅在启用详细日志时输出 */
  debug(msg: string): void {
    if (this.verbose()) {
      this.write('DEBUG', msg);
    }
  }

  section(title: string): void {
    this.sink.appendLine('');
    this.sink.appendLine(`===== ${title} =====`);
  }

  command(cmdLine: string, cwd?: string): void {
    this.write('CMD', `$ ${cmdLine}${cwd ? `    (工作目录: ${cwd})` : ''}`);
  }

  /** 记录外部命令的完整结果：退出码 + stdout + stderr */
  procResult(result: {
    commandLine: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    cancelled: boolean;
    spawnError?: string;
    durationMs: number;
  }, stdoutLabel = 'stdout'): void {
    this.write('PROC', `命令: ${result.commandLine}`);
    this.write(
      'PROC',
      `退出码: ${result.exitCode === null ? '<无>' : result.exitCode}` +
        `  耗时: ${(result.durationMs / 1000).toFixed(1)}s` +
        (result.timedOut ? '  [超时终止]' : '') +
        (result.cancelled ? '  [用户取消]' : '') +
        (result.spawnError ? `  [启动失败: ${result.spawnError}]` : ''),
    );
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
