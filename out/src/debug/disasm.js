"use strict";
/**
 * 反汇编目录：`arm-none-eabi-objdump -d -S -l` 输出解析（纯函数，可单测）。
 *
 * -S 把源码行交错进汇编、-l 给每段指令标注 文件:行；解析成
 * 指令数组（含所属源码位置/源码文本）+ 函数区间表，供「反汇编」面板
 * 按 PC 定位渲染"源码 ↔ 汇编"混合视图。按 ELF+mtime 缓存（同 DWARF 目录）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mnemonicKind = mnemonicKind;
exports.parseObjdumpDisasm = parseObjdumpDisasm;
exports.findInsnIndex = findInsnIndex;
exports.findFn = findFn;
exports.disasmFileMatches = disasmFileMatches;
/** 助记符前缀 → 类别（ARM/Thumb 通用；按首助记符判定，剥 .w/.n 宽度后缀） */
function mnemonicKind(text) {
    const mn = (text.trim().split(/[\s\t]+/)[0] ?? '').toLowerCase().replace(/\.(w|n)$/i, '');
    if (/^(b|bl|bx|blx|beq|bne|bcs|bcc|bmi|bpl|bvs|bvc|bhi|bls|bge|blt|bgt|ble|bal|cbz|cbnz|tbb|tbh|jmp)$/.test(mn)) {
        return 'branch';
    }
    if (/^(ldr|ldrd|ldrb|ldrh|ldrsb|ldrsh|ldrex|ldrt|ldmda|ldmdb|ldmia|ldmib|str|strd|strb|strh|strt|strex|stmda|stmdb|stmia|stmib|push|pop|ldc|stc|vldr|vstr|vldm|vstm)$/.test(mn)) {
        return 'mem';
    }
    if (/^(mrs|msr|cps|cpsid|cpsie|svc|bkpt|wfi|wfe|sev|dsb|dmb|isb|clrex)$/.test(mn)) {
        return 'system';
    }
    if (/^(add|adds|adcs|addw|sub|subs|sbcs|subw|rsb|mul|muls|mla|mls|and|ands|orr|orrs|orn|eor|eors|bic|bics|mvn|mvns|lsl|lsls|lsr|lsrs|asr|asrs|ror|rors|rrx|cmp|cmn|tst|teq|mov|movs|movt|movw|movw|clz|rbit|rev|rev16|revsh|sdiv|udiv|umaal|umlal|smull|umull|ssat|usat|sxtb|sxth|sxtw|uxtb|uxth|uxtw|adr|madd|msub)$/.test(mn)) {
        return 'alu';
    }
    if (/^(v[a-z0-9.]+|flds|fstd|fldd|fstds|fadds|fsubs|fmuls|fdivs|fmsr|fmrs|vmrs|vmsr)$/.test(mn)) {
        return 'fpu';
    }
    return 'other';
}
const RE_FN = /^\s*([0-9a-fA-F]+)\s+<(.+)>:\s*$/;
// 指令行：` 8000174:\t2500 \tmovs r5, #0`。冒号后不得紧跟路径分隔符——
// 否则盘符开头的定位行（D:/cs/… 的 D 是十六进制字符）会被误判成指令
const RE_INSN = /^\s*([0-9a-fA-F]+):\s*(?![\/\\])(.*)$/;
// 定位标记：`D:/cs/ss/Core/Src/main.c:117`（盘符也带冒号，文件名部分允许含冒号；
// 不含制表符（指令行有），含 ;{} 的行视为 -S 交错的源码文本而非定位标记）
const RE_LOC = /^\s*([^\t]+?):(\d+)\s*$/;
function parseObjdumpDisasm(text) {
    const insns = [];
    const fns = [];
    let curFile;
    let curLine;
    /** 悬挂的源码文本（出现指令行时挂到首条上） */
    let pendingSrc;
    let curFn;
    for (const raw of text.split(/\r?\n/)) {
        const fnm = RE_FN.exec(raw);
        if (fnm) {
            curFn = { name: fnm[2], start: Number.parseInt(fnm[1], 16), end: 0, first: insns.length };
            fns.push(curFn);
            curFile = undefined;
            curLine = undefined;
            pendingSrc = undefined;
            continue;
        }
        const im = RE_INSN.exec(raw);
        if (im) {
            const addr = Number.parseInt(im[1], 16);
            // "机器码\t汇编" 或直接汇编（以首个制表符分界；无制表符视为无机器码）
            const sep = im[2].indexOf('\t');
            const bytes = sep >= 0 ? im[2].slice(0, sep).trim() : '';
            const textPart = (sep >= 0 ? im[2].slice(sep + 1) : im[2]).trim();
            if (!bytes && !textPart) {
                continue;
            }
            insns.push({
                addr,
                bytes,
                text: textPart,
                file: curFile,
                line: curLine,
                src: pendingSrc,
                kind: mnemonicKind(textPart),
            });
            pendingSrc = undefined;
            if (curFn) {
                curFn.end = Math.max(curFn.end, addr + 4);
            }
            continue;
        }
        const lm = RE_LOC.exec(raw);
        if (lm && !/[;{}]/.test(raw)) {
            curFile = lm[1];
            curLine = Number.parseInt(lm[2], 10);
            pendingSrc = undefined;
            continue;
        }
        // 其余非空行 = -S 交错的源码文本（"..." 续行略过）
        const t = raw.trim();
        if (t && t !== '...' && curLine !== undefined && pendingSrc === undefined) {
            pendingSrc = t;
        }
    }
    return { insns, fns };
}
/** 二分找 addr 所在/之前最近的指令下标（无指令返回 -1） */
function findInsnIndex(insns, addr) {
    let lo = 0;
    let hi = insns.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (insns[mid].addr <= addr) {
            best = mid;
            lo = mid + 1;
        }
        else {
            hi = mid - 1;
        }
    }
    return best;
}
/** 找包含 addr 的函数（无则 undefined） */
function findFn(fns, addr) {
    for (const f of fns) {
        if (addr >= f.start && addr < f.end) {
            return f;
        }
    }
    return undefined;
}
/** 源码路径匹配：忽略大小写与斜杠方向；绝对/相对（后缀）路径互通 */
function disasmFileMatches(a, b) {
    if (!a || !b) {
        return false;
    }
    const na = a.replaceAll('\\', '/').toLowerCase().replace(/\/+$/, '');
    const nb = b.replaceAll('\\', '/').toLowerCase().replace(/\/+$/, '');
    return na === nb || na.endsWith('/' + nb) || nb.endsWith('/' + na);
}
//# sourceMappingURL=disasm.js.map