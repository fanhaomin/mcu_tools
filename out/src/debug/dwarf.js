"use strict";
/**
 * DWARF 调试信息解析：变量监控的完整类型与地址来源（数组/结构体支持的关键）。
 *
 * 与 symbols.ts（nm 符号表，只有地址+大小）互补：本模块用
 * arm-none-eabi-readelf --debug-dump=info 的文本输出解析 DWARF（工具随
 * ARM GCC 同目录分发），readelf 已把 DWARF 2-5 的差异归一化为统一文本格式。
 *
 * 覆盖：typedef / const / volatile / 指针 / 枚举（含枚举值表）/ 一维与多维
 * 数组（元素类型×个数）/ 结构体与联合（成员偏移，支持嵌套）。
 * 只接受 DW_AT_location 为 DW_OP_addr 的静态存储变量（全局、文件级与函数内
 * static——它们有固定地址）；优化掉或仅在栈/寄存器上的变量（location list）
 * 不会出现，不虚构地址与类型。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExpandable = isExpandable;
exports.legacyFieldsOf = legacyFieldsOf;
exports.materializeChildren = materializeChildren;
exports.encodeValueText = encodeValueText;
exports.decodeTypedSubtree = decodeTypedSubtree;
exports.parseReadelfInfo = parseReadelfInfo;
exports.readDwarfCatalog = readDwarfCatalog;
exports.decodeByType = decodeByType;
const process_1 = require("../util/process");
const typed_1 = require("./typed");
/** 节点可展开（数组有元素 / 结构体有成员） */
function isExpandable(t) {
    if (!t) {
        return false;
    }
    if (t.cat === 'array') {
        return t.count > 0;
    }
    if (t.cat === 'struct') {
        return t.members.length > 0;
    }
    if (t.cat === 'ptr') {
        return !!t.elem && t.elem.bytes > 0;
    }
    return false;
}
/** 从 TypeDesc 取 legacy 标量字段（kind/bytes），聚合尺寸封顶 */
function legacyFieldsOf(t, aggCap) {
    if (t.cat === 'scalar') {
        return { kind: t.kind, bytes: t.bytes };
    }
    if (t.cat === 'bool' || t.cat === 'enum' || t.cat === 'ptr') {
        return { kind: 'u32', bytes: t.bytes };
    }
    return { kind: 'u32', bytes: Math.min(t.bytes, aggCap) };
}
/** 构造子数组类型描述（多维数组第 2 维及以后；一维回落到元素本身） */
function subArrayType(elem, restDims) {
    const count = restDims.reduce((a, b) => a * b, 1);
    return {
        cat: 'array',
        label: `${elem.label}${restDims.map((d) => `[${d > 0 ? d : '?'}]`).join('')}`,
        bytes: Math.min(count * elem.bytes, MAX_DESC_BYTES),
        count,
        dims: restDims.length > 1 ? restDims : undefined,
        elem,
    };
}
/**
 * DWARF 类型 → 一层子节点。
 * 多维数组按维度逐层展开（uint8_t[2][3] → [0]/[1] 两行 uint8_t[3]，
 * 再展开才是标量元素）；一维数组直接物化元素。数组超上限截断并标记。
 */
