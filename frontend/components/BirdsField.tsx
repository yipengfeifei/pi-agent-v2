"use client";

// 空会话背景：鸟群（Vanta 的 BIRDS 效果原生复刻）。
// 原始实现：Vanta（MIT），源自 three.js 示例 canvas_geometry_birds。
//
// 和原版的对应关系：
//   · 群集规则（fragmentShaderVelocity 里那套分离/对齐/聚合）逐条翻译成 CPU 版
//   · 位置/速度按原版上传成两张浮点纹理，顶点/片元着色器逐行照搬
//   · 于是和原版一样：一次 drawArrays 画完 N*9 个顶点，颜色在三角形内插值出渐变
// WebGL 不可用时退回 Canvas2D（用每只鸟一条线性渐变近似顶点插值，见 init2D）。
import { useEffect, useRef } from "react";

// ↓↓↓ 想调效果就改这几行
const COLOR1 = 0xb9531c;        // 调色板 A
const COLOR2 = 0xb9f5bc;        // 调色板 B
const COLOR_MODE = "varianceGradient"; // varianceGradient | variance | lerpGradient | lerp
const QUANTITY = 4;             // 鸟数 = (2^quantity)²：4 → 256 只
const BIRD_SIZE = 0.8;
const WING_SPAN = 25;
const SPEED_LIMIT = 4;
const SEPARATION = 46;
const ALIGNMENT = 11;
const COHESION = 20;
// ↑↑↑

const BOUNDS = 800, BOUNDS_HALF = BOUNDS / 2;
const CAM_Z = 350, FOV = 75, NEAR = 1, FAR = 3000;
const FOCAL = 1 / Math.tan((FOV / 2) * Math.PI / 180);
const PHASE_MOD = 62.83;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ------------------------------ 顶点/片元着色器 ------------------------------ */
// 逐行对应原版 birdVS / birdFS。只去掉 modelMatrix（π/2 的 Y 旋转已烘进顶点），
// 投影/视图矩阵展开成几个 uniform。
const VS = `
attribute vec3 position;
attribute vec2 reference;
attribute float birdVertex;
attribute vec3 birdColor;
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform float birdSize;
uniform float uFx, uFy, uCamZ, uA, uB;
varying vec4 vColor;
varying float z;
void main(){
  vec4 tmpPos = texture2D(texturePosition, reference);
  vec3 pos = tmpPos.xyz;
  vec3 velocity = normalize(texture2D(textureVelocity, reference).xyz);
  vec3 np = position;
  if (birdVertex == 4.0 || birdVertex == 7.0) np.y = sin(tmpPos.w) * 5.0 * birdSize;
  velocity.z *= -1.0;
  float xz = length(velocity.xz);
  float x = sqrt(max(0.0, 1.0 - velocity.y * velocity.y));
  float cosry = velocity.x / max(xz, 1e-6);
  float sinry = velocity.z / max(xz, 1e-6);
  float cosrz = x;
  float sinrz = velocity.y;
  mat3 maty = mat3(cosry, 0.0, -sinry,  0.0, 1.0, 0.0,  sinry, 0.0, cosry);
  mat3 matz = mat3(cosrz, sinrz, 0.0,  -sinrz, cosrz, 0.0,  0.0, 0.0, 1.0);
  np = maty * matz * np;
  np += pos;
  z = np.z;
  vColor = vec4(birdColor, 1.0);   // 逐顶点颜色 → 三角形内插值出渐变
  float vz = np.z - uCamZ;
  float w = -vz;
  if (w < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  gl_Position = vec4(np.x * uFx, np.y * uFy, uA * vz + uB, w);
}`;

const FS = `
precision mediump float;
varying vec4 vColor;
varying float z;
void main(){
  float fac = (1000.0 - z) / 1000.0;
  gl_FragColor = vec4(0.2 + fac * vColor.x, 0.2 + fac * vColor.y, 0.2 + fac * vColor.z, 1.0);
}`;

