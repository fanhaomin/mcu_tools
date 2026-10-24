const s = require('fs').readFileSync('src/extension.ts', 'utf8');
let d = 0, line = 1, inStr = null, inCmt = false;
for (let i = 0; i < s.length; i++) {
  const ch = s[i], nx = s[i + 1];
  if (ch === '\n') { line++; continue; }
  if (inCmt) { if (ch === '*' && nx === '/') { inCmt = false; i++; } continue; }
  if (inStr) { if (ch === inStr && s[i - 1] !== '\\') inStr = null; continue; }
  if (ch === '/' && nx === '*') { inCmt = true; i++; continue; }
  if (ch === '/' && nx === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
  if (ch === '`' || ch === '"' || ch === "'") { inStr = ch; continue; }
  if (ch === '{') d++;
  else if (ch === '}') { d--; if (d === 0) console.log('top-level close at line', line); if (d < 0) { console.log('NEG at line', line); break; } }
}
console.log('final depth:', d);