function materializeChildren(baseAddr, type, parentPath, maxElems = 64) {
    if (type.cat === 'array' && type.count > 0) {
        const nested = !!(type.dims && type.dims.length > 1);
        const outer = nested ? type.dims[0] : type.count;
        const rowType = nested ? subArrayType(type.elem, type.dims.slice(1)) : type.elem;
        const shown = Math.min(outer, maxElems);
        const out = [];
        for (let i = 0; i < shown; i++) {
            const lf = legacyFieldsOf(rowType, maxElems * 8);
            out.push({
                name: `[${i}]`,
                path: `${parentPath}[${i}]`,
                addr: baseAddr + i * rowType.bytes,
                type: rowType,
                kind: lf.kind,
                bytes: lf.bytes,
                typeLabel: rowType.label,
            });
        }
        if (outer > shown && out.length > 0) {
            out[out.length - 1].truncated = true;
        }
        return out;
    }
    if (type.cat === 'struct') {
        return type.members.map((m) => {
            const lf = legacyFieldsOf(m.type, 256);
            return {
                name: m.name,
                path: `${parentPath}.${m.name}`,
                addr: baseAddr + m.offset,
                type: m.type,
                kind: lf.kind,
                bytes: lf.bytes,
                typeLabel: m.type.label,
            };
        });
    }
    return undefined;
}
/**
 * 按类型把用户输入编码为小端字节（写入内存用）。
 * 支持：十进制/0x 十六进制整数（含负数补码）、float/double、true/false、枚举名。
 * 无法按类型解析返回 undefined（调用方提示，不瞎写）。
 */
