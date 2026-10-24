/**
 * ELF 符号表解析测试（变量监控的离线地址解析）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNmOutput } from '../src/debug/symbols';

const NM_OUT = [
  '20000000 00000050 A my_big_array',
  '20000010 00000004 b led_toggle_count',
  '20000014 00000004 B uwTick',
  '08000179 00000002 t SomeFunc',
  '20000018        D g_flags',
  'garbage line',
  '',
].join('\n');

test('nm 输出解析：地址/大小(hex)/类型/名称，无大小默认 4', () => {
  const m = parseNmOutput(NM_OUT);
  assert.equal(m.size, 5);
  assert.deepEqual(m.get('led_toggle_count'), { addr: 0x20000010, size: 4 });
  assert.deepEqual(m.get('my_big_array'), { addr: 0x20000000, size: 0x50 });
  assert.deepEqual(m.get('uwTick'), { addr: 0x20000014, size: 4 });
  assert.deepEqual(m.get('SomeFunc'), { addr: 0x08000179, size: 2 });
  assert.deepEqual(m.get('g_flags'), { addr: 0x20000018, size: 4 }, '无大小字段默认 4B');
  assert.equal(m.has('garbage'), false);
});

test('nm 输出解析：同名符号首见优先，乱行跳过', () => {
  const m = parseNmOutput('20000000 00000004 D dup\n20000100 00000004 D dup\nnot nm at all');
  assert.equal(m.size, 1);
  assert.equal(m.get('dup')?.addr, 0x20000000);
});
