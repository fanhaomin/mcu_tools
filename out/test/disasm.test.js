"use strict";
/**
 * 反汇编目录解析测试：objdump -d -S -l 输出 → 指令/函数区间/源码交错。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const disasm_1 = require("../src/debug/disasm");
const SAMPLE = [
    '08000174 <main>:',
    'main():',
    'main.c:56',
    '        int cnt = 0;',
    ' 8000174:\t2500      \tmovs\tr5, #0',
    'main.c:57',
    ' 8000176:\tf000 f85a \tbl\t#0x80001d2 <step>',
    ' 800017a:\t4628     \tmov\tr0, r5',
    '080001d2 <step>:',
    ' 80001d2:\tb507     \tpush\t{r1, r2, lr}',
    '...',
    ' 80001d4:\t4770     \tblx\tlr',
].join('\n');
// Windows 实测格式：绝对路径带盘符冒号（D:/cs/ss/Core/Src/main.c:117）
const WIN_SAMPLE = [
    '08001a74 <main>:',
    'main():',
    'D:/cs/ss/Core/Src/main.c:117',
    ' 8001a74:\tb507     \tpush\t{r1, r2, lr}',
].join('\n');
(0, node_test_1.test)('解析函数区间与指令', () => {
    const cat = (0, disasm_1.parseObjdumpDisasm)(SAMPLE);
    strict_1.default.equal(cat.fns.length, 2);
    strict_1.default.equal(cat.fns[0].name, 'main');
    strict_1.default.equal(cat.fns[0].start, 0x08000174);
    strict_1.default.equal(cat.fns[0].first, 0);
    strict_1.default.equal(cat.fns[1].name, 'step');
    strict_1.default.equal(cat.insns.length, 5);
    strict_1.default.equal(cat.insns[0].addr, 0x08000174);
    strict_1.default.equal(cat.insns[0].bytes, '2500');
    strict_1.default.equal(cat.insns[0].text, 'movs\tr5, #0');
});
(0, node_test_1.test)('源码行与文件:行归属', () => {
    const cat = (0, disasm_1.parseObjdumpDisasm)(SAMPLE);
    strict_1.default.equal(cat.insns[0].file, 'main.c');
    strict_1.default.equal(cat.insns[0].line, 56);
    strict_1.default.equal(cat.insns[0].src, 'int cnt = 0;');
    // 第二条指令属于 57 行；"..." 续行不当源码文本
    strict_1.default.equal(cat.insns[1].line, 57);
    strict_1.default.equal(cat.insns[1].src, undefined);
    strict_1.default.equal(cat.insns[4].src, undefined);
});
(0, node_test_1.test)('按地址定位指令与函数', () => {
    const cat = (0, disasm_1.parseObjdumpDisasm)(SAMPLE);
    strict_1.default.equal((0, disasm_1.findInsnIndex)(cat.insns, 0x08000176), 1);
    // 函数间空隙：返回之前的指令
    strict_1.default.equal((0, disasm_1.findInsnIndex)(cat.insns, 0x08000180), 2);
    strict_1.default.equal((0, disasm_1.findFn)(cat.fns, 0x08000177)?.name, 'main');
    strict_1.default.equal((0, disasm_1.findFn)(cat.fns, 0x080001d3)?.name, 'step');
    strict_1.default.equal((0, disasm_1.findFn)(cat.fns, 0x08000fff), undefined);
});
(0, node_test_1.test)('Windows 盘符路径的定位标记可解析（联动根因回归）', () => {
    const cat = (0, disasm_1.parseObjdumpDisasm)(WIN_SAMPLE);
    strict_1.default.equal(cat.insns.length, 1);
    strict_1.default.equal(cat.insns[0].file, 'D:/cs/ss/Core/Src/main.c');
    strict_1.default.equal(cat.insns[0].line, 117);
});
(0, node_test_1.test)('源码路径匹配：大小写/斜杠/相对后缀互通', () => {
    strict_1.default.equal((0, disasm_1.disasmFileMatches)('D:/cs/ss/Core/Src/main.c', 'd:\\cs\\ss\\Core\\Src\\main.c'), true);
    strict_1.default.equal((0, disasm_1.disasmFileMatches)('Core/Src/main.c', 'd:\\cs\\ss\\Core\\Src\\main.c'), true);
    strict_1.default.equal((0, disasm_1.disasmFileMatches)('D:/cs/ss/main.c', 'd:\\cs\\ss\\Core\\Src\\main.c'), false);
    strict_1.default.equal((0, disasm_1.disasmFileMatches)(undefined, 'a.c'), false);
});
(0, node_test_1.test)('助记符分类（真实 objdump 制表符输出，含 .w 宽度后缀）', () => {
    // 制表符分隔是 objdump 真实输出格式；.w/.n 宽度后缀需剥离后分类
    strict_1.default.equal((0, disasm_1.mnemonicKind)('push\t{r7, lr}'), 'mem');
    strict_1.default.equal((0, disasm_1.mnemonicKind)('ldr\tr1, [r7, #0]'), 'mem');
    strict_1.default.equal((0, disasm_1.mnemonicKind)('ldr.w\tr7, [sp], #4'), 'mem');
    strict_1.default.equal((0, disasm_1.mnemonicKind)('str.w\tr0, [sp, #4]'), 'mem');
    strict_1.default.equal((0, disasm_1.mnemonicKind)('bl\t#0x80001a0 <HAL_GetTick>'), 'branch');
    strict_1.default.equal((0, disasm_1.mnemonicKind)('b.w\t#0x800'), 'branch');
    strict_1.default.equal((0, disasm_1.mnemonicKind)('adds\tr0, #1'), 'alu');
    strict_1.default.equal((0, disasm_1.mnemonicKind)('mov\tr0, r5'), 'alu');
    strict_1.default.equal((0, disasm_1.mnemonicKind)('vadd.f32\ts0, s1, s2'), 'fpu');
    strict_1.default.equal((0, disasm_1.mnemonicKind)('dsb\tsy'), 'system');
    strict_1.default.equal((0, disasm_1.mnemonicKind)('nop'), 'other');
});
//# sourceMappingURL=disasm.test.js.map