function encodeValueText(text, type, kind, bytes) {
    const n = Math.max(1, Math.min(8, bytes));
    const b = Buffer.alloc(n);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const t = text.trim();
    if (!t) {
        return undefined;
    }
    const writeBigIntLE = (v) => {
        const mask = (1n << BigInt(n * 8)) - 1n;
        const u = v & mask;
        for (let i = 0; i < n; i++) {
            b[i] = Number((u >> BigInt(8 * i)) & 0xffn);
        }
        return b;
    };
    if (type?.cat === 'bool') {
        const v = /^true$/i.test(t) ? 1 : /^false$/i.test(t) ? 0 : Number(t);
        if (!Number.isFinite(v)) {
            return undefined;
        }
        b[0] = v ? 1 : 0;
        return b;
    }
    if (type?.cat === 'enum') {
        const hit = type.enumerators.find(([name]) => name === t);
        const v = hit ? hit[1] : scalarNum(t);
        if (v === undefined) {
            return undefined;
        }
        return writeBigIntLE(BigInt(Math.trunc(v)));
    }
    const k = type?.cat === 'scalar' ? type.kind : type ? undefined : kind;
    if (k === 'f32' || k === 'f64') {
        const f = Number(t);
        if (!Number.isFinite(f)) {
            return undefined;
        }
        if (k === 'f32' && n >= 4) {
            dv.setFloat32(0, f, true);
        }
        else if (k === 'f64' && n >= 8) {
            dv.setFloat64(0, f, true);
        }
        else {
            return undefined;
        }
        return b;
    }
    try {
        return writeBigIntLE(BigInt(t));
    }
    catch {
        return undefined;
    }
}
/** 文本 → 数值（十进制/0x 十六进制/浮点/负数），失败 undefined */
function scalarNum(s) {
    const hex = /-?0x[0-9a-fA-F]+/.exec(s);
    if (hex) {
        const n = parseInt(hex[0], 16);
        return Number.isFinite(n) ? n : undefined;
    }
    const dec = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/i.exec(s);
    if (dec) {
        const n = Number(dec[0]);
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}
/**
 * 从整块缓冲解码展开的子树：按节点绝对地址切片，递归处理已展开的嵌套节点。
 * 缓冲未覆盖的节点显示 …（ok=false），不猜值。
 */
function decodeTypedSubtree(buf, baseAddr, children, out) {
    if (!buf) {
        return;
    }
    for (const c of children) {
        const off = c.addr !== undefined ? c.addr - baseAddr : -1;
        const bytes = c.bytes ?? 4;
        const slice = off >= 0 && off < buf.length ? buf.subarray(off, off + bytes) : undefined;
        const d = decodeByType(slice, c.type);
        const need = c.type && (c.type.cat === 'array' || c.type.cat === 'struct') ? 1 : bytes;
        out[c.path || c.name] = {
            hex: d.hex,
            value: d.value,
            ok: !!slice && slice.length >= Math.min(need, Math.max(1, bytes)),
        };
        if (c.expanded && c.children) {
            decodeTypedSubtree(buf, baseAddr, c.children, out);
        }
    }
}
const DIE_RE = /^\s*<(\d+)><([0-9a-f]{1,8})>:\s*Abbrev Number:\s*\d+(?:\s*\((DW_TAG_\w+)\))?/;
const ATTR_RE = /^\s*<[0-9a-f]{1,8}>\s+(DW_AT_\w+)\s*:\s?(.*)$/;
/** 属性值 → 名称文本（剥掉 "(indirect string, offset: 0x..)" 包装） */
function attrName(v) {
    const s = v.trim();
    if (s.startsWith('(')) {
        const m = /\)\s*:?\s*(.*)$/.exec(s);
        if (m) {
            return m[1].trim();
        }
    }
    return s;
}
/** 属性值 → 整数（十进制/0x 十六进制），失败 undefined */
function attrInt(v) {
    const s = v.trim();
    const m = /^(0x[0-9a-fA-F]+|-?\d+)/.exec(s);
    if (!m) {
        return undefined;
    }
    const n = /^0x/i.test(m[1]) ? parseInt(m[1], 16) : parseInt(m[1], 10);
    return Number.isFinite(n) ? n : undefined;
}
/** 属性值 → DIE 引用 "<0x1234>" */
function attrRef(v) {
    const m = /^<\s*(0x[0-9a-fA-F]+|\d+)\s*>/.exec(v.trim());
    if (!m) {
        return undefined;
    }
    const n = /^0x/i.test(m[1]) ? parseInt(m[1], 16) : parseInt(m[1], 10);
    return Number.isFinite(n) ? n : undefined;
}
/** DW_AT_encoding 值 → 编码名（"7\t(unsigned)" → unsigned） */
function attrEncoding(v) {
    const m = /\((\w[\w ]*)\)\s*$/.exec(v.trim());
    return m ? m[1].trim() : '';
}
/** DW_AT_location → DW_OP_addr 静态地址（location list / addrx 返回 undefined） */
function attrLocationAddr(v) {
    const m = /\(\s*DW_OP_addr:?\s*([0-9a-fA-F]+)\s*\)/.exec(v);
    if (!m) {
        return undefined;
    }
    const n = parseInt(m[1], 16);
    return Number.isFinite(n) ? n : undefined;
}
/** DW_AT_data_member_location → 字节偏移（数字或 DW_OP_plus_uconst 表达式） */
function attrMemberOffset(v) {
    const direct = attrInt(v);
    if (direct !== undefined) {
        return direct;
    }
    // 表达式形式：`2 byte block: 23 8 	(DW_OP_plus_uconst: 8)`——注解为无歧义十进制
    const m = /\(\s*DW_OP_plus_uconst:?\s*(\d+)\s*\)/.exec(v);
    if (!m) {
        return undefined;
    }
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : undefined;
}
/** 解析 readelf --debug-dump=info 文本 → DIE 表（节内全局偏移为键） */
function parseDies(text) {
    const dies = new Map();
    const parents = [];
    let current;
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const dm = DIE_RE.exec(raw);
        if (dm) {
            const depth = parseInt(dm[1], 10);
            const off = parseInt(dm[2], 16);
            if (dm[3] && Number.isFinite(off)) {
                const die = { off, tag: dm[3], attrs: new Map(), children: [], parent: undefined };
                parents.length = depth; // 截断到当前深度（祖先栈）
                const parent = depth > 0 ? parents[depth - 1] : undefined;
                if (parent) {
                    die.parent = parent;
                    parent.children.push(die);
                }
                parents[depth] = die;
                current = die;
                dies.set(off, die);
            }
            else {
                // Abbrev Number: 0（children 结束标记）
                parents.length = depth;
                current = undefined;
            }
            continue;
        }
        const am = ATTR_RE.exec(raw);
        if (am && current) {
            current.attrs.set(am[1], am[2]);
        }
    }
    return dies;
}
// ---------------- 类型解析 ----------------
const MAX_TYPE_DEPTH = 24;
/** 安全上限：更大的变量/类型不做展开描述（避免异常 DWARF 拖垮解析） */
const MAX_DESC_BYTES = 64 * 1024;
function baseScalar(encoding, bytes, name) {
    // GCC 把 8 位类型编码为 signed char / unsigned char / char（DW_ATE 6/8/2），
    // 与 signed/unsigned 等同处理（ARM 上 char 默认有符号）
    const e = /char/i.test(encoding)
        ? (/unsigned/i.test(encoding) ? 'unsigned' : 'signed')
        : encoding;
    // 源码里写的是 char（ARM 上默认无符号，DWARF 标 DW_ATE_unsigned_char）——
    // 标签如实显示 char，数值解码仍按无符号 8 位走
    const isPlainChar = name === 'char';
    const label = isPlainChar && bytes === 1 ? 'char' :
        (e === 'unsigned' && bytes === 1) ? 'uint8_t' :
            (e === 'unsigned' && bytes === 2) ? 'uint16_t' :
                (e === 'unsigned' && bytes === 4) ? 'uint32_t' :
                    (e === 'unsigned' && bytes === 8) ? 'uint64_t' :
                        (e === 'signed' && bytes === 1) ? 'int8_t' :
                            (e === 'signed' && bytes === 2) ? 'int16_t' :
                                (e === 'signed' && bytes === 4) ? 'int32_t' :
                                    (e === 'signed' && bytes === 8) ? 'int64_t' :
                                        (e === 'float' && bytes === 4) ? 'float' :
                                            (e === 'float' && bytes === 8) ? 'double' :
                                                name || `${bytes}B`;
    const kind = (e === 'unsigned' && bytes === 1) ? 'u8' :
        (e === 'unsigned' && bytes === 2) ? 'u16' :
            (e === 'unsigned' && bytes === 4) ? 'u32' :
                (e === 'unsigned' && bytes === 8) ? 'u64' :
                    (e === 'signed' && bytes === 1) ? 'i8' :
                        (e === 'signed' && bytes === 2) ? 'i16' :
                            (e === 'signed' && bytes === 4) ? 'i32' :
                                (e === 'signed' && bytes === 8) ? 'i64' :
                                    (e === 'float' && bytes === 4) ? 'f32' :
                                        (e === 'float' && bytes === 8) ? 'f64' :
                                            'hex';
    if (kind === 'hex') {
        return { cat: 'opaque', label, bytes: Math.max(1, bytes) };
    }
    return { cat: 'scalar', kind, label, bytes };
}
function resolveType(dies, off, seen, depth) {
    if (off === undefined || depth > MAX_TYPE_DEPTH) {
        return { cat: 'opaque', label: '未知类型', bytes: 4 };
    }
    if (seen.has(off)) {
        return { cat: 'opaque', label: '递归', bytes: 4 };
    }
    const die = dies.get(off);
    if (!die) {
        return { cat: 'opaque', label: '未知类型', bytes: 4 };
    }
    seen.add(off);
    try {
        switch (die.tag) {
            case 'DW_TAG_typedef': {
                const inner = resolveType(dies, attrRef(die.attrs.get('DW_AT_type') ?? ''), seen, depth + 1);
                const name = attrName(die.attrs.get('DW_AT_name') ?? '');
                if (!name) {
                    return inner;
                }
                return { ...inner, label: name, bytes: inner.bytes };
            }
            case 'DW_TAG_const_type':
            case 'DW_TAG_volatile_type':
            case 'DW_TAG_restrict_type': {
                const inner = resolveType(dies, attrRef(die.attrs.get('DW_AT_type') ?? ''), seen, depth + 1);
                const kw = die.tag === 'DW_TAG_const_type' ? 'const ' : die.tag === 'DW_TAG_volatile_type' ? 'volatile ' : '';
                // 折叠重复限定符（DWARF 里同一 qualifier 可能嵌套多层）
                if (!kw || inner.label.startsWith(kw)) {
                    return inner;
                }
                return { ...inner, label: `${kw}${inner.label}` };
            }
            case 'DW_TAG_base_type': {
                const bytes = attrInt(die.attrs.get('DW_AT_byte_size') ?? '') ?? 4;
                const enc = attrEncoding(die.attrs.get('DW_AT_encoding') ?? '');
                const name = attrName(die.attrs.get('DW_AT_name') ?? '');
                if (enc === 'boolean') {
                    return { cat: 'bool', label: bytes === 1 ? 'bool' : `bool(${bytes}B)`, bytes: Math.max(1, bytes) };
                }
                return baseScalar(enc, bytes, name);
            }
            case 'DW_TAG_enumeration_type': {
                const name = attrName(die.attrs.get('DW_AT_name') ?? '');
                const bytes = attrInt(die.attrs.get('DW_AT_byte_size') ?? '') ?? 4;
                const enumerators = [];
                let signed = false;
                const underlying = attrRef(die.attrs.get('DW_AT_type') ?? '');
                if (underlying !== undefined) {
                    const ud = dies.get(underlying);
                    if (ud && ud.tag === 'DW_TAG_base_type') {
                        signed = attrEncoding(ud.attrs.get('DW_AT_encoding') ?? '') === 'signed';
                    }
                }
                for (const ch of die.children) {
                    if (ch.tag !== 'DW_TAG_enumerator') {
                        continue;
                    }
                    const en = attrName(ch.attrs.get('DW_AT_name') ?? '');
                    const ev = attrInt(ch.attrs.get('DW_AT_const_value') ?? '');
                    if (en && ev !== undefined && enumerators.length < 512) {
                        enumerators.push([en, ev]);
                    }
                }
                return {
                    cat: 'enum',
                    label: `enum ${name || '<匿名>'}`,
                    bytes: Math.max(1, Math.min(8, bytes)),
                    signed,
                    enumerators,
                };
            }
            case 'DW_TAG_pointer_type': {
                const target = attrRef(die.attrs.get('DW_AT_type') ?? '');
                const bytes = attrInt(die.attrs.get('DW_AT_byte_size') ?? '') ?? 4;
                const elem = target === undefined ? undefined : resolveType(dies, target, seen, depth + 1);
                const tl = elem ? elem.label : (target === undefined ? 'void' : quickLabel(dies, target, new Set(), 0));
                return { cat: 'ptr', label: `${tl} *`, bytes: Math.max(1, bytes), elem };
            }
            case 'DW_TAG_array_type': {
                const elem = resolveType(dies, attrRef(die.attrs.get('DW_AT_type') ?? ''), seen, depth + 1);
                const dims = [];
                for (const ch of die.children) {
                    if (ch.tag !== 'DW_TAG_subrange_type') {
                        continue;
                    }
                    const ub = attrInt(ch.attrs.get('DW_AT_upper_bound') ?? '');
                    const cnt = attrInt(ch.attrs.get('DW_AT_count') ?? '');
                    if (cnt !== undefined) {
                        dims.push(cnt);
                    }
                    else if (ub !== undefined) {
                        dims.push(ub + 1);
                    }
                    else {
                        dims.push(0); // 长度未知（柔性数组/VLA）
                    }
                }
                if (dims.length === 0) {
                    dims.push(0);
                }
                const count = dims.reduce((a, b) => a * b, 1);
                const total = count * elem.bytes;
                return {
                    cat: 'array',
                    label: `${elem.label}${dims.map((d) => `[${d > 0 ? d : '?'}]`).join('')}`,
                    bytes: Math.min(total, MAX_DESC_BYTES),
                    count,
                    dims: dims.length > 1 ? dims : undefined,
                    elem,
                };
            }
            case 'DW_TAG_structure_type':
            case 'DW_TAG_union_type':
            case 'DW_TAG_class_type': {
                const kw = die.tag === 'DW_TAG_union_type' ? 'union' : die.tag === 'DW_TAG_class_type' ? 'class' : 'struct';
                const name = attrName(die.attrs.get('DW_AT_name') ?? '');
                const bytes = attrInt(die.attrs.get('DW_AT_byte_size') ?? '');
                if (bytes === undefined) {
                    return { cat: 'opaque', label: `${kw} ${name || '<匿名>'}（前向声明）`, bytes: 4 };
                }
                const members = [];
                for (const ch of die.children) {
                    if (ch.tag !== 'DW_TAG_member') {
                        continue;
                    }
                    const mn = attrName(ch.attrs.get('DW_AT_name') ?? '') || '<匿名成员>';
                    if (ch.attrs.has('DW_AT_bit_size') ||
                        ch.attrs.has('DW_AT_data_bit_location') ||
                        ch.attrs.has('DW_AT_bit_offset')) {
                        // 位域成员不做解码（明确状态，不猜测）
                        members.push({
                            name: `${mn}:位域`,
                            offset: attrMemberOffset(ch.attrs.get('DW_AT_data_member_location') ?? '') ?? 0,
                            type: { cat: 'opaque', label: '位域（不解码）', bytes: 0 },
                        });
                        continue;
                    }
                    const mt = resolveType(dies, attrRef(ch.attrs.get('DW_AT_type') ?? ''), seen, depth + 1);
                    const mo = attrMemberOffset(ch.attrs.get('DW_AT_data_member_location') ?? '');
                    members.push({ name: mn, offset: mo ?? 0, type: mt });
                }
                return {
                    cat: 'struct',
                    label: `${kw} ${name || '<匿名>'}`,
                    bytes: Math.min(bytes, MAX_DESC_BYTES),
                    members,
                };
            }
            default: {
                const bytes = attrInt(die.attrs.get('DW_AT_byte_size') ?? '');
                return { cat: 'opaque', label: die.tag.replace(/^DW_TAG_/, ''), bytes: bytes ?? 4 };
            }
        }
    }
    finally {
        seen.delete(off);
    }
}
/** 轻量标签（指针目标显示用，不构建完整描述） */
function quickLabel(dies, off, seen, depth) {
    if (off === undefined || depth > MAX_TYPE_DEPTH || seen.has(off)) {
        return '?';
    }
    const die = dies.get(off);
    if (!die) {
        return '?';
    }
    seen.add(off);
    try {
        switch (die.tag) {
            case 'DW_TAG_typedef':
                return attrName(die.attrs.get('DW_AT_name') ?? '') || quickLabel(dies, attrRef(die.attrs.get('DW_AT_type') ?? ''), seen, depth + 1);
            case 'DW_TAG_const_type':
            case 'DW_TAG_volatile_type':
            case 'DW_TAG_restrict_type': {
                const inner = quickLabel(dies, attrRef(die.attrs.get('DW_AT_type') ?? ''), seen, depth + 1);
                const kw = die.tag === 'DW_TAG_const_type' ? 'const ' : die.tag === 'DW_TAG_volatile_type' ? 'volatile ' : '';
                if (!kw || inner.startsWith(kw)) {
                    return inner;
                }
                return kw + inner;
            }
            case 'DW_TAG_base_type': {
                const bytes = attrInt(die.attrs.get('DW_AT_byte_size') ?? '') ?? 4;
                return baseScalar(attrEncoding(die.attrs.get('DW_AT_encoding') ?? ''), bytes, attrName(die.attrs.get('DW_AT_name') ?? '')).label;
            }
            case 'DW_TAG_enumeration_type':
                return `enum ${attrName(die.attrs.get('DW_AT_name') ?? '') || '<匿名>'}`;
            case 'DW_TAG_pointer_type':
                return `${quickLabel(dies, attrRef(die.attrs.get('DW_AT_type') ?? ''), seen, depth + 1)} *`;
            case 'DW_TAG_array_type': {
                const elem = quickLabel(dies, attrRef(die.attrs.get('DW_AT_type') ?? ''), seen, depth + 1);
                const dims = die.children
                    .filter((c) => c.tag === 'DW_TAG_subrange_type')
                    .map((c) => {
                    const ub = attrInt(c.attrs.get('DW_AT_upper_bound') ?? '');
                    const cnt = attrInt(c.attrs.get('DW_AT_count') ?? '');
                    return cnt !== undefined ? cnt : ub !== undefined ? ub + 1 : 0;
                });
                return `${elem}${(dims.length ? dims : [0]).map((d) => `[${d > 0 ? d : '?'}]`).join('')}`;
            }
            case 'DW_TAG_structure_type':
                return `struct ${attrName(die.attrs.get('DW_AT_name') ?? '') || '<匿名>'}`;
            case 'DW_TAG_union_type':
                return `union ${attrName(die.attrs.get('DW_AT_name') ?? '') || '<匿名>'}`;
            default:
                return die.tag.replace(/^DW_TAG_/, '');
        }
    }
    finally {
        seen.delete(off);
    }
}
/** 最近的功能域祖先（subprogram / 结构体名） */
function scopeOf(die) {
    for (let p = die.parent; p; p = p.parent) {
        if (p.tag === 'DW_TAG_subprogram' || p.tag === 'DW_TAG_structure_type' || p.tag === 'DW_TAG_class_type') {
            return attrName(p.attrs.get('DW_AT_name') ?? '') || '<匿名>';
        }
    }
    return '';
}
/** 编译单元名（变量所属源文件） */
function cuName(die) {
    let p = die;
    while (p) {
        if (p.tag === 'DW_TAG_compile_unit') {
            return attrName(p.attrs.get('DW_AT_name') ?? '') || undefined;
        }
        p = p.parent;
    }
    return undefined;
}
/**
 * 解析 readelf --debug-dump=info 文本 → 变量目录。
 * 只收静态地址变量（DW_OP_addr）；同名 static 取首见（跨文件 static 重名时
 * 目录列表仍保留全部，便于日志排查）。
 */
