/**
 * SVD 解析与探测测试：迷你 SVD 覆盖 外设/寄存器/位域（bitRange 与
 * bitOffset 两种写法）/枚举值/derivedFrom 派生；探测器覆盖设置直配/目录匹配/家族名回退。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { parseSvd } from '../src/svd/svdParser';
import { SvdFinderEnv, familyFileName, findSvd } from '../src/svd/svdFinder';
import { makeTempDir, cleanup } from './helpers/fixtures';

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

test('SVD 解析：设备/外设/寄存器地址与访问属性', () => {
  const d = parseSvd(MINI_SVD);
  assert.equal(d.deviceName, 'STM32F103xx');
  const names = d.peripherals.map((p) => p.name);
  assert.ok(names.includes('USART1') && names.includes('USART2'));
  const u1 = d.peripherals.find((p) => p.name === 'USART1')!;
  assert.equal(u1.baseAddress, 0x40013800);
  const sr = u1.registers.find((r) => r.name === 'SR')!;
  assert.equal(sr.address, 0x40013800);
  assert.equal(sr.access, 'read-only');
  const dr = u1.registers.find((r) => r.name === 'DR')!;
  assert.equal(dr.address, 0x40013800 + 0x4);
  assert.equal(dr.access, 'read-write', '未声明 access 时继承设备默认 read-write');
});

test('SVD 解析：位域（bitRange 与 bitOffset 两种写法）与枚举值', () => {
  const d = parseSvd(MINI_SVD);
  const sr = d.peripherals.find((p) => p.name === 'USART1')!.registers.find((r) => r.name === 'SR')!;
  const txe = sr.fields.find((f) => f.name === 'TXE')!;
  assert.equal(txe.bitOffset, 7);
  assert.equal(txe.bitWidth, 1);
  assert.deepEqual(
    txe.enumerated!.map((e) => e.label),
    ['NOT EMPTY', 'EMPTY'],
  );
  const rxne = sr.fields.find((f) => f.name === 'RXNE')!;
  assert.equal(rxne.bitOffset, 5);
  assert.equal(rxne.bitWidth, 1);
});

test('SVD 解析：derivedFrom 派生外设展开（寄存器平移到新基址）', () => {
  const d = parseSvd(MINI_SVD);
  const u2 = d.peripherals.find((p) => p.name === 'USART2')!;
  assert.equal(u2.baseAddress, 0x40004400);
  const sr = u2.registers.find((r) => r.name === 'SR')!;
  assert.equal(sr.address, 0x40004400, '派生外设的 SR 应在新基址');
  assert.equal(u2.registers.length, d.peripherals.find((p) => p.name === 'USART1')!.registers.length);
});

test('家族文件名推导：STM32F103 → STM32F1XX.SVD', () => {
  assert.equal(familyFileName('STM32F103'), 'STM32F1XX.SVD');
  assert.equal(familyFileName('STM32G431'), 'STM32G4XX.SVD');
  assert.equal(familyFileName('STM32H743'), 'STM32H7XX.SVD');
  assert.equal(familyFileName('Nonsense'), undefined);
});

test('SVD 探测：设置直配文件优先', async () => {
  const env: SvdFinderEnv = {
    async exists(p) {
      return p === 'D:\\svd\\my.svd';
    },
    async listDirs() {
      return [];
    },
  };
  assert.equal(await findSvd(env, 'D:\\svd\\my.svd', 'STM32F103'), 'D:\\svd\\my.svd');
});

test('SVD 探测：设置为目录时在其中匹配（精确型号优先于家族名）', async () => {
  const tmp = makeTempDir('acf-svd-');
  try {
    fs.writeFileSync(path.join(tmp, 'STM32F1xx.svd'), '<device/>');
    fs.writeFileSync(path.join(tmp, 'STM32F103.svd'), '<device/>');
    const env: SvdFinderEnv = {
      async exists() {
        return false;
      },
      async listDirs() {
        return [];
      },
    };
    const hit = await findSvd(env, tmp, 'STM32F103', 'win32');
    assert.ok(hit && /STM32F103\.svd$/i.test(hit), '应命中精确型号');
  } finally {
    cleanup(tmp);
  }
});

test('SVD 探测：目录中只有家族名文件时回退家族名', async () => {
  const tmp = makeTempDir('acf-svd-');
  try {
    fs.writeFileSync(path.join(tmp, 'STM32F1xx.svd'), '<device/>');
    const env: SvdFinderEnv = {
      async exists() {
        return false;
      },
      async listDirs() {
        return [];
      },
    };
    const hit = await findSvd(env, tmp, 'STM32F103', 'win32');
    assert.ok(hit && /STM32F1xx\.svd$/i.test(hit));
  } finally {
    cleanup(tmp);
  }
});
