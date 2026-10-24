"use strict";
/**
 * SVD 解析与探测测试：迷你 SVD 覆盖 外设/寄存器/位域（bitRange 与
 * bitOffset 两种写法）/枚举值/derivedFrom 派生；探测器覆盖设置直配/目录匹配/家族名回退。
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
const svdParser_1 = require("../src/svd/svdParser");
const svdFinder_1 = require("../src/svd/svdFinder");
const fixtures_1 = require("./helpers/fixtures");
const MINI_SVD = `<?xml version="1.0" encoding="utf-8"?>
<device>
  <name>STM32F103xx</name>
  <size>32</size>
  <access>read-write</access>
  <peripherals>
    <peripheral>
      <name>USART1</name>
      <description>Universal synchronous asynchronous receiver transmitter</description>
      <baseAddress>0x40013800</baseAddress>
      <registers>
        <register>
          <name>SR</name>
          <description>Status register</description>
          <addressOffset>0x0</addressOffset>
          <size>32</size>
          <access>read-only</access>
          <fields>
            <field>
              <name>TXE</name>
              <description>Transmit data register empty</description>
              <bitRange>[7:7]</bitRange>
              <enumeratedValues>
                <enumeratedValue><name>NOT_EMPTY</name><value>0</value></enumeratedValue>
                <enumeratedValue><name>EMPTY</name><value>1</value></enumeratedValue>
              </enumeratedValues>
            </field>
            <field>
              <name>RXNE</name>
              <bitOffset>5</bitOffset>
              <bitWidth>1</bitWidth>
            </field>
          </fields>
        </register>
        <register>
          <name>DR</name>
          <addressOffset>0x4</addressOffset>
          <fields>
            <field><name>DR</name><bitOffset>0</bitOffset><bitWidth>9</bitWidth></field>
          </fields>
        </register>
      </registers>
    </peripheral>
    <peripheral derivedFrom="USART1">
      <name>USART2</name>
      <baseAddress>0x40004400</baseAddress>
    </peripheral>
  </peripherals>
</device>`;
(0, node_test_1.test)('SVD 解析：设备/外设/寄存器地址与访问属性', () => {
    const d = (0, svdParser_1.parseSvd)(MINI_SVD);
    strict_1.default.equal(d.deviceName, 'STM32F103xx');
    const names = d.peripherals.map((p) => p.name);
    strict_1.default.ok(names.includes('USART1') && names.includes('USART2'));
    const u1 = d.peripherals.find((p) => p.name === 'USART1');
    strict_1.default.equal(u1.baseAddress, 0x40013800);
    const sr = u1.registers.find((r) => r.name === 'SR');
    strict_1.default.equal(sr.address, 0x40013800);
    strict_1.default.equal(sr.access, 'read-only');
    const dr = u1.registers.find((r) => r.name === 'DR');
    strict_1.default.equal(dr.address, 0x40013800 + 0x4);
    strict_1.default.equal(dr.access, 'read-write', '未声明 access 时继承设备默认 read-write');
});
(0, node_test_1.test)('SVD 解析：位域（bitRange 与 bitOffset 两种写法）与枚举值', () => {
    const d = (0, svdParser_1.parseSvd)(MINI_SVD);
    const sr = d.peripherals.find((p) => p.name === 'USART1').registers.find((r) => r.name === 'SR');
    const txe = sr.fields.find((f) => f.name === 'TXE');
    strict_1.default.equal(txe.bitOffset, 7);
    strict_1.default.equal(txe.bitWidth, 1);
    strict_1.default.deepEqual(txe.enumerated.map((e) => e.label), ['NOT EMPTY', 'EMPTY']);
    const rxne = sr.fields.find((f) => f.name === 'RXNE');
    strict_1.default.equal(rxne.bitOffset, 5);
    strict_1.default.equal(rxne.bitWidth, 1);
});
(0, node_test_1.test)('SVD 解析：derivedFrom 派生外设展开（寄存器平移到新基址）', () => {
    const d = (0, svdParser_1.parseSvd)(MINI_SVD);
    const u2 = d.peripherals.find((p) => p.name === 'USART2');
    strict_1.default.equal(u2.baseAddress, 0x40004400);
    const sr = u2.registers.find((r) => r.name === 'SR');
    strict_1.default.equal(sr.address, 0x40004400, '派生外设的 SR 应在新基址');
    strict_1.default.equal(u2.registers.length, d.peripherals.find((p) => p.name === 'USART1').registers.length);
});
(0, node_test_1.test)('家族文件名推导：STM32F103 → STM32F1XX.SVD', () => {
    strict_1.default.equal((0, svdFinder_1.familyFileName)('STM32F103'), 'STM32F1XX.SVD');
    strict_1.default.equal((0, svdFinder_1.familyFileName)('STM32G431'), 'STM32G4XX.SVD');
    strict_1.default.equal((0, svdFinder_1.familyFileName)('STM32H743'), 'STM32H7XX.SVD');
    strict_1.default.equal((0, svdFinder_1.familyFileName)('Nonsense'), undefined);
});
(0, node_test_1.test)('SVD 探测：设置直配文件优先', async () => {
    const env = {
        async exists(p) {
            return p === 'D:\\svd\\my.svd';
        },
        async listDirs() {
            return [];
        },
    };
    strict_1.default.equal(await (0, svdFinder_1.findSvd)(env, 'D:\\svd\\my.svd', 'STM32F103'), 'D:\\svd\\my.svd');
});
(0, node_test_1.test)('SVD 探测：设置为目录时在其中匹配（精确型号优先于家族名）', async () => {
    const tmp = (0, fixtures_1.makeTempDir)('acf-svd-');
    try {
        fs.writeFileSync(path.join(tmp, 'STM32F1xx.svd'), '<device/>');
        fs.writeFileSync(path.join(tmp, 'STM32F103.svd'), '<device/>');
        const env = {
            async exists() {
                return false;
            },
            async listDirs() {
                return [];
            },
        };
        const hit = await (0, svdFinder_1.findSvd)(env, tmp, 'STM32F103', 'win32');
        strict_1.default.ok(hit && /STM32F103\.svd$/i.test(hit), '应命中精确型号');
    }
    finally {
        (0, fixtures_1.cleanup)(tmp);
    }
});
(0, node_test_1.test)('SVD 探测：目录中只有家族名文件时回退家族名', async () => {
    const tmp = (0, fixtures_1.makeTempDir)('acf-svd-');
    try {
        fs.writeFileSync(path.join(tmp, 'STM32F1xx.svd'), '<device/>');
        const env = {
            async exists() {
                return false;
            },
            async listDirs() {
                return [];
            },
        };
        const hit = await (0, svdFinder_1.findSvd)(env, tmp, 'STM32F103', 'win32');
        strict_1.default.ok(hit && /STM32F1xx\.svd$/i.test(hit));
    }
    finally {
        (0, fixtures_1.cleanup)(tmp);
    }
});
//# sourceMappingURL=svd.test.js.map