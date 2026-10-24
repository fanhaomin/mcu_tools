/**
 * hexdump / evaluate 结果解析测试（变量监控与内存视图的纯函数部分）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatHexDump, parseEvalHexAddress, parseEvalInt } from '../src/debug/hexdump';

test('hexdump：16 字节行、地址格式、ASCII 渲染', () => {
  const data = Buffer.concat([
    Buffer.from('Hello', 'ascii'),
    Buffer.from([0x00, 0x01, 0xff, 0x7f]),
    Buffer.alloc(20, 0xab),
  ]);
  const rows = formatHexDump(data, 0x20000000);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].addr, '0x20000000');
  assert.equal(rows[0].bytes[0], '48');
  assert.equal(rows[0].bytes[1], '65');
  assert.equal(rows[0].ascii.slice(0, 5), 'Hello');
  assert.equal(rows[0].ascii[5], '·', '不可打印字符渲染为 ·');
  assert.equal(rows[1].addr, '0x20000010');
  assert.equal(rows[1].bytes.slice(0, 13).every((b) => b === 'AB'), true, 'AB 填充段');
  assert.equal(rows[1].bytes.slice(13).every((b) => b === ''), true, '行尾补空');
});

test('hexdump：末尾不满一行时补空', () => {
  const rows = formatHexDump(Buffer.from([1, 2, 3]), 0x08000000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bytes[0], '01');
  assert.equal(rows[0].bytes[2], '03');
  assert.equal(rows[0].bytes[3], '', '超出数据长度的位置为空');
  assert.equal(rows[0].bytes[15], '');
});

test('evaluate 结果解析：地址（含符号后缀）与十进制整数', () => {
  assert.equal(parseEvalHexAddress('$1 = 0x20000000 <led_count>'), 0x20000000);
  assert.equal(parseEvalHexAddress('0x40010800'), 0x40010800);
  assert.equal(parseEvalHexAddress('No symbols'), undefined);
  assert.equal(parseEvalInt('$2 = 4'), 4);
  assert.equal(parseEvalInt('size = 12 bytes'), 12);
  assert.equal(parseEvalInt(''), undefined);
});
