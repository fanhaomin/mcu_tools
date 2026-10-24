/**
 * probe-rs DAP 层实测：驱动 probe-rs dap-server，模拟 VS Code 客户端，
 * 验证 运行中 readMemory / 暂停后 readMemory 的真实行为。
 * 用 attach（不烧写），目标运行用户已烧的固件。
 */
const { spawn } = require('child_process');
const path = require('path');

const exe = path.join(process.env.LOCALAPPDATA, 'Programs', 'probe-rs', 'probe-rs.exe');
const p = spawn(exe, ['dap-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = Buffer.alloc(0);
const pending = new Map();
const events = [];
let seq = 1;

function send(obj) {
  obj.seq = seq++;
  const json = JSON.stringify(obj);
  p.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  return obj.seq;
}
function request(command, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const rq = send({ type: 'request', command, arguments: args });
    const t = setTimeout(() => {
      pending.delete(rq);
      reject(new Error(`timeout: ${command}`));
    }, timeoutMs);
    pending.set(rq, { resolve, reject, t });
  });
}
function waitEvent(name, timeoutMs = 30000) {
  const hit = events.find((e) => e.event === name);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`event timeout: ${name}`)), timeoutMs);
    const iv = setInterval(() => {
      const hit = events.find((e) => e.event === name);
      if (hit) { clearTimeout(t); clearInterval(iv); resolve(hit); }
    }, 100);
    events; // noop
    setTimeout(() => clearInterval(iv), timeoutMs + 1000);
  });
}

p.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const idx = buf.indexOf('\r\n\r\n');
    if (idx < 0) break;
    const header = buf.slice(0, idx).toString();
    const m = /Content-Length: (\d+)/.exec(header);
    if (!m) break;
    const len = +m[1];
    const start = idx + 4;
    if (buf.length < start + len) break;
    let body;
    try { body = JSON.parse(buf.slice(start, start + len).toString()); } catch { break; }
    buf = buf.slice(start + len);
    if (body.type === 'response') {
      const pr = pending.get(body.request_seq);
      if (pr) {
        pending.delete(body.request_seq);
        clearTimeout(pr.t);
        if (body.success) pr.resolve(body.result ?? body);
        else pr.reject(new Error(`${body.command} failed: ${body.message ?? JSON.stringify(body.body ?? {})}`));
      }
    } else if (body.type === 'event') {
      events.push(body);
      if (body.event === 'output' && body.body?.output) {
        const o = body.body.output.trim();
        if (o) console.log('  [adapter]', o.slice(0, 200));
      }
    }
  }
});
p.stderr.on('data', (d) => console.log('  [stderr]', d.toString().trim().slice(0, 200)));

(async () => {
  console.log('== initialize ==');
  const init = await request('initialize', {
    adapterID: 'acf-test',
    clientID: 'acf-test',
    clientName: 'acf-test',
    locale: 'en',
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: 'path',
    supportsVariableType: false,
    supportsVariablePaging: false,
    supportsRunInTerminalRequest: false,
  });
  console.log('capabilities: supportsReadMemory =', init.supportsReadMemory,
    '| supportsTerminateRequest =', init.supportsTerminateRequest);

  const cfg = {
    type: 'probe-rs-debug',
    request: 'attach',
    cwd: 'd:\\cs\\cs',
    chip: 'STM32F103C8',
    speed: 1800,
    wireProtocol: 'Swd',
    coreConfigs: [{ coreIndex: 0, programBinary: 'd:\\cs\\cs\\build-auto\\cs.elf' }],
  };
  console.log('== attach (不烧写) ==');
  const launchPromise = request('attach', cfg, 60000);
  await waitEvent('initialized', 60000).catch((e) => console.log('(no initialized event:', e.message + ')'));
  await request('configurationDone', {}, 15000).catch((e) => console.log('configurationDone:', e.message));
  await launchPromise;
  console.log('ATTACHED');

  const th = await request('threads', {});
  console.log('threads:', JSON.stringify(th.threads ?? th));
  const tid = th.threads && th.threads[0] ? th.threads[0].id : undefined;

  console.log('== readMemory WHILE RUNNING ==');
  try {
    const r = await request('readMemory', { memoryReference: '0x40012400', count: 16 }, 10000);
    console.log('RUNNING READ OK:', JSON.stringify(r).slice(0, 160));
  } catch (e) {
    console.log('RUNNING READ FAILED:', e.message);
  }

  console.log('== pause (微停机) ==');
  try {
    await request('pause', tid !== undefined ? { threadId: tid } : {}, 10000);
    console.log('pause OK');
  } catch (e) {
    console.log('pause FAILED:', e.message);
  }
  await new Promise((r) => setTimeout(r, 800));
  const stopped = events.find((e) => e.event === 'stopped');
  console.log('stopped event received:', !!stopped);

  console.log('== readMemory HALTED ==');
  try {
    const r = await request('readMemory', { memoryReference: '0x40012400', count: 16 }, 10000);
    console.log('HALTED READ OK:', JSON.stringify(r).slice(0, 160));
  } catch (e) {
    console.log('HALTED READ FAILED:', e.message);
  }

  console.log('== continue ==');
  try {
    await request('continue', tid !== undefined ? { threadId: tid } : {}, 10000);
    console.log('continue OK');
  } catch (e) {
    console.log('continue FAILED:', e.message);
  }

  await request('disconnect', { terminateDebuggee: false }, 10000).catch((e) =>
    console.log('disconnect:', e.message));
  console.log('DONE');
  p.kill();
  process.exit(0);
})().catch((e) => {
  console.log('FATAL:', e.message);
  p.kill();
  process.exit(1);
});