function parseReadelfInfo(text) {
    const dies = parseDies(text);
    const vars = [];
    const byName = new Map();
    if (dies.size === 0) {
        return { vars, byName, note: 'ELF 无 DWARF 调试信息（Release 构建？需 -g）' };
    }
    for (const die of dies.values()) {
        if (die.tag !== 'DW_TAG_variable' || vars.length >= 20_000) {
            continue;
        }
        if (die.attrs.has('DW_AT_declaration') || die.attrs.has('DW_AT_artificial')) {
            continue;
        }
        const name = attrName(die.attrs.get('DW_AT_name') ?? '');
        if (!name || name.startsWith('__')) {
            continue;
        }
        const loc = die.attrs.get('DW_AT_location') ?? '';
        const addr = attrLocationAddr(loc);
        if (addr === undefined) {
            continue; // 无静态地址（优化/栈上/extern 声明）——不虚构
        }
        const type = resolveType(dies, attrRef(die.attrs.get('DW_AT_type') ?? ''), new Set(), 0);
        vars.push({
            name,
            addr,
            size: Math.max(1, Math.min(type.bytes || 4, MAX_DESC_BYTES)),
            type,
            file: cuName(die),
            scope: scopeOf(die),
            external: die.attrs.has('DW_AT_external'),
        });
        if (!byName.has(name)) {
            byName.set(name, vars[vars.length - 1]);
        }
    }
    if (vars.length === 0) {
        return { vars, byName, note: 'DWARF 中没有静态地址变量' };
    }
    return { vars, byName };
}
/** 运行 readelf 解析 ELF 的 DWARF 变量目录（失败返回 undefined） */
async function readDwarfCatalog(readelfPath, elfPath, timeoutMs = 120_000) {
    try {
        const r = await (0, process_1.execFileSafe)(readelfPath, ['--debug-dump=info', elfPath], { timeoutMs });
        if (r.spawnError || (r.exitCode !== 0 && !r.stdout)) {
            return undefined;
        }
        return parseReadelfInfo(r.stdout);
    }
    catch {
        return undefined;
    }
}
// ---------------- 类型化解码 ----------------
function hexLE(buf, bytes) {
    const n = Math.max(1, Math.min(8, bytes));
    let v = 0n;
    for (let i = 0; i < n && i < buf.length; i++) {
        v |= BigInt(buf[i]) << BigInt(8 * i);
    }
    return `0x${v.toString(16).toUpperCase().padStart(n * 2, '0')}`;
}
function enumNumber(buf, bytes, signed) {
    let v = 0n;
    for (let i = 0; i < bytes && i < buf.length; i++) {
        v |= BigInt(buf[i]) << BigInt(8 * i);
    }
    if (signed) {
        const bits = BigInt(Math.min(8, bytes) * 8);
        const signBit = 1n << (bits - 1n);
        if (v & signBit) {
            v -= 1n << bits;
        }
    }
    return Number(v);
}
/** 按类型描述解码一段小端字节（长度不足返回 …） */
function decodeByType(buf, t) {
    if (!t || !buf || buf.length <= 0) {
        return { value: '…', hex: '' };
    }
    if (t.cat === 'scalar') {
        if (buf.length < t.bytes) {
            return { value: '…', hex: '' };
        }
        const b = buf.subarray(0, t.bytes);
        return { value: (0, typed_1.decodeTyped)(b, t.kind), hex: hexLE(b, t.bytes) };
    }
    if (t.cat === 'bool') {
        if (buf.length < t.bytes) {
            return { value: '…', hex: '' };
        }
        const b = buf.subarray(0, t.bytes);
        const nz = b.some((x) => x !== 0);
        return { value: nz ? 'true' : 'false', hex: hexLE(b, t.bytes) };
    }
    if (t.cat === 'enum') {
        if (buf.length < t.bytes) {
            return { value: '…', hex: '' };
        }
        const b = buf.subarray(0, t.bytes);
        const n = enumNumber(b, t.bytes, t.signed);
        const hit = t.enumerators.find(([, v]) => v === n);
        return { value: hit ? `${hit[0]} (${n})` : String(n), hex: hexLE(b, t.bytes) };
    }
    if (t.cat === 'ptr') {
        if (buf.length < t.bytes) {
            return { value: '…', hex: '' };
        }
        const b = buf.subarray(0, t.bytes);
        return { value: hexLE(b, t.bytes), hex: hexLE(b, t.bytes) };
    }
    if (t.cat === 'array') {
        const shape = t.dims && t.dims.length > 1 ? t.dims.join('×') : `${t.count > 0 ? t.count : '?'}`;
        // char 数组按字符串显示（到 NUL 截止，不可打印字节转义）
        const elem = t.elem;
        if (elem && elem.cat === 'scalar' && elem.bytes === 1 && /char/i.test(elem.label ?? '')) {
            const cap = Math.min(buf.length, t.count > 0 ? t.count : buf.length, 128);
            let out = '';
            let end = cap;
            for (let i = 0; i < cap; i++) {
                const c = buf[i];
                if (c === 0) {
                    end = i;
                    break;
                }
                if (c === 0x5c)
                    out += '\\\\';
                else if (c === 0x22)
                    out += '\\"';
                else if (c === 0x0a)
                    out += '\\n';
                else if (c === 0x0d)
                    out += '\\r';
                else if (c === 0x09)
                    out += '\\t';
                else if (c >= 0x20 && c < 0x7f)
                    out += String.fromCharCode(c);
                else
                    out += `\\x${c.toString(16).padStart(2, '0')}`;
            }
            const truncated = end >= 128 && cap >= 128 ? '…' : '';
            return { value: `"${out}${truncated}"`, hex: '' };
        }
        return { value: `[${shape}${t.dims && t.dims.length > 1 ? '' : ' 项'}]`, hex: '' };
    }
    if (t.cat === 'struct') {
        return { value: `{${t.members.length} 成员}`, hex: '' };
    }
    return { value: '—', hex: '' };
}
//# sourceMappingURL=dwarf.js.map