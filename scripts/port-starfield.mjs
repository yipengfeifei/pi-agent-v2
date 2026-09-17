#!/usr/bin/env node
// 把 demos/pi-agent-chat-stars.html 里的星空引擎，移植成前端组件用的模块。
//
// 为什么要有这个脚本：这段引擎的开发/调试是在 demos 那个独立 HTML 里做的，
// 前端组件只是它的一个宿主。手敲转换必然漂移（我就因此给前端发过一版旧引擎，
// 状态条上写着 6000 点、实际应该是 15000）。所以转换只走这一条路。
//
//   node scripts/port-starfield.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "demos", "pi-agent-chat-stars.html");
const out = path.join(root, "frontend", "components", "starfield", "engine.js");

const html = fs.readFileSync(src, "utf8");
const a = html.indexOf('<script type="module">');
const b = html.indexOf("</script>", a);
if (a < 0 || b < 0) throw new Error("在 " + src + " 里找不到 <script type=\"module\">");
let js = html.slice(a + '<script type="module">'.length, b);

// ── demo（独立 HTML）→ 组件（宿主传入 DOM）的差异，全部在这里声明 ──────────
const swaps = [
  ['import * as THREE from \'three\';', 'import * as THREE from "three";'],
  ["import * as THREE from 'three';", 'import * as THREE from "three";'],
  ["const hero      = document.getElementById('app');", "const hero = root;"],
  ["const promptEl  = document.getElementById('composerBox');   // Pi Agent 的 BorderGlow 输入框",
   "const promptEl = promptElIn;"],
  ["const wrapEl    = document.getElementById('composer');", "const wrapEl = promptEl;"],
  ["const note      = document.getElementById('bgNote');", "const note = noteEl;"],
  ["const canvas    = document.getElementById('scene');", "const canvas = canvasIn;"],
  ["const labelCv = document.getElementById('labels');", "const labelCv = labelCanvasIn;"],
  ["const b = document.getElementById('failBanner');", "const b = failEl;"],
  ["const editorEl = document.querySelector('.composer textarea');",
   "const editorEl = promptEl && (promptEl.querySelector('textarea') || document.querySelector('textarea'));"],
  ["const RAW_STARS = window.STARS;", "const RAW_STARS = STARS;"],
  ["Object.entries(window.SKY)", "Object.entries(SKY)"],
  ["wrapEl.addEventListener('pointerenter'", "if (wrapEl) wrapEl.addEventListener('pointerenter'"],
  ["wrapEl.addEventListener('pointerleave'", "if (wrapEl) wrapEl.addEventListener('pointerleave'"],
  ["editorEl.addEventListener('focus'", "if (editorEl) editorEl.addEventListener('focus'"],
  ["editorEl.addEventListener('blur'", "if (editorEl) editorEl.addEventListener('blur'"],
  ["document.getElementById('bgNote').addEventListener('click', toggleMotion);",
   "if (noteEl) noteEl.addEventListener('click', toggleMotion);"],
];
for (const [from, to] of swaps) js = js.split(from).join(to);

// 删掉函数体里残留的 three import（header 已经引入了）
js = js.split("\n").filter((l) => !/^\s*import \* as THREE from ["']three["'];?\s*$/.test(l)).join("\n");

// 宿主必须把 note 节点透传进来（引擎里 note 现在等于参数）
const body = js.split("\n").map((l) => (l.trim() ? "  " + l : l)).join("\n");

const header = `import * as THREE from "three";
import { SKY, STARS } from "../StarChart";

// ⚠️ 本文件由 scripts/port-starfield.mjs 从 demos/pi-agent-chat-stars.html 生成，不要手改。
//    改引擎请改 demo，然后重跑：node scripts/port-starfield.mjs
export function mountStarField({ root, promptEl: promptElIn, canvas: canvasIn, labelCanvas: labelCanvasIn, noteEl, failEl }) {
`;

const footer = `
  /* ── 只读性能统计口 ─────────────────────────────────────────────── */
  window.__starStats = () => ({
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    points: renderer.info.render.points,
    lines: renderer.info.render.lines,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? -1,
    particlePoints: COUNT * 5,
    catalogueStars: RAW_STARS.length,
    lineSegments: lineActIdx.length / 2,
    renderTargetMB: +((canvas.width * canvas.height * 8) / 1048576).toFixed(1),
    fps: +(window.__fps || 0).toFixed(1),
    pixelRatio: renderer.getPixelRatio(),
  });

  /* ── 清理：React 卸载时把副作用收干净 ───────────────────────────── */
  return function unmountStarField() {
    clock.running = false;
    try { renderer.setAnimationLoop?.(null); } catch {}
    try { renderer.dispose(); } catch {}
    for (const el of [canvas, labelCv, note, b]) { try { el?.remove(); } catch {} }
  };
}
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, header + body + footer);
console.log("> 已生成", path.relative(root, out), `(${(header + body + footer).length} bytes)`);
