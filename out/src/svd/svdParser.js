"use strict";
/**
 * CMSIS SVD 解析器（纯函数，零依赖）。
 *
 * SVD 是机器生成的规整 XML；这里用一个轻量标签扫描器构建节点树，
 * 再映射为强类型模型。支持：外设（含 derivedFrom 派生）、寄存器、
 * 位域、枚举值（读/写语义标签）。未实现：<dimension> 数组寄存器展开
 * （ST F1 系列 SVD 基本不使用，遇到的寄存器直接按显式定义处理）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSvd = parseSvd;
exports.svdParseError = svdParseError;
function parseXml(text) {
    const root = { name: '#root', attrs: {}, children: [], text: '' };
    const stack = [root];
    let i = 0;
    const n = text.length;
    while (i < n) {
        const lt = text.indexOf('<', i);
        if (lt < 0) {
            break;
        }
        // 标签前的文本挂到当前节点
        if (lt > i) {
            const chunk = text.slice(i, lt);
            if (chunk.trim()) {
                stack[stack.length - 1].text += chunk.trim();
            }
        }
        if (text.startsWith('<!--', lt)) {
            i = text.indexOf('-->', lt) + 3;
            continue;
        }
        if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
            const close = text.indexOf('>', lt);
            i = close + 1;
            continue;
        }
        if (text.startsWith('</', lt)) {
            const close = text.indexOf('>', lt);
            const name = text.slice(lt + 2, close).trim();
            // 回退到匹配的开启标签（容错：名字不匹配时只弹一层）
            for (let s = stack.length - 1; s > 0; s--) {
                if (stack[s].name === name) {
                    stack.length = s;
                    break;
                }
            }
            i = close + 1;
            continue;
        }
        // 开标签（可能自闭合）
        const close = findTagEnd(text, lt);
        const body = text.slice(lt + 1, close);
        const selfClose = body.endsWith('/');
        const inner = selfClose ? body.slice(0, -1) : body;
        const m = /^([^\s/>]+)/.exec(inner);
        const node = {
            name: m ? m[1] : '',
            attrs: parseAttrs(inner),
            children: [],
            text: '',
        };
        stack[stack.length - 1].children.push(node);
        if (!selfClose) {
            stack.push(node);
        }
        i = close + 1;
    }
    return root;
}
/** 标签结束位置（跳过属性值中的引号内 '>'） */
function findTagEnd(text, from) {
    let q = null;
    for (let i = from; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === q) {
                q = null;
            }
        }
        else if (c === '"' || c === "'") {
            q = c;
        }
        else if (c === '>') {
            return i;
        }
    }
    return text.length - 1;
}
function parseAttrs(inner) {
    const out = {};
    const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(inner)) !== null) {
        out[m[1]] = m[2];
    }
    return out;
}
// ---------------- SVD 模型映射 ----------------
function childrenOf(node, name) {
    return node ? node.children.filter((c) => c.name === name) : [];
}
function childText(node, name) {
    const c = node?.children.find((x) => x.name === name);
    const t = c?.text.trim();
    return t ? t : undefined;
}
function parseHex(v) {
    if (!v) {
        return 0;
    }
    const n = parseInt(v.trim().replace(/^0[xX]/, ''), 16);
    return Number.isFinite(n) ? n : 0;
}
function parseIntDec(v) {
    if (!v) {
        return 0;
    }
    const t = v.trim().toLowerCase();
    if (t.startsWith('0x')) {
        return parseInt(t.slice(2), 16);
    }
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : 0;
}
function parseAccess(v) {
    if (v === 'read-only') {
        return 'read-only';
    }
    if (v === 'write-only') {
        return 'write-only';
    }
    return 'read-write';
}
function parseFields(regNode) {
    const fieldsNode = regNode.children.find((c) => c.name === 'fields');
    const out = [];
    for (const f of childrenOf(fieldsNode, 'field')) {
        let bitOffset = parseIntDec(childText(f, 'bitOffset'));
        let bitWidth = parseIntDec(childText(f, 'bitWidth'));
        const lsb = parseIntDec(childText(f, 'lsb'));
        const msb = parseIntDec(childText(f, 'msb'));
        const bitRange = childText(f, 'bitRange');
        if (childText(f, 'bitOffset') === undefined && bitRange) {
            const bm = /\[(\d+):(\d+)\]/.exec(bitRange);
            if (bm) {
                bitOffset = parseInt(bm[2], 10);
                bitWidth = parseInt(bm[1], 10) - bitOffset + 1;
            }
        }
        else if (childText(f, 'bitOffset') === undefined && (childText(f, 'msb') !== undefined)) {
            bitOffset = lsb;
            bitWidth = msb - lsb + 1;
        }
        const enumerated = [];
        for (const evs of childrenOf(f, 'enumeratedValues')) {
            for (const ev of childrenOf(evs, 'enumeratedValue')) {
                const val = parseIntDec(childText(ev, 'value'));
                const label = childText(ev, 'name');
                if (label) {
                    enumerated.push({
                        value: val,
                        label: label.replace(/_/g, ' '),
                        description: childText(ev, 'description'),
                    });
                }
            }
        }
        out.push({
            name: childText(f, 'name') ?? '',
            description: childText(f, 'description'),
            bitOffset,
            bitWidth,
            access: childText(f, 'access') ?? undefined,
            enumerated: enumerated.length > 0 ? enumerated : undefined,
        });
    }
    return out.sort((a, b) => b.bitOffset - a.bitOffset);
}
function parseRegisters(periphNode, baseAddress, defaultSize, defaultAccess) {
    const regsNode = periphNode.children.find((c) => c.name === 'registers');
    const out = [];
    for (const r of childrenOf(regsNode, 'register')) {
        const size = parseIntDec(childText(r, 'size')) || defaultSize;
        const access = parseAccess(childText(r, 'access') ?? undefined) === 'read-write'
            ? defaultAccess
            : parseAccess(childText(r, 'access'));
        out.push({
            name: childText(r, 'name') ?? '',
            description: childText(r, 'description'),
            address: baseAddress + parseIntHexOrDec(childText(r, 'addressOffset')),
            size,
            access,
            fields: parseFields(r),
        });
    }
    return out;
}
function parseIntHexOrDec(v) {
    if (!v) {
        return 0;
    }
    const t = v.trim();
    if (/^0[xX]/.test(t)) {
        return parseInt(t.slice(2), 16);
    }
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : 0;
}
/** 解析 SVD 文本 → 设备模型（含 derivedFrom 派生外设展开） */
function parseSvd(text) {
    const root = parseXml(text);
    const device = root.children.find((c) => c.name === 'device') ?? root;
    const deviceName = childText(device, 'name') ?? 'SVD';
    const defaultSize = parseIntDec(childText(device, 'size')) || 32;
    const defaultAccess = parseAccess(childText(device, 'access'));
    const peripheralsNode = device.children.find((c) => c.name === 'peripherals');
    const raw = childrenOf(peripheralsNode, 'peripheral');
    const byName = new Map();
    for (const p of raw) {
        const nm = childText(p, 'name');
        if (nm) {
            byName.set(nm, p);
        }
    }
    const resolved = [];
    const resolvedByName = new Map();
    const resolvePeriph = (node, depth = 0) => {
        const name = childText(node, 'name') ?? '';
        if (!name || depth > 4) {
            return undefined;
        }
        // 已解析过（含被其它外设 derivedFrom 引用过的）直接返回现成结果
        const existing = resolvedByName.get(name);
        if (existing) {
            return existing;
        }
        const base = parseHex(childText(node, 'baseAddress'));
        const derivedFrom = node.attrs['derivedFrom'];
        if (derivedFrom) {
            const src = byName.get(derivedFrom);
            const srcP = src ? resolvePeriph(src, depth + 1) : undefined;
            if (!srcP) {
                return undefined;
            }
            const p = {
                name,
                title: childText(node, 'displayName') ?? undefined,
                description: childText(node, 'description') ?? srcP.description,
                baseAddress: base,
                registers: srcP.registers.map((r) => ({
                    ...r,
                    address: base + (r.address - srcP.baseAddress),
                })),
            };
            resolved.push(p);
            resolvedByName.set(name, p);
            return p;
        }
        const p = {
            name,
            title: childText(node, 'displayName') ?? undefined,
            description: childText(node, 'description'),
            baseAddress: base,
            registers: parseRegisters(node, base, defaultSize, defaultAccess),
        };
        resolved.push(p);
        resolvedByName.set(name, p);
        return p;
    };
    for (const p of raw) {
        resolvePeriph(p);
    }
    return {
        deviceName,
        peripherals: resolved.sort((a, b) => a.name.localeCompare(b.name)),
    };
}
/** 解析错误（供上层展示） */
function svdParseError(e) {
    return e instanceof Error ? e.message : String(e);
}
//# sourceMappingURL=svdParser.js.map