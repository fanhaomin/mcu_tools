/**
 * SVD 文件自动探测（纯函数 + 注入环境）。
 *
 * 搜索顺序：
 * 1. 用户设置 autoCmakeFlash.svdFile（精确文件）；
 * 2. STM32CubeIDE 安装的 CMSIS/SVD 资源目录（plugins/com.st.stm32cube.ide.mcu.productdb.debug_*）；
 * 3. Keil MDK 的 DFP 包（C:\Keil_v5\ARM\PACK\Keil\STM32Fxx_DFP\*\SVD）；
 * 4. C:\ST 下的散置 SVD。
 *
 * 文件名匹配：优先精确基础型号（STM32F103.svd），退回家族名（STM32F1xx.svd）。
 */

import * as path from 'path';
import { walk } from '../util/path';

export interface SvdFinderEnv {
  exists(p: string): Promise<boolean>;
  listDirs(dir: string): Promise<string[]>;
}

/** STM32F103 → STM32F1xx（去掉末两位数字，补 xx） */
export function familyFileName(mcuBase: string): string | undefined {
  const m = /^STM32([FGHLUW])(\d)(\d{2}).*/i.exec(mcuBase.trim());
  if (!m) {
    return undefined;
  }
  return `STM32${m[1]}${m[2]}xx.svd`.toUpperCase();
}

function baseFileName(mcuBase: string): string {
  return `${mcuBase.trim().toUpperCase()}.svd`;
}

/** 在一个目录里（有限深度）找匹配候选名的 SVD，按候选顺序（精确型号优先）返回 */
async function findInDir(
  env: SvdFinderEnv,
  dir: string,
  candidates: string[],
  depth = 3,
): Promise<string | undefined> {
  const found: string[] = [];
  await walk(
    dir,
    async (p) => {
      const bn = path.basename(p).toLowerCase();
      if (candidates.some((c) => c.toLowerCase() === bn)) {
        found.push(p);
      }
    },
    { depth, skipDirs: [/^\./i, /^plugins$/i] },
  );
  for (const cand of candidates) {
    const candLower = cand.toLowerCase();
    const hit = found.find((p) => path.basename(p).toLowerCase() === candLower);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

export async function findSvd(
  env: SvdFinderEnv,
  setting: string | undefined,
  mcuBase: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const candidates: string[] = [];
  const base = baseFileName(mcuBase);
  const fam = familyFileName(mcuBase);
  // 候选顺序即优先级：精确基础型号在前，家族名回退在后
  candidates.push(base);
  if (fam) {
    candidates.push(fam);
  }

  // 1. 用户设置
  const s = setting?.trim();
  if (s) {
    if (/\.svd$/i.test(s)) {
      if (await env.exists(s)) {
        return s;
      }
    } else {
      // 设置给的是目录：在目录里找候选
      const hit = await findInDir(env, s, candidates, 2);
      if (hit) {
        return hit;
      }
    }
  }

  if (platform !== 'win32') {
    return undefined;
  }

  // 2. STM32CubeIDE 的 productdb.debug 资源目录（含全系列 SVD）
  // 两种安装布局：<root>\plugins 与 <root>\STM32CubeIDE\plugins（官方安装器为后者）
  const ideParents = ['C:\\ST', 'C:\\Program Files\\STMicroelectronics\\STM32Cube'];
  for (const parent of ideParents) {
    for (const name of await env.listDirs(parent)) {
      if (!/^STM32CubeIDE/i.test(name)) {
        continue;
      }
      const root = path.join(parent, name);
      const pluginBases = [path.join(root, 'STM32CubeIDE', 'plugins'), path.join(root, 'plugins')];
      for (const plugins of pluginBases) {
        for (const plug of await env.listDirs(plugins)) {
          if (!/^com\.st\.stm32cube\.ide\.mcu\.productdb\.debug/i.test(plug)) {
            continue;
          }
          const res = path.join(plugins, plug, 'resources');
          const hit = await findInDir(env, res, candidates, 3);
          if (hit) {
            return hit;
          }
        }
      }
    }
  }

  // 3. Keil MDK DFP 包
  for (const keilRoot of ['C:\\Keil_v5\\ARM\\PACK\\Keil', 'C:\\Keil\\ARM\\PACK\\Keil']) {
    for (const dfp of await env.listDirs(keilRoot)) {
      if (!/_DFP$/i.test(dfp)) {
        continue;
      }
      const dfpDir = path.join(keilRoot, dfp);
      for (const ver of await env.listDirs(dfpDir)) {
        const hit = await findInDir(env, path.join(dfpDir, ver, 'SVD'), candidates, 1);
        if (hit) {
          return hit;
        }
      }
    }
  }

  // 4. C:\ST 散置
  for (const name of await env.listDirs('C:\\ST')) {
    if (/\.svd$/i.test(name)) {
      const p = path.join('C:\\ST', name);
      if (candidates.includes(name.toUpperCase())) {
        return p;
      }
    }
  }

  return undefined;
}
