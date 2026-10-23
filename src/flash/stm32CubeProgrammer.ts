/**
 * STM32CubeProgrammer CLI 封装。
 *
 * 仅使用官方文档（UM2237）中明确的参数形式，全部参数以数组传递给
 * execFileSafe（不经 shell，路径含空格/中文安全）：
 *   -l                                   列出调试探头
 *   -c port=SWD freq=<kHz>               连接
 *   -d <file> [address] -v               下载 + 校验
 *   -rst hw|sw                           复位
 */

import { execFileSafe, CancelToken, ProcResult, RunOptions } from '../util/process';
import { extractCliVersion } from './verification';

export interface ProgrammerRunner {
  run(file: string, args: string[], opts?: RunOptions): Promise<ProcResult>;
}

export const defaultProgrammerRunner: ProgrammerRunner = {
  run: (file, args, opts) => execFileSafe(file, args, opts),
};

export interface ConnectOptions {
  iface: 'SWD' | 'JTAG';
  speedKhz: number;
  timeoutMs?: number;
}

export interface DownloadOptions extends ConnectOptions {
  file: string;
  /** BIN 文件必填的烧录地址（如 0x08000000） */
  address?: string;
  verify: boolean;
}

export interface ResetOptions extends ConnectOptions {
  mode: 'hardware' | 'software';
}

export interface CliContext {
  /** 取消令牌（来自 VS Code 进度窗口），取消会终止整个 CLI 进程树 */
  cancelToken?: CancelToken;
  /** 下载命令超时（毫秒） */
  downloadTimeoutMs?: number;
}

export class Stm32CubeProgrammerCli {
  private readonly ctx: CliContext;

  constructor(
    public readonly cliPath: string,
    private readonly runner: ProgrammerRunner = defaultProgrammerRunner,
    ctx: CliContext = {},
  ) {
    this.ctx = ctx;
  }

  private runOpts(timeoutMs: number): RunOptions {
    const opts: RunOptions = { timeoutMs };
    if (this.ctx.cancelToken) {
      opts.token = this.ctx.cancelToken;
    }
    return opts;
  }

  private connectArgs(o: ConnectOptions): string[] {
    return ['-c', `port=${o.iface}`, `freq=${Math.round(o.speedKhz)}`];
  }

  /** 版本确认：--version，失败时回退 -l 头部 */
  async getVersion(timeoutMs = 20_000): Promise<{ version?: string; confirmed: boolean; raw: ProcResult }> {
    const raw = await this.runner.run(this.cliPath, ['--version'], this.runOpts(timeoutMs));
    const v = extractCliVersion(raw.stdout);
    if (v) {
      return { version: v, confirmed: true, raw };
    }
    const fb = await this.runner.run(this.cliPath, ['-l'], this.runOpts(timeoutMs));
    const v2 = extractCliVersion(fb.stdout);
    return { version: v2, confirmed: !!v2, raw: fb };
  }

  /** 列出已连接的 ST-LINK 探头 */
  async listProbes(timeoutMs = 30_000): Promise<ProcResult> {
    return this.runner.run(this.cliPath, ['-l'], this.runOpts(timeoutMs));
  }

  /** 连接目标芯片（用于烧录前预检） */
  async connectProbe(o: ConnectOptions): Promise<ProcResult> {
    return this.runner.run(this.cliPath, [...this.connectArgs(o)], this.runOpts(o.timeoutMs ?? 60_000));
  }

  /**
   * 下载固件并按需校验。
   * 注意：ELF/HEX 自带地址信息，不传 address；BIN 必须传。
   */
  async download(o: DownloadOptions): Promise<ProcResult> {
    const args = [...this.connectArgs(o), '-d', o.file];
    if (o.address) {
      args.push(o.address);
    }
    if (o.verify) {
      args.push('-v');
    }
    return this.runner.run(this.cliPath, args, this.runOpts(o.timeoutMs ?? this.ctx.downloadTimeoutMs ?? 300_000));
  }

  /** 复位目标 */
  async reset(o: ResetOptions): Promise<ProcResult> {
    const mode = o.mode === 'hardware' ? 'hw' : 'sw';
    return this.runner.run(this.cliPath, [...this.connectArgs(o), '-rst', mode], this.runOpts(o.timeoutMs ?? 30_000));
  }
}
