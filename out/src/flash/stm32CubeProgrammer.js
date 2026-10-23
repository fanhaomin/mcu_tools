"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Stm32CubeProgrammerCli = exports.defaultProgrammerRunner = void 0;
const process_1 = require("../util/process");
const verification_1 = require("./verification");
exports.defaultProgrammerRunner = {
    run: (file, args, opts) => (0, process_1.execFileSafe)(file, args, opts),
};
class Stm32CubeProgrammerCli {
    cliPath;
    runner;
    ctx;
    constructor(cliPath, runner = exports.defaultProgrammerRunner, ctx = {}) {
        this.cliPath = cliPath;
        this.runner = runner;
        this.ctx = ctx;
    }
    runOpts(timeoutMs) {
        const opts = { timeoutMs };
        if (this.ctx.cancelToken) {
            opts.token = this.ctx.cancelToken;
        }
        return opts;
    }
    connectArgs(o) {
        return ['-c', `port=${o.iface}`, `freq=${Math.round(o.speedKhz)}`];
    }
    /** 版本确认：--version，失败时回退 -l 头部 */
    async getVersion(timeoutMs = 20_000) {
        const raw = await this.runner.run(this.cliPath, ['--version'], this.runOpts(timeoutMs));
        const v = (0, verification_1.extractCliVersion)(raw.stdout);
        if (v) {
            return { version: v, confirmed: true, raw };
        }
        const fb = await this.runner.run(this.cliPath, ['-l'], this.runOpts(timeoutMs));
        const v2 = (0, verification_1.extractCliVersion)(fb.stdout);
        return { version: v2, confirmed: !!v2, raw: fb };
    }
    /** 列出已连接的 ST-LINK 探头 */
    async listProbes(timeoutMs = 30_000) {
        return this.runner.run(this.cliPath, ['-l'], this.runOpts(timeoutMs));
    }
    /** 连接目标芯片（用于烧录前预检） */
    async connectProbe(o) {
        return this.runner.run(this.cliPath, [...this.connectArgs(o)], this.runOpts(o.timeoutMs ?? 60_000));
    }
    /**
     * 下载固件并按需校验。
     * 注意：ELF/HEX 自带地址信息，不传 address；BIN 必须传。
     */
    async download(o) {
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
    async reset(o) {
        const mode = o.mode === 'hardware' ? 'hw' : 'sw';
        return this.runner.run(this.cliPath, [...this.connectArgs(o), '-rst', mode], this.runOpts(o.timeoutMs ?? 30_000));
    }
}
exports.Stm32CubeProgrammerCli = Stm32CubeProgrammerCli;
//# sourceMappingURL=stm32CubeProgrammer.js.map