/* -------------------------------- 场景数据 -------------------------------- */
// 鸟的几何：每只鸟 3 个三角形（身体 / 左翼 / 右翼），末尾整体 scale(0.2)。
// 顶点序 0..8：4 和 7 是翼尖（摆翅时改写 y）。π/2 的 Y 旋转烘进顶点：(x,y,z) → (z,y,-x)
const GEO = new Float64Array(9 * 3);
function buildGeo() {
  const s = BIRD_SIZE, w = WING_SPAN;
  const raw = [
    0, 0, -20 * s, 0, 4 * s, -20 * s, 0, 0, 30 * s,          // 身体
    0, 0, -15 * s, -w * s, 0, 0, 0, 0, 15 * s,               // 左翼
    0, 0, 15 * s, w * s, 0, 0, 0, 0, -15 * s,                // 右翼
  ];
  for (let k = 0; k < 9; k++) {
    const x = raw[k * 3] * 0.2, y = raw[k * 3 + 1] * 0.2, z = raw[k * 3 + 2] * 0.2;
    GEO[k * 3] = z; GEO[k * 3 + 1] = y; GEO[k * 3 + 2] = -x;
  }
}

type Sim = {
  W: number; N: number;
  px: Float32Array; py: Float32Array; pz: Float32Array; ph: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  nvx: Float32Array; nvy: Float32Array; nvz: Float32Array;
  posTex: Float32Array; velTex: Float32Array;
  predX: number; predY: number;
};

function buildSim(quantity: number): Sim {
  const W = Math.pow(2, Math.round(quantity)), N = W * W;
  const s: Sim = {
    W, N,
    px: new Float32Array(N), py: new Float32Array(N), pz: new Float32Array(N), ph: new Float32Array(N),
    vx: new Float32Array(N), vy: new Float32Array(N), vz: new Float32Array(N),
    nvx: new Float32Array(N), nvy: new Float32Array(N), nvz: new Float32Array(N),
    posTex: new Float32Array(N * 4), velTex: new Float32Array(N * 4),
    predX: 10000, predY: 10000,
  };
  for (let i = 0; i < N; i++) {
    // 对应 fillPositionTexture / fillVelocityTexture
    s.px[i] = Math.random() * BOUNDS - BOUNDS_HALF;
    s.py[i] = Math.random() * BOUNDS - BOUNDS_HALF;
    s.pz[i] = Math.random() * BOUNDS - BOUNDS_HALF;
    s.ph[i] = 1;
    s.vx[i] = (Math.random() - 0.5) * 10;
    s.vy[i] = (Math.random() - 0.5) * 10;
    s.vz[i] = (Math.random() - 0.5) * 10;
    s.velTex[i * 4 + 3] = 1;
  }
  return s;
}

// fragmentShaderVelocity 的逐条翻译（用 delta 秒推进，所以速度与帧率无关）
function stepVelocity(s: Sim, delta: number) {
  const { N, px, py, pz, vx, vy, vz, nvx, nvy, nvz } = s;
  const zoneRadius = SEPARATION + ALIGNMENT + COHESION;
  const sepT = zoneRadius > 0 ? SEPARATION / zoneRadius : 0;
  const aliT = zoneRadius > 0 ? (SEPARATION + ALIGNMENT) / zoneRadius : 0;
  const zoneR2 = zoneRadius * zoneRadius;
  const preyR = 150, preyR2 = preyR * preyR;
  const hasPred = s.predX < 9000;

  for (let i = 0; i < N; i++) {
    const sx = px[i], sy = py[i], sz = pz[i];
    let ax = vx[i], ay = vy[i], az = vz[i];
    let limit = SPEED_LIMIT;

    if (hasPred) {                                   // 躲开鼠标
      const dx = s.predX * BOUNDS - sx, dy = s.predY * BOUNDS - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < preyR) {
        const f = ((dist * dist / preyR2 - 1) * delta * 100) / (dist || 1);
        ax += dx * f; ay += dy * f;
        limit += 5;
      }
    }

    // 往中心收（dir.y 先乘 2.5 再归一化，跟原版一致）
    let dx = sx, dy = sy * 2.5, dz = sz;
    let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 1e-6) { const f = delta * 5 / dist; ax -= dx * f; ay -= dy * f; az -= dz * f; }

    for (let j = 0; j < N; j++) {
      dx = px[j] - sx; dy = py[j] - sy; dz = pz[j] - sz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1e-8 || d2 > zoneR2) continue;
      const percent = d2 / zoneR2;
      if (percent < sepT) {                          // 分离
        const f = (sepT / percent - 1) * delta / Math.sqrt(d2);
        ax -= dx * f; ay -= dy * f; az -= dz * f;
      } else if (percent < aliT) {                   // 对齐
        const t = (percent - sepT) / (aliT - sepT);
        const f = (1 - 0.5 * Math.cos(t * Math.PI * 2)) * delta;
        const bx = vx[j], by = vy[j], bz = vz[j];
        const bl = Math.sqrt(bx * bx + by * by + bz * bz);
        if (bl > 1e-6) { ax += bx / bl * f; ay += by / bl * f; az += bz / bl * f; }
      } else {                                       // 聚合
        const t = (percent - aliT) / (1 - aliT);
        const f = 0.5 * Math.cos(t * Math.PI * 2) * delta / Math.sqrt(d2);
        ax += dx * f; ay += dy * f; az += dz * f;
      }
    }

    const l = Math.sqrt(ax * ax + ay * ay + az * az);
    if (l > limit) { const k = limit / l; ax *= k; ay *= k; az *= k; }
    nvx[i] = ax; nvy[i] = ay; nvz[i] = az;
  }

  // 位置用旧的 velocity 推进（原版两个 shader 读的都是上一帧的纹理）
  for (let i = 0; i < N; i++) {
    px[i] += vx[i] * delta * 15;
    py[i] += vy[i] * delta * 15;
    pz[i] += vz[i] * delta * 15;
    s.ph[i] = (s.ph[i] + delta
      + Math.hypot(vx[i], vz[i]) * delta * 3
      + Math.max(vy[i], 0) * delta * 6) % PHASE_MOD;
    s.posTex[i * 4] = px[i]; s.posTex[i * 4 + 1] = py[i];
    s.posTex[i * 4 + 2] = pz[i]; s.posTex[i * 4 + 3] = s.ph[i];
    s.velTex[i * 4] = nvx[i]; s.velTex[i * 4 + 1] = nvy[i]; s.velTex[i * 4 + 2] = nvz[i];
  }
  vx.set(nvx); vy.set(nvy); vz.set(nvz);
  s.predX = 10000; s.predY = 10000;
}

