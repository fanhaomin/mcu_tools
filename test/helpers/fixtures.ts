/**
 * 测试辅助：临时目录夹具创建与清理。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function makeTempDir(prefix = 'acf-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function write(root: string, rel: string, content = ''): string {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

export function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略清理失败 */
  }
}

/** 设置文件 mtime */
export function utime(file: string, ms: number): void {
  fs.utimesSync(file, new Date(ms / 1000), new Date(ms / 1000));
}
