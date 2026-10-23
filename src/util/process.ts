/**
 * 安全的外部进程调用封装。
 *
 * 安全策略：
 * - 一律使用 child_process.spawn(file, args) 且 shell: false，
 *   参数以数组形式传递，不经过 shell 解析，用户输入不会被拼接执行。
 * - 拒绝执行 .bat/.cmd（Windows 上此类文件会隐式经过 cmd.exe）。
 * - 支持超时与取消（终止整个进程树）。
 */

import { spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';

export interface CancelToken {
  readonly isCancellationRequested: boolean;
}

export const NULL_CANCEL_TOKEN: CancelToken = { isCancellationRequested: false };

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  token?: CancelToken;
  env?: NodeJS.ProcessEnv;
  /** 每收到一段输出回调一次（用于实时日志） */
  onOutput?: (chunk: string) => void;
  /** 输出捕获上限（字节），防止超大日志占满内存，默认 32MB */
  maxCaptureBytes?: number;
}

export interface ProcResult {
  file: string;
  args: string[];
  /** 仅用于日志展示的命令行（含引号）；实际执行不经过 shell */
  commandLine: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  spawnError?: string;
  durationMs: number;
}

/** 仅用于展示的引号包装（不要用于实际执行） */
export function quoteForDisplay(s: string): string {
  return /[\s"]/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s;
}

export function commandLineFor(file: string, args: string[]): string {
  return [file, ...args].map(quoteForDisplay).join(' ');
}

const DEFAULT_MAX_CAPTURE = 32 * 1024 * 1024;

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      // taskkill /T 终止整个进程树（cmake -> ninja -> gcc 链）
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => {
        try {
          process.kill(pid);
        } catch {
          /* 进程可能已退出 */
        }
      });
    } catch {
      try {
        process.kill(pid);
      } catch {
        /* ignore */
      }
    }
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }
}

export async function execFileSafe(
  file: string,
  args: string[],
  opts: RunOptions = {},
): Promise<ProcResult> {
  const started = Date.now();
  const result: ProcResult = {
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
  const outDecoder = new StringDecoder('utf8');
  const errDecoder = new StringDecoder('utf8');
  let outSize = 0;
  let errSize = 0;

  let child;
  try {
    child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
    });
  } catch (e) {
    result.spawnError = e instanceof Error ? e.message : String(e);
    result.durationMs = Date.now() - started;
    return result;
  }

  const emit = (text: string) => {
    if (text && opts.onOutput) {
      opts.onOutput(text);
    }
  };

  child.stdout.on('data', (buf: Buffer) => {
    if (outSize < maxCapture) {
      const text = outDecoder.write(buf);
      outSize += buf.length;
      result.stdout += text;
      emit(text);
    }
    outSize += buf.length;
  });
  child.stderr.on('data', (buf: Buffer) => {
    if (errSize < maxCapture) {
      const text = errDecoder.write(buf);
      errSize += buf.length;
      result.stderr += text;
      emit(text);
    }
    errSize += buf.length;
  });

  let timer: NodeJS.Timeout | undefined;
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

  await new Promise<void>((resolve) => {
    let spawnFailed = false;
    child.on('error', (e: Error) => {
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