/* ------------------------------ 几何 + 顶点色 ------------------------------ */
type Geom = {
  pos: Float32Array; ref: Float32Array; birdVertex: Float32Array; color: Float32Array;
};

function buildGeom(s: Sim): Geom {
  const { W, N } = s;
  const points = N * 9;
  const pos = new Float32Array(points * 3);
  const ref = new Float32Array(points * 2);
  const birdVertex = new Float32Array(points);
  const color = new Float32Array(points * 3);

  // 对应原版 getNewBirdGeometry：reference 每 3 个顶点（一个三角形）指向一个 boid
  for (let v = 0; v < points; v++) {
    const k = v % 9;
    pos[v * 3] = GEO[k * 3]; pos[v * 3 + 1] = GEO[k * 3 + 1]; pos[v * 3 + 2] = GEO[k * 3 + 2];
    const i = Math.floor(v / 3);
    ref[v * 2] = (i % W) / W;
    ref[v * 2 + 1] = Math.floor(i / W) / W;
    birdVertex[v] = k;
  }

  // 对应 getNewCol + 原版取色循环：Gradient 档每个顶点都重新取色、不写缓存。
  // 同一三角形三个顶点颜色不同 → 顶点着色器插值 → 每只鸟身上一层渐变。
  const r1 = (COLOR1 >> 16 & 255) / 255, g1 = (COLOR1 >> 8 & 255) / 255, b1 = (COLOR1 & 255) / 255;
  const r2 = (COLOR2 >> 16 & 255) / 255, g2 = (COLOR2 >> 8 & 255) / 255, b2 = (COLOR2 & 255) / 255;
  const gradient = COLOR_MODE.indexOf("Gradient") !== -1;
  const isVariance = COLOR_MODE.indexOf("variance") === 0;
  for (let v = 0; v < points; v++) {
    let R: number, G: number, B: number;
    if (isVariance) {
      R = clamp01(r1 + Math.random() * r2);
      G = clamp01(g1 + Math.random() * g2);
      B = clamp01(b1 + Math.random() * b2);
    } else {
      const d = gradient ? Math.random() : Math.floor(v / 9) / N;
      R = r1 + (r2 - r1) * d; G = g1 + (g2 - g1) * d; B = b1 + (b2 - b1) * d;
    }
    color[v * 3] = R; color[v * 3 + 1] = G; color[v * 3 + 2] = B;
  }
  return { pos, ref, birdVertex, color };
}

