/**
 * 反汇编目录解析测试：objdump -d -S -l 输出 → 指令/函数区间/源码交错。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  disasmFileMatches,
  findFn,
  findInsnIndex,
  mnemonicKind,
  parseObjdumpDisasm,
} from '../src/debug/disasm';

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

test('解析函数区间与指令', () => {
  const cat = parseObjdumpDisasm(SAMPLE);
  assert.equal(cat.fns.length, 2);
  assert.equal(cat.fns[0].name, 'main');
  assert.equal(cat.fns[0].start, 0x08000174);
  assert.equal(cat.fns[0].first, 0);
  assert.equal(cat.fns[1].name, 'step');
  assert.equal(cat.insns.length, 5);
  assert.equal(cat.insns[0].addr, 0x08000174);
  assert.equal(cat.insns[0].bytes, '2500');
  assert.equal(cat.insns[0].text, 'movs\tr5, #0');
});

test('源码行与文件:行归属', () => {
  const cat = parseObjdumpDisasm(SAMPLE);
  assert.equal(cat.insns[0].file, 'main.c');
  assert.equal(cat.insns[0].line, 56);
  assert.equal(cat.insns[0].src, 'int cnt = 0;');
  // 第二条指令属于 57 行；"..." 续行不当源码文本
  assert.equal(cat.insns[1].line, 57);
  assert.equal(cat.insns[1].src, undefined);
  assert.equal(cat.insns[4].src, undefined);
});

test('按地址定位指令与函数', () => {
  const cat = parseObjdumpDisasm(SAMPLE);
  assert.equal(findInsnIndex(cat.insns, 0x08000176), 1);
  // 函数间空隙：返回之前的指令
  assert.equal(findInsnIndex(cat.insns, 0x08000180), 2);
  assert.equal(findFn(cat.fns, 0x08000177)?.name, 'main');
  assert.equal(findFn(cat.fns, 0x080001d3)?.name, 'step');
  assert.equal(findFn(cat.fns, 0x08000fff), undefined);
});

test('Windows 盘符路径的定位标记可解析（联动根因回归）', () => {
  const cat = parseObjdumpDisasm(WIN_SAMPLE);
  assert.equal(cat.insns.length, 1);
  assert.equal(cat.insns[0].file, 'D:/cs/ss/Core/Src/main.c');
  assert.equal(cat.insns[0].line, 117);
});

test('源码路径匹配：大小写/斜杠/相对后缀互通', () => {
  assert.equal(disasmFileMatches('D:/cs/ss/Core/Src/main.c', 'd:\\cs\\ss\\Core\\Src\\main.c'), true);
  assert.equal(disasmFileMatches('Core/Src/main.c', 'd:\\cs\\ss\\Core\\Src\\main.c'), true);
  assert.equal(disasmFileMatches('D:/cs/ss/main.c', 'd:\\cs\\ss\\Core\\Src\\main.c'), false);
  assert.equal(disasmFileMatches(undefined, 'a.c'), false);
});

test('助记符分类（真实 objdump 制表符输出，含 .w 宽度后缀）', () => {
  // 制表符分隔是 objdump 真实输出格式；.w/.n 宽度后缀需剥离后分类
  assert.equal(mnemonicKind('push\t{r7, lr}'), 'mem');
  assert.equal(mnemonicKind('ldr\tr1, [r7, #0]'), 'mem');
  assert.equal(mnemonicKind('ldr.w\tr7, [sp], #4'), 'mem');
  assert.equal(mnemonicKind('str.w\tr0, [sp, #4]'), 'mem');
  assert.equal(mnemonicKind('bl\t#0x80001a0 <HAL_GetTick>'), 'branch');
  assert.equal(mnemonicKind('b.w\t#0x800'), 'branch');
  assert.equal(mnemonicKind('adds\tr0, #1'), 'alu');
  assert.equal(mnemonicKind('mov\tr0, r5'), 'alu');
  assert.equal(mnemonicKind('vadd.f32\ts0, s1, s2'), 'fpu');
  assert.equal(mnemonicKind('dsb\tsy'), 'system');
  assert.equal(mnemonicKind('nop'), 'other');
});
