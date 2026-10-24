"use strict";
/**
 * DWARF 变量目录解析测试：夹具为 arm-none-eabi-gcc 14.3 (binutils readelf 2.44,
 * DWARF 5) 的真实输出——覆盖 typedef/枚举/一维与多维数组/嵌套结构体/指针/
 * const/volatile/函数内 static。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dwarf_1 = require("../src/debug/dwarf");
const FIXTURE_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures');
const dumpO0 = fs.readFileSync(path.join(FIXTURE_DIR, 'dwarf-info-o0.txt'), 'utf8');
const dumpTwoCu = fs.readFileSync(path.join(FIXTURE_DIR, 'dwarf-info-two-cu.txt'), 'utf8');
(0, node_test_1.test)('DWARF 解析：基础标量（volatile uint32_t / const float），地址来自 DW_OP_addr', () => {
    const cat = (0, dwarf_1.parseReadelfInfo)(dumpO0);
    const tick = cat.byName.get('g_tick');
    strict_1.default.ok(tick, 'g_tick 应被解析');
    strict_1.default.equal(tick.addr, 0x905c);
    strict_1.default.equal(tick.type.label, 'volatile uint32_t');
    strict_1.default.equal(tick.type.cat, 'scalar');
    strict_1.default.equal(tick.type.kind, 'u32');
    strict_1.default.equal(tick.type.bytes, 4);
    strict_1.default.equal(tick.external, true);
    strict_1.default.equal(tick.file, 't.c');
    const pi = cat.byName.get('g_pi');
    strict_1.default.ok(pi);
    strict_1.default.equal(pi.type.label, 'const float');
    strict_1.default.equal(pi.type.cat, 'scalar');
});
(0, node_test_1.test)('DWARF 解析：一维数组（uint16_t[4]，static 作用域）', () => {
    const cat = (0, dwarf_1.parseReadelfInfo)(dumpO0);
    const v = cat.byName.get('s_counters');
    strict_1.default.ok(v, 's_counters 应被解析');
    strict_1.default.equal(v.addr, 0x9054);
    strict_1.default.equal(v.type.cat, 'array');
    strict_1.default.equal(v.type.label, 'uint16_t[4]');
    const arr = v.type;
    strict_1.default.equal(arr.count, 4);
    strict_1.default.equal(arr.bytes, 8);
    strict_1.default.equal(arr.elem.cat, 'scalar');
    strict_1.default.equal(arr.elem.label, 'uint16_t');
    strict_1.default.equal(v.external, false, 'static 变量非 external');
    strict_1.default.equal((0, dwarf_1.isExpandable)(v.type), true);
});
(0, node_test_1.test)('DWARF 解析：多维数组 uint8_t[2][3] 保留维度结构', () => {
    const cat = (0, dwarf_1.parseReadelfInfo)(dumpO0);
    const v = cat.byName.get('g_matrix');
    strict_1.default.ok(v);
    strict_1.default.equal(v.type.cat, 'array');
    const arr = v.type;
    strict_1.default.equal(arr.label, 'uint8_t[2][3]');
    strict_1.default.deepEqual(arr.dims, [2, 3], '各维长度保留（不压平）');
    strict_1.default.equal(arr.count, 6, 'count = 2×3 总元素数');
    strict_1.default.equal(arr.bytes, 6);
    strict_1.default.equal((0, dwarf_1.decodeByType)(Buffer.alloc(6), arr).value, '[2×3]');
});
(0, node_test_1.test)('DWARF 解析：结构体 typedef + 成员偏移（含内嵌数组）', () => {
    const cat = (0, dwarf_1.parseReadelfInfo)(dumpO0);
    const v = cat.byName.get('g_sensor');
    strict_1.default.ok(v);
    strict_1.default.equal(v.type.cat, 'struct');
    strict_1.default.equal(v.type.label, 'sensor_t', 'typedef 名作为标签');
    const st = v.type;
    strict_1.default.equal(st.bytes, 16);
    strict_1.default.deepEqual(st.members.map((m) => [m.name, m.offset]), [['raw', 0], ['scale', 8], ['state', 12]], 'raw[3] 占 6B + 对齐填充 → scale@8');
    const raw = st.members[0].type;
    strict_1.default.equal(raw.label, 'uint16_t[3]');
    strict_1.default.equal(st.members[1].type.label, 'float');
});
(0, node_test_1.test)('DWARF 解析：枚举含取值表，typedef 标签', () => {
    const cat = (0, dwarf_1.parseReadelfInfo)(dumpO0);
    const sensor = cat.byName.get('g_sensor');
    const state = sensor.type.members[2].type;
    strict_1.default.equal(state.label, 'led_state_t');
    strict_1.default.deepEqual(state.enumerators, [['LED_OFF', 0], ['LED_ON', 1], ['LED_BLINK', 4]]);
    strict_1.default.equal(state.bytes, 1);
});
(0, node_test_1.test)('DWARF 解析：指针类型标签与字节数', () => {
    const cat = (0, dwarf_1.parseReadelfInfo)(dumpO0);
    const v = cat.byName.get('g_ptr');
    strict_1.default.ok(v);
    strict_1.default.equal(v.type.cat, 'ptr');
    strict_1.default.equal(v.type.label, 'int32_t *');
    strict_1.default.equal(v.type.bytes, 4);
});
(0, node_test_1.test)('DWARF 解析：嵌套结构体成员偏移', () => {
    const cat = (0, dwarf_1.parseReadelfInfo)(dumpO0);
    const v = cat.byName.get('g_nested');
    strict_1.default.ok(v);
    const outer = v.type;
    strict_1.default.equal(outer.bytes, 8);
    strict_1.default.deepEqual(outer.members.map((m) => [m.name, m.offset]), [['inner', 0], ['c', 4]]);
    const inner = outer.members[0].type;
    strict_1.default.deepEqual(inner.members.map((m) => [m.name, m.offset]), [['a', 0], ['b', 2]], 'a@0 + 对齐 → b@2，inner 共 4B');
});
(0, node_test_1.test)('DWARF 解析：函数内 static 变量带作用域', () => {
    const cat = (0, dwarf_1.parseReadelfInfo)(dumpO0);
    const v = cat.byName.get('inited');
    strict_1.default.ok(v);
    strict_1.default.equal(v.scope, 'loc_static');
    strict_1.default.equal(v.type.label, 'uint8_t');
    strict_1.default.equal(cat.byName.get('s_counters')?.scope, '', '文件级 static 无函数作用域');
});
(0, node_test_1.test)('DWARF 解析：8 位类型（signed char/unsigned char 编码）解析为标量可解码，不是 opaque', () => {
    const cat = (0, dwarf_1.parseReadelfInfo)(dumpO0);
    // GCC 对 uint8_t/int8_t 使用 DW_ATE_unsigned_char(8)/signed_char(6) 编码
    const inited = cat.byName.get('inited');
    strict_1.default.equal(inited.type.cat, 'scalar', 'uint8_t 应为标量（此前误落 opaque 显示 —）');
    strict_1.default.equal(inited.type.kind, 'u8');
    const matrix = cat.byName.get('g_matrix');
    const elem = matrix.type.elem;
    strict_1.default.equal(elem.cat, 'scalar', 'uint8_t 数组元素应为标量');
    strict_1.default.equal(elem.kind, 'u8');
    strict_1.default.equal((0, dwarf_1.decodeByType)(Buffer.from([200]), elem).value, '200');
    const i8 = { cat: 'scalar', kind: 'i8', label: 'int8_t', bytes: 1 };
    strict_1.default.equal((0, dwarf_1.decodeByType)(Buffer.from([0xf8]), i8).value, '-8');
});
(0, node_test_1.test)('DWARF 解析：多编译单元偏移不串（引用按节内全局偏移解析）', () => {
    const cat = (0, dwarf_1.parseReadelfInfo)(dumpTwoCu);
    const dupes = cat.vars.filter((v) => v.name === 'au_counter');
    strict_1.default.equal(dupes.length, 2, '两个 CU 各有一个 static au_counter');
    strict_1.default.notEqual(dupes[0].addr, dupes[1].addr);
    for (const v of dupes) {
        const arr = v.type;
        strict_1.default.equal(arr.label, 'uint32_t[3]', `${v.file} 的类型应解析为本 CU 的数组（unsigned int 归一化为 uint32_t）`);
        strict_1.default.equal(arr.count, 3);
        strict_1.default.equal(arr.elem.cat, 'scalar');
    }
    strict_1.default.equal(cat.byName.get('au_counter'), dupes[0], '同名取首见');
});
(0, node_test_1.test)('DWARF 解析：无调试信息 / 空输入', () => {
    const cat = (0, dwarf_1.parseReadelfInfo)('');
    strict_1.default.equal(cat.vars.length, 0);
    strict_1.default.ok(cat.note);
    const cat2 = (0, dwarf_1.parseReadelfInfo)('Contents of the .debug_info section:\n\nnothing here');
    strict_1.default.equal(cat2.vars.length, 0);
});
(0, node_test_1.test)('类型化解码：枚举/布尔/标量/聚合概要', () => {
    const scalar = { cat: 'scalar', kind: 'u16', label: 'uint16_t', bytes: 2 };
    strict_1.default.deepEqual((0, dwarf_1.decodeByType)(Buffer.from([0x34, 0x12]), scalar), { value: '4660', hex: '0x1234' });
    const f32 = { cat: 'scalar', kind: 'f32', label: 'float', bytes: 4 };
    const fv = (0, dwarf_1.decodeByType)(Buffer.from([0, 0, 0x70, 0x41]), f32);
    strict_1.default.equal(fv.value, '15');
    const en = {
        cat: 'enum', label: 'led_state_t', bytes: 1, signed: false,
        enumerators: [['LED_OFF', 0], ['LED_ON', 1], ['LED_BLINK', 4]],
    };
    strict_1.default.equal((0, dwarf_1.decodeByType)(Buffer.from([4]), en).value, 'LED_BLINK (4)');
    strict_1.default.equal((0, dwarf_1.decodeByType)(Buffer.from([2]), en).value, '2', '未定义值显示数字');
    const bool = { cat: 'bool', label: 'bool', bytes: 1 };
    strict_1.default.equal((0, dwarf_1.decodeByType)(Buffer.from([1]), bool).value, 'true');
    strict_1.default.equal((0, dwarf_1.decodeByType)(Buffer.from([0]), bool).value, 'false');
    const ptr = { cat: 'ptr', label: 'int32_t *', bytes: 4 };
    strict_1.default.equal((0, dwarf_1.decodeByType)(Buffer.from([0x5c, 0x90, 0, 0]), ptr).value, '0x0000905C');
    const arr = { cat: 'array', label: 'uint16_t[4]', bytes: 8, count: 4, elem: scalar };
    strict_1.default.equal((0, dwarf_1.decodeByType)(Buffer.alloc(8), arr).value, '[4 项]');
    const st = { cat: 'struct', label: 'struct x', bytes: 8, members: [] };
    strict_1.default.equal((0, dwarf_1.decodeByType)(Buffer.alloc(8), st).value, '{0 成员}');
    // 缓冲不足 → 明确的 … 而不是乱猜
    strict_1.default.equal((0, dwarf_1.decodeByType)(Buffer.from([1]), scalar).value, '…');
    strict_1.default.equal((0, dwarf_1.decodeByType)(undefined, scalar).value, '…');
});
(0, node_test_1.test)('类型化解码：有符号枚举负值', () => {
    const en = {
        cat: 'enum', label: 'err_t', bytes: 4, signed: true,
        enumerators: [['ERR', -1]],
    };
    strict_1.default.equal((0, dwarf_1.decodeByType)(Buffer.from([0xff, 0xff, 0xff, 0xff]), en).value, 'ERR (-1)');
});
// ---------------- 监控树展开（数组/结构体支持的核心逻辑） ----------------
const catalogO0 = (0, dwarf_1.parseReadelfInfo)(dumpO0);
(0, node_test_1.test)('展开物化：数组元素地址按元素大小递增', () => {
    const v = catalogO0.byName.get('s_counters');
    const kids = (0, dwarf_1.materializeChildren)(v.addr, v.type, '');
    strict_1.default.equal(kids.length, 4);
    strict_1.default.deepEqual(kids.map((k) => [k.name, k.path, k.addr]), [['[0]', '[0]', 0x9054], ['[1]', '[1]', 0x9056], ['[2]', '[2]', 0x9058], ['[3]', '[3]', 0x905a]]);
    strict_1.default.equal(kids[0].typeLabel, 'uint16_t');
    strict_1.default.equal(kids[0].kind, 'u16');
    strict_1.default.equal(kids.every((k) => !k.truncated), true);
});
(0, node_test_1.test)('展开物化：多维数组按维度逐层展开（行 → 元素）', () => {
    const v = catalogO0.byName.get('g_matrix');
    const rows = (0, dwarf_1.materializeChildren)(v.addr, v.type, '');
    strict_1.default.equal(rows.length, 2, '外层 2 行');
    strict_1.default.deepEqual(rows.map((r) => [r.path, r.addr, r.typeLabel, r.type.cat]), [['[0]', 0x9070, 'uint8_t[3]', 'array'], ['[1]', 0x9073, 'uint8_t[3]', 'array']], '每行是子数组 uint8_t[3]，地址按行步进');
    const elems = (0, dwarf_1.materializeChildren)(0x9070, rows[0].type, '[0]');
    strict_1.default.deepEqual(elems.map((e2) => [e2.path, e2.addr]), [['[0][0]', 0x9070], ['[0][1]', 0x9071], ['[0][2]', 0x9072]]);
    strict_1.default.equal(elems[0].type.cat, 'scalar');
    strict_1.default.equal(elems.every((e2) => !e2.truncated), true);
});
(0, node_test_1.test)('展开物化：结构体成员带偏移地址，嵌套数组可再展开', () => {
    const v = catalogO0.byName.get('g_sensor');
    const kids = (0, dwarf_1.materializeChildren)(v.addr, v.type, '');
    strict_1.default.deepEqual(kids.map((k) => [k.path, k.addr, k.typeLabel]), [['.raw', 0x9060, 'uint16_t[3]'], ['.scale', 0x9068, 'float'], ['.state', 0x906c, 'led_state_t']]);
    // 成员 raw 是数组 → 以 sensor 根路径继续物化元素
    const elems = (0, dwarf_1.materializeChildren)(0x9060, kids[0].type, '.raw');
    strict_1.default.deepEqual(elems.map((e2) => [e2.path, e2.addr]), [['.raw[0]', 0x9060], ['.raw[1]', 0x9062], ['.raw[2]', 0x9064]]);
});
(0, node_test_1.test)('展开物化：大数组截断到上限并标记', () => {
    const elem = { cat: 'scalar', kind: 'u32', label: 'uint32_t', bytes: 4 };
    const big = { cat: 'array', label: 'uint32_t[100]', bytes: 400, count: 100, elem };
    const kids = (0, dwarf_1.materializeChildren)(0x20000000, big, '');
    strict_1.default.equal(kids.length, 64);
    strict_1.default.equal(kids[kids.length - 1].truncated, true, '最后一项带截断标记');
    strict_1.default.equal(!!kids[0].truncated, false, '其余项不带标记');
    // 标量数组不截断
    const small = { cat: 'array', label: 'uint32_t[3]', bytes: 12, count: 3, elem };
    strict_1.default.equal((0, dwarf_1.materializeChildren)(0, small, '').every((k) => !k.truncated), true);
});
(0, node_test_1.test)('子树解码：一次整块读 → 按偏移切片，元素/成员/嵌套递归', () => {
    // g_sensor @0x9060: raw[3] u16 @0, scale float @8, state enum @12
    const buf = Buffer.alloc(16);
    buf.writeUInt16LE(100, 0);
    buf.writeUInt16LE(200, 2);
    buf.writeUInt16LE(300, 4);
    buf.writeFloatLE(1.5, 8);
    buf.writeUInt8(4, 12); // LED_BLINK
    const rootKids = (0, dwarf_1.materializeChildren)(0x9060, catalogO0.byName.get('g_sensor').type, '');
    // raw 成员展开其元素
    rootKids[0].expanded = true;
    rootKids[0].children = (0, dwarf_1.materializeChildren)(0x9060, rootKids[0].type, '.raw');
    const out = {};
    (0, dwarf_1.decodeTypedSubtree)(buf, 0x9060, rootKids, out);
    strict_1.default.equal(out['.raw'].value, '[3 项]');
    strict_1.default.equal(out['.raw[0]'].value, '100');
    strict_1.default.equal(out['.raw[1]'].value, '200');
    strict_1.default.equal(out['.raw[2]'].value, '300');
    strict_1.default.equal(out['.raw[2]'].hex, '0x012C');
    strict_1.default.equal(out['.scale'].value, '1.5');
    strict_1.default.equal(out['.state'].value, 'LED_BLINK (4)');
    strict_1.default.equal(Object.keys(out).length, 6);
});
(0, node_test_1.test)('子树解码：缓冲未覆盖的节点明确失败（不猜值）', () => {
    const buf = Buffer.alloc(4); // 只有 4 字节
    const rootKids = (0, dwarf_1.materializeChildren)(0x9060, catalogO0.byName.get('g_sensor').type, '');
    const out = {};
    (0, dwarf_1.decodeTypedSubtree)(buf, 0x9060, rootKids, out);
    strict_1.default.equal(out['.raw'].ok, true, '部分覆盖的数组节点仍显示概要（概要来自类型，非数据）');
    strict_1.default.equal(out['.scale'].ok, false, '偏移 8 超出缓冲');
    strict_1.default.equal(out['.scale'].value, '…');
    strict_1.default.equal(out['.state'].ok, false, '偏移 12 超出缓冲');
    strict_1.default.equal(out['.state'].value, '…');
});
// ---------------- 写入编码（设置值用） ----------------
(0, node_test_1.test)('写入编码：整数（十进制/0x/负数补码）小端字节', () => {
    const u16 = { cat: 'scalar', kind: 'u16', label: 'uint16_t', bytes: 2 };
    strict_1.default.deepEqual([...(0, dwarf_1.encodeValueText)('4660', u16, 'u16', 2)], [0x34, 0x12]);
    strict_1.default.deepEqual([...(0, dwarf_1.encodeValueText)('0x1234', u16, 'u16', 2)], [0x34, 0x12]);
    const i8 = { cat: 'scalar', kind: 'i8', label: 'int8_t', bytes: 1 };
    strict_1.default.deepEqual([...(0, dwarf_1.encodeValueText)('-8', i8, 'i8', 1)], [0xf8], '负数按补码截断');
    const u64 = { cat: 'scalar', kind: 'u64', label: 'uint64_t', bytes: 8 };
    strict_1.default.deepEqual([...(0, dwarf_1.encodeValueText)('1', u64, 'u64', 8)], [1, 0, 0, 0, 0, 0, 0, 0]);
});
(0, node_test_1.test)('写入编码：float/double IEEE754 小端', () => {
    const f32 = { cat: 'scalar', kind: 'f32', label: 'float', bytes: 4 };
    strict_1.default.deepEqual([...(0, dwarf_1.encodeValueText)('1.5', f32, 'f32', 4)], [0, 0, 0xc0, 0x3f]);
    const f64 = { cat: 'scalar', kind: 'f64', label: 'double', bytes: 8 };
    const b = (0, dwarf_1.encodeValueText)('0.125', f64, 'f64', 8);
    strict_1.default.equal(b.length, 8);
    strict_1.default.deepEqual([...b.subarray(4)], [0, 0, 0xc0, 0x3f], '0.125 = 0x3FC0000000000000 小端');
});
(0, node_test_1.test)('写入编码：布尔 true/false 与枚举名', () => {
    const bo = { cat: 'bool', label: 'bool', bytes: 1 };
    strict_1.default.deepEqual([...(0, dwarf_1.encodeValueText)('true', bo, 'u32', 1)], [1]);
    strict_1.default.deepEqual([...(0, dwarf_1.encodeValueText)('false', bo, 'u32', 1)], [0]);
    strict_1.default.equal((0, dwarf_1.encodeValueText)('abc', bo, 'u32', 1), undefined);
    const en = {
        cat: 'enum', label: 'led_state_t', bytes: 1, signed: false,
        enumerators: [['LED_OFF', 0], ['LED_ON', 1], ['LED_BLINK', 4]],
    };
    strict_1.default.deepEqual([...(0, dwarf_1.encodeValueText)('LED_BLINK', en, 'u32', 1)], [4]);
    strict_1.default.deepEqual([...(0, dwarf_1.encodeValueText)('2', en, 'u32', 1)], [2], '枚举也接受数字');
});
(0, node_test_1.test)('写入编码：非法输入拒绝（不瞎写）', () => {
    const i32 = { cat: 'scalar', kind: 'i32', label: 'int32_t', bytes: 4 };
    strict_1.default.equal((0, dwarf_1.encodeValueText)('3.5', i32, 'i32', 4), undefined, '整数类型不接受小数');
    strict_1.default.equal((0, dwarf_1.encodeValueText)('abc', i32, 'i32', 4), undefined);
    strict_1.default.equal((0, dwarf_1.encodeValueText)('', i32, 'i32', 4), undefined);
});
//# sourceMappingURL=dwarf.test.js.map