/* ------------------------------ 渲染器：WebGL ------------------------------ */
function initGL(canvas: HTMLCanvasElement, s: Sim, g: Geom) {
  const opts: WebGLContextAttributes = { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance" };
  const gl = (canvas.getContext("webgl2", opts) || canvas.getContext("webgl", opts)) as WebGLRenderingContext | null;
  if (!gl) return null;
  const isGL2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
  if (!isGL2 && !gl.getExtension("OES_texture_float")) return null;

  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader error");
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link error");
  gl.useProgram(prog);

  const attr = (data: Float32Array, name: string, size: number) => {
    const loc = gl.getAttribLocation(prog, name);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  attr(g.pos, "position", 3);
  attr(g.ref, "reference", 2);
  attr(g.birdVertex, "birdVertex", 1);
  attr(g.color, "birdColor", 3);

  const mkTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, isGL2 ? (gl as WebGL2RenderingContext).RGBA32F : gl.RGBA,
      s.W, s.W, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);   // 原版是 RepeatWrapping
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  };
  const texPos = mkTex(), texVel = mkTex();

  const U = (n: string) => gl.getUniformLocation(prog, n);
  const u = {
    texPos: U("texturePosition"), texVel: U("textureVelocity"), birdSize: U("birdSize"),
    fx: U("uFx"), fy: U("uFy"), camZ: U("uCamZ"), a: U("uA"), b: U("uB"),
  };
  gl.uniform1i(u.texPos, 0);
  gl.uniform1i(u.texVel, 1);
  gl.uniform1f(u.camZ, CAM_Z);
  gl.uniform1f(u.a, -(FAR + NEAR) / (FAR - NEAR));
  gl.uniform1f(u.b, (-2 * FAR * NEAR) / (FAR - NEAR));
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);          // 原版 side: DoubleSide
  gl.clearColor(0, 0, 0, 0);         // 透明：露出 app 自己的背景

  const resize = (w: number, h: number, _dpr: number) => {
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform1f(u.fx, FOCAL / (w / h));
    gl.uniform1f(u.fy, FOCAL);
  };

  return {
    resize,
    draw(_W: number, _H: number) {
      gl.uniform1f(u.birdSize, BIRD_SIZE);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texPos);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, s.W, s.W, gl.RGBA, gl.FLOAT, s.posTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texVel);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, s.W, s.W, gl.RGBA, gl.FLOAT, s.velTex);
      gl.drawArrays(gl.TRIANGLES, 0, s.N * 9);   // 顶点颜色插值出渐变，就靠这一次 draw
    },
    dispose() {
      gl.deleteTexture(texPos); gl.deleteTexture(texVel); gl.deleteProgram(prog);
    },
  };
}

