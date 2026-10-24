"use strict";
/**
 * hexdump / evaluate 结果解析测试（变量监控与内存视图的纯函数部分）。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const hexdump_1 = require("../src/debug/hexdump");
(0, node_test_1.test)('hexdump：16 字节行、地址格式、ASCII 渲染', () => {
    const data = Buffer.concat([
        Buffer.from('Hello', 'ascii'),
        Buffer.from([0x00, 0x01, 0xff, 0x7f]),
        Buffer.alloc(20, 0xab),
    ]);
    const rows = (0, hexdump_1.formatHexDump)(data, 0x20000000);
    strict_1.default.equal(rows.length, 2);
    strict_1.default.equal(rows[0].addr, '0x20000000');
    strict_1.default.equal(rows[0].bytes[0], '48');
    strict_1.default.equal(rows[0].bytes[1], '65');
    strict_1.default.equal(rows[0].ascii.slice(0, 5), 'Hello');
    strict_1.default.equal(rows[0].ascii[5], '·', '不可打印字符渲染为 ·');
    strict_1.default.equal(rows[1].addr, '0x20000010');
    strict_1.default.equal(rows[1].bytes.slice(0, 13).every((b) => b === 'AB'), true, 'AB 填充段');
    strict_1.default.equal(rows[1].bytes.slice(13).every((b) => b === ''), true, '行尾补空');
});
(0, node_test_1.test)('hexdump：末尾不满一行时补空', () => {
    const rows = (0, hexdump_1.formatHexDump)(Buffer.from([1, 2, 3]), 0x08000000);
    strict_1.default.equal(rows.length, 1);
    strict_1.default.equal(rows[0].bytes[0], '01');
    strict_1.default.equal(rows[0].bytes[2], '03');
    strict_1.default.equal(rows[0].bytes[3], '', '超出数据长度的位置为空');
    strict_1.default.equal(rows[0].bytes[15], '');
});
(0, node_test_1.test)('evaluate 结果解析：地址（含符号后缀）与十进制整数', () => {
    strict_1.default.equal((0, hexdump_1.parseEvalHexAddress)('$1 = 0x20000000 <led_count>'), 0x20000000);
    strict_1.default.equal((0, hexdump_1.parseEvalHexAddress)('0x40010800'), 0x40010800);
    strict_1.default.equal((0, hexdump_1.parseEvalHexAddress)('No symbols'), undefined);
    strict_1.default.equal((0, hexdump_1.parseEvalInt)('$2 = 4'), 4);
    strict_1.default.equal((0, hexdump_1.parseEvalInt)('size = 12 bytes'), 12);
    strict_1.default.equal((0, hexdump_1.parseEvalInt)(''), undefined);
});
//# sourceMappingURL=watchMem.test.js.map