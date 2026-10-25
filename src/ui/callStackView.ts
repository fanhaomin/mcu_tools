/**
 * 「调用栈」视图：目标停机（断点/手动暂停）时自动读取并展示完整调用栈
 * （帧号/函数/文件:行/PC）。运行中不读取——读核心寄存器必须停机，
 * 主动微停机抓取已按需移除，保持对目标零干扰。
 */

import * as vscode from 'vscode';

export interface StackFrameInfo {
  idx: number;
  name: string;
  file?: string;
  line?: number;
  pc?: string;
}

interface CallStackDeps {
  getSession(): vscode.DebugSession | undefined;
  log(msg: string): void;
}

interface StackTraceResp {
  stackFrames?: {
    name?: string;
    source?: { path?: string };
    line?: number;
    instructionPointerReference?: string;
  }[];
  /** 适配器认为的完整栈帧数；小于返回数 = 回溯未完成，应重读 */
  totalFrames?: number;
}

export class CallStackViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autoCmakeFlash.callstack';
  private view?: vscode.WebviewView;
  private lastSessionOn?: boolean;
  /** 目标停机中（最近一次 stopped 且未 continued）——切回标签页时需重读栈 */
  private halted = false;

  constructor(private readonly deps: CallStackDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        // 切回时若在停机态：重读一次（隐藏期间可能已单步走动），
        // 而不是清空——此前 push() 无参会发空帧列表把已有内容抹掉
        if (this.halted) {
          void this.readStopped();
        } else {
          this.push();
        }
      }
    });
    this.push();
  }

  /** stopped/continued 事件转发（extension 的 tracker 调用） */
  onDebugEvent(event: 'stopped' | 'continued'): void {
    if (event === 'stopped') {
      this.halted = true;
      // 适配器停机后 stackTrace 立即可用；稍等一拍再读，失败小重试
      void this.readStopped();
    } else {
      this.halted = false;
      this.push();
    }
  }

  /** 会话结束时清空 */
  onSessionEnded(): void {
    this.halted = false;
    this.push();
  }

  private async readStopped(tries = 0): Promise<void> {
    const s = this.deps.getSession();
    if (!s) {
      this.push();
      return;
    }
    const frames = await this.readStackTrace(s);
    // 请求失败或返回帧数 < totalFrames（适配器还没回溯完）都重读
    if (frames && frames.list.length < frames.total && tries < 2) {
      await new Promise((r) => setTimeout(r, 150));
      return this.readStopped(tries + 1);
    }
    this.push(frames?.list);
  }

  private async readStackTrace(
    s: vscode.DebugSession,
  ): Promise<{ list: StackFrameInfo[]; total: number } | undefined> {
    try {
      const th = (await s.customRequest('threads')) as { threads?: { id: number }[] };
      const tid = th?.threads?.[0]?.id;
      if (tid === undefined) {
        return undefined;
      }
      const st = (await s.customRequest('stackTrace', {
        threadId: tid,
        levels: 32,
      })) as StackTraceResp;
      const raw = st?.stackFrames ?? [];
      const total = st?.totalFrames ?? raw.length;
      if (raw.length < total) {
        this.deps.log(`调用栈: 适配器回溯未完成（返回 ${raw.length}/${total} 帧），稍后重读`);
      }
      return {
        total,
        list: raw.map((f, i) => ({
          idx: i,
          name: (f.name ?? '(未知)').split(' (')[0].trim(),
          file: f.source?.path,
          line: f.line,
          pc: f.instructionPointerReference?.toUpperCase(),
        })),
      };
    } catch {
      return undefined;
    }
  }

  private push(frames?: StackFrameInfo[]): void {
    if (!this.view) {
      return;
    }
    const s = this.deps.getSession();
    const on = !!s;
    if (on !== this.lastSessionOn) {
      this.lastSessionOn = on;
    }
    void this.view.webview.postMessage({
      cmd: 'data',
      on,
      frames: frames ?? [],
    });
  }

  private html(): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: var(--vscode-font-family); font-size: 12px;
             color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
             margin: 0; padding: 8px 10px 16px; }
      :root { --ac: #58b6f8; --ok: #4ec994; --dim: rgba(128,128,128,.3); }
      .bar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
      #st { font-size: 11px; color: var(--vscode-descriptionForeground);
        display: flex; align-items: center; gap: 5px; }
      #st .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
      table { width: 100%; table-layout: fixed; border-collapse: collapse; }
      th { position: sticky; top: 0; font-size: 10px; font-weight: 600; text-transform: uppercase;
        letter-spacing: .07em; text-align: left; color: var(--vscode-descriptionForeground);
        background: var(--vscode-sideBar-background); padding: 5px 8px;
        border-bottom: 1px solid var(--dim); }
      th.num, td.num { text-align: right; }
      td { padding: 4px 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
        border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 9%, transparent); }
      tr:last-child td { border-bottom: none; }
      tbody tr:hover td { background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent); }
      .fn { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600;
        color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); }
      .loc { font-size: 11px; color: var(--vscode-descriptionForeground); }
      .pc { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px;
        color: var(--vscode-descriptionForeground); }
      tr.top td { background: color-mix(in srgb, var(--ac) 8%, transparent); }
      .empty { padding: 18px 6px; color: var(--vscode-descriptionForeground);
        text-align: center; line-height: 1.8; }
      .nosess { position: fixed; inset: 0; z-index: 5; display: none;
        align-items: center; justify-content: center; text-align: center;
        background: color-mix(in srgb, var(--vscode-sideBar-background) 86%, transparent);
        color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.9; }
      .nosess.show { display: flex; }
    </style></head><body>
      <div class="bar">
        <span id="st"><span class="dot"></span><span id="stt">运行中</span></span>
      </div>
      <table><thead><tr>
        <th class="num" style="width:8%">#</th>
        <th style="width:44%">函数</th>
        <th style="width:30%">位置</th>
        <th class="num" style="width:18%">PC</th>
      </tr></thead><tbody id="tb"></tbody></table>
      <div class="empty" id="empty">断点停机 / 手动暂停时自动显示调用栈<br>运行中对目标零干扰（不读取）</div>
      <div class="nosess" id="nosess">未在调试中<br>启动调试后这里显示调用栈</div>
      <script>
        const $ = (id) => document.getElementById(id);
        const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        let frames = [];
        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.cmd !== 'data') { return; }
          $('nosess').classList.toggle('show', !m.on);
          frames = m.frames || [];
          $('stt').textContent = frames.length ? '停机中' : '运行中';
          render();
        });
        function render() {
          const tb = $('tb');
          if (!frames.length) { tb.innerHTML = ''; $('empty').style.display = ''; return; }
          $('empty').style.display = 'none';
          let h = '';
          for (const f of frames) {
            const loc = f.file ? (f.file.split(/[\\\\/]/).pop() + (f.line ? ':' + f.line : '')) : '—';
            h += '<tr' + (f.idx === 0 ? ' class="top"' : '') + ' title="' + esc((f.file || '') + (f.line ? ':' + f.line : '')) + '">' +
              '<td class="num">' + f.idx + '</td>' +
              '<td class="fn">' + esc(f.name) + '</td>' +
              '<td class="loc">' + esc(loc) + '</td>' +
              '<td class="num pc">' + esc(f.pc || '—') + '</td></tr>';
          }
          tb.innerHTML = h;
        }
      </script>
    </body></html>`;
  }
}