/* --------------------------- 渲染器：Canvas2D 兜底 --------------------------- */
// WebGL 不可用时用：每只鸟一条线性渐变 + 三个三角形合成一条 path。
// 实测比逐三角形平铺填充还快（4.8ms vs 5.5ms），而且能近似出顶点插值的渐变观感。
function init2D(canvas: HTMLCanvasElement, s: Sim, g: Geom) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { N, px, py, pz, vx, vy, vz, ph } = s;
  const tri = new Float64Array(N * 27);      // 每只鸟 9 个顶点的屏幕坐标
  const cent = new Float64Array(N * 2);
  const zc = new Float64Array(N);

  const project = (i: number, W: number, H: number) => {
    const wx = px[i], wy = py[i], wz = pz[i];
    let nx = vx[i], ny = vy[i], nz = -vz[i];
    const vl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= vl; ny /= vl; nz /= vl;
    const xz = Math.sqrt(nx * nx + nz * nz) || 1e-6;
    const cosry = nx / xz, sinry = nz / xz;
    const cosrz = Math.sqrt(Math.max(0, 1 - ny * ny)), sinrz = ny;
    const flap = Math.sin(ph[i]) * 5 * BIRD_SIZE;
    const o = i * 27;
    let cx = 0, cy = 0, n = 0;
    for (let k = 0; k < 9; k++) {
      let lx = GEO[k * 3], ly = GEO[k * 3 + 1], lz = GEO[k * 3 + 2];
      if (k === 4 || k === 7) ly = flap;
      const ax = cosrz * lx + sinrz * ly, ay = -sinrz * lx + cosrz * ly;
      const X = cosry * ax - sinry * lz + wx;
      const Y = ay + wy;
      const Z = sinry * ax + cosry * lz + wz;
      const vzp = CAM_Z - Z;
      if (vzp < 1) { tri[o + k * 3 + 2] = 1e9; continue; }
      const sc = FOCAL / vzp;
      tri[o + k * 3] = W / 2 + (X * sc / (W / H)) * (W / 2);
      tri[o + k * 3 + 1] = H / 2 - Y * sc * (H / 2);
      tri[o + k * 3 + 2] = Z;
      cx += tri[o + k * 3]; cy += tri[o + k * 3 + 1]; n++;
    }
    cent[i * 2] = n ? cx / n : 0;
    cent[i * 2 + 1] = n ? cy / n : 0;
    zc[i] = tri[o + 2];
  };

  return {
    resize(w: number, h: number, dpr: number) {
      canvas.width = w; canvas.height = h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 用 CSS 像素坐标绘制
    },
    draw(W: number, H: number) {
      ctx.clearRect(0, 0, W, H);
      const order: number[] = [];
      for (let i = 0; i < N; i++) order.push(i);
      order.sort((a, b) => pz[a] - pz[b]);          // 远的先画
      for (const i of order) project(i, W, H);
      for (const i of order) {
        const o = i * 27;
        const a = o, b = o + 12;                     // 顶点 0 与顶点 4 当渐变两端
        const fac = (1000 - zc[i]) / 1000;
        const c0 = [(g.color[(i * 9) * 3]), (g.color[(i * 9) * 3 + 1]), (g.color[(i * 9) * 3 + 2])];
        const c1 = [(g.color[(i * 9 + 4) * 3]), (g.color[(i * 9 + 4) * 3 + 1]), (g.color[(i * 9 + 4) * 3 + 2])];
        const rgb = (c: number[]) => "rgb(" + (clamp01(0.2 + fac * c[0]) * 255 | 0) + ","
          + (clamp01(0.2 + fac * c[1]) * 255 | 0) + "," + (clamp01(0.2 + fac * c[2]) * 255 | 0) + ")";
        const grd = ctx.createLinearGradient(tri[a], tri[a + 1], tri[b], tri[b + 1]);
        grd.addColorStop(0, rgb(c0));
        grd.addColorStop(1, rgb(c1));
        ctx.fillStyle = grd;
        ctx.beginPath();
        for (let t = 0; t < 3; t++) {
          const p0 = o + t * 9, p1 = p0 + 3, p2 = p0 + 6;
          if (tri[p0 + 2] > 1e8 || tri[p1 + 2] > 1e8 || tri[p2 + 2] > 1e8) continue;
          ctx.moveTo(tri[p0], tri[p0 + 1]);
          ctx.lineTo(tri[p1], tri[p1 + 1]);
          ctx.lineTo(tri[p2], tri[p2 + 1]);
          ctx.closePath();
        }
        ctx.fill();
      }
    },
    dispose() {},
  };
}

type Renderer = {
  resize(w: number, h: number, dpr: number): void;
  draw(W: number, H: number): void;
  dispose(): void;
};

export default function BirdsField({ zIndex = 0 }: { zIndex?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    buildGeo();
    const sim = buildSim(QUANTITY);
    const geom = buildGeom(sim);

    // 先试 WebGL；不行再退回 Canvas2D（顺序不能反：同一个 canvas 拿了 2d 就再拿不到 webgl）
    let gl: ReturnType<typeof initGL> = null;
    try { gl = initGL(canvas, sim, geom); } catch { gl = null; }
    const c2d = gl ? null : init2D(canvas, sim, geom);
    const renderer: Renderer | null = (gl || c2d) as Renderer | null;
    const is2D = !gl && !!c2d;
    if (!renderer) return;

    let dpr = 1, W = 0, H = 0;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      renderer.resize(Math.round(W * dpr), Math.round(H * dpr), dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    // 鼠标当“天敌”：鸟群会躲开（原版的 predator）
    const onMove = (e: MouseEvent) => {
      sim.predX = e.clientX / W - 0.5;
      sim.predY = e.clientY / H - 0.5;
    };
    window.addEventListener("mousemove", onMove);

    let raf = 0, last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!last) last = now;
      let delta = (now - last) / 1000;
      last = now;
      if (delta > 1) delta = 1;
      if (delta <= 0) return;
      stepVelocity(sim, delta);
      if (is2D) renderer.draw(W, H);
      else renderer.draw(0, 0);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", display: "block", zIndex, pointerEvents: "none" }}
    />
  );
}
