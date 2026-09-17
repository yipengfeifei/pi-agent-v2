// Capture a deterministic frame sequence from krea-agent-hero.html via CDP.
//   node capture.mjs <outDir> <startSec> <endSec> <fps> [width] [height]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const [outDir, t0, t1, fpsArg, W = '1440', H = '900'] = process.argv.slice(2);
// CURSOR='[[sec,x,y],…]' — hover waypoints, linearly interpolated (x<0 ⇒ off-screen)
const WAY = process.env.CURSOR ? JSON.parse(process.env.CURSOR) : null;
// VIEW='[[sec,yaw,pitch],…]' — 拖动环视的航点，线性插值
const VIEWW = process.env.VIEW ? JSON.parse(process.env.VIEW) : null;
const viewAt = t => {
  if (!VIEWW) return null;
  if (t <= VIEWW[0][0]) return VIEWW[0].slice(1);
  for (let i = 1; i < VIEWW.length; i++) {
    if (t <= VIEWW[i][0]) {
      const [ta, ya, pa] = VIEWW[i - 1], [tb, yb, pb] = VIEWW[i];
      const k = (t - ta) / (tb - ta);
      return [ya + (yb - ya) * k, pa + (pb - pa) * k];
    }
  }
  return VIEWW.at(-1).slice(1);
};
// ENGAGE='[[sec,0|1],…]' — 模拟鼠标压在输入框上（透镜 mass 1 → 1.35）
const ENGW = process.env.ENGAGE ? JSON.parse(process.env.ENGAGE) : null;
const engageAt = t => {
  if (!ENGW) return null;
  let v = ENGW[0][1];
  for (const [s, x] of ENGW) { if (t >= s) v = x; else break; }
  return v;
};
const cursorAt = t => {
  if (!WAY) return null;
  if (t <= WAY[0][0]) return WAY[0].slice(1);
  for (let i = 1; i < WAY.length; i++) {
    if (t <= WAY[i][0]) {
      const [ta, xa, ya] = WAY[i - 1], [tb, xb, yb] = WAY[i];
      const k = (t - ta) / (tb - ta);
      return [xa + (xb - xa) * k, ya + (yb - ya) * k];
    }
  }
  return WAY.at(-1).slice(1);
};
const fps = Number(fpsArg);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const PAGE = process.env.PAGE
  ? `file://${process.cwd()}/${process.env.PAGE}?motion=on&capture=1`
  : `file://${process.cwd()}/pi-agent-chat-stars.html?motion=on&capture=1`;

mkdirSync(outDir, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--enable-unsafe-swiftshader', '--hide-scrollbars', '--no-first-run',
  `--window-size=${W},${H}`, '--user-data-dir=/tmp/cdp-profile', PAGE,
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page' && t.url.includes('.html'));
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no page target');
}

const ws = new WebSocket(await findPage());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => {
  const n = ++id;
  pending.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params }));
});

await send('Page.enable');
// wait until the module has booted
for (let i = 0; i < 120; i++) {
  const r = await send('Runtime.evaluate', { expression: '!!window.__still', returnByValue: true });
  if (r.result?.result?.value) break;
  await sleep(250);
}

// let the scene settle once so shaders are compiled before frame 0
await send('Runtime.evaluate', { expression: 'window.__still(3.6)' });
await sleep(2500);

const n = Math.round((Number(t1) - Number(t0)) * fps);
const pad = String(n).length;
console.log(`capturing ${n} frames  ${t0}s→${t1}s @ ${fps}fps  ${W}x${H}`);

const started = Date.now();
for (let i = 0; i < n; i++) {
  const t = Number(t0) + i / fps;
  const cur = cursorAt(t), vw = viewAt(t), en = engageAt(t);
  await send('Runtime.evaluate', {
    expression: `window.__still(${t});${vw ? `window.__view(${vw[0]},${vw[1]});` : ''}${cur ? `window.__cursor(${cur[0]},${cur[1]});` : ''}${en !== null ? `window.__engage(${en});` : ''} new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
    awaitPromise: true,
  });
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(`${outDir}/f${String(i).padStart(pad, '0')}.png`, Buffer.from(shot.result.data, 'base64'));
  if (i % 24 === 0) {
    const el = (Date.now() - started) / 1000;
    process.stdout.write(`  ${i}/${n}  ${el.toFixed(0)}s  eta ${((el / (i + 1)) * (n - i - 1)).toFixed(0)}s\n`);
  }
}

ws.close();
chrome.kill();
console.log(`done ${n} frames in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(0);
