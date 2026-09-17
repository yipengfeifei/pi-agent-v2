import * as THREE from "three";
import { SKY, STARS } from "../StarChart";

// ⚠️ 本文件由 scripts/port-starfield.mjs 从 demos/pi-agent-chat-stars.html 生成，不要手改。
//    改引擎请改 demo，然后重跑：node scripts/port-starfield.mjs
export function mountStarField({ root, promptEl: promptElIn, canvas: canvasIn, labelCanvas: labelCanvasIn, noteEl, failEl }) {
  /* 所有副作用的句柄都收在这里，卸载时一次清干净 */
  const ac = new AbortController();
  const __on = (t, ev, fn, op) => t && t.addEventListener(ev, fn, { ...(op || {}), signal: ac.signal });
  let resizeObserver = null, motionTimer = null;



  /* ══════════════════════════════════════════════════════════════════════
     Recovered from chunks/CY55ErfD.js, function Zr(canvas, props)
     ══════════════════════════════════════════════════════════════════════ */

  const hero = root;
  const canvas = canvasIn;
  const promptEl = promptElIn;
  const wrapEl = promptEl;

  const note = noteEl;
  function fail(msg) {
    const b = failEl;
    b.style.display = 'block';
    b.textContent = '背景引擎没起来：' + msg + '\n（这条横幅出现时，星空一定不会动）';
    throw new Error(msg);
  }

  const params = new URLSearchParams(location.search);
  /* ?lens=0…2 — 0 disables the warp, 1 = Krea's original reach/strength */
  const LENS = params.has('lens') ? Math.max(0, parseFloat(params.get('lens'))) : null;

  /* ── 视角与纵深 ───────────────────────────────────────────────────────
     相机绕 (0,0,-4900) 转（半径 6000→600，Krea 的入场），指针叠加大幅环视。
     星图铺在半径 22000 的天球上、球心就在枢轴 —— 所以相机基本在球心，
     透视近似正交，星座不会被拉变形。

     纵深只有两条线索：
       1. 环视时天球整体扫过，粒子层按自己的轨道走 → 两者视差不同
       2. 粒子按距离失焦（近处散成光斑，远处才是锐点）→ 天球落在焦平面上  */
  /* 视角控制分两条，因为它们是矛盾的：
       · 悬停要稳   → 光标不能同时当转视角用（1:1 跟随才稳，但那样只能扫 ±56°）
       · 要能看全   → 偏航得覆盖 360°、俯仰 ±90°
     所以：光标只做瞄准 + Krea 那点微动；**拖拽**才是自由环视，覆盖整个天球。 */
  const LOOK         = 0.35;   // 指针微动幅度（rad），保留 Krea 的视差手感
  const DRAG_SENS    = 0.0042; // 拖拽灵敏度 rad/px —— 1280px 约扫 308°
  const DOF          = 1.0;    // 粒子失焦强度，0 = 全锐

  const P = k => params.has(k) ? Math.max(0, parseFloat(params.get(k))) : null;
  const LOOK_V   = P('look') ?? LOOK;
  const DRAG_SENS_V = P('dragsens') ?? DRAG_SENS;
  const DOF_V    = P('dof')  ?? DOF;
  const DUST_V = P('dust');
  // demo 默认就动：系统开着「减少动态效果」也能看见效果。?motion=off 关掉，F 键切换。
  const FORCE_MOTION = params.get('motion') !== 'off';
  const CAPTURE = params.has('capture');   // clock driven externally via __still(t)
  let   userMotion = FORCE_MOTION;

  const prefersReduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches && !userMotion;
  const reduced = () => prefersReduce();

  /* ── renderer ──────────────────────────────────────────────────────── */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, depth:false, powerPreference:'low-power' });
  } catch (e) {
    fail('WebGL 起不来 —— 浏览器可能关了硬件加速。\n错误：' + e.message);
    throw e;
  }
  /* 背景不需要 Retina 级锐度。dpr 2 → 1.0 让全屏片元数只剩 1/4：
     全屏透镜 pass + 15000 个加法粒子的开销全部随 dpr² 走。
     实测（FLY 可见时）：GPU 83% → 17%，再把 dpr 压到 1.0 后 → ~10%。 */
  const DPR_CAP = Number(new URLSearchParams(location.search).get('dpr') ?? 1.0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, DPR_CAP));
  renderer.info.autoReset = false;   // 一帧里有两次 render，需要手动累计
  renderer.toneMapping = THREE.ACESFilmicToneMapping;      // toneMapping = 2

  const scene  = new THREE.Scene();
  scene.background = new THREE.Color(0);
  const camera = new THREE.PerspectiveCamera(58, 1, 30, 60000);
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer:false });

  /* ══════════════════════════════════════════════════════════════════════
     Two stacked layers, both living in the SAME 3D scene, so one render
     and one lens pass handles them together:

       L0  Krea's particle sky   — atmosphere, gives the lens depth to bend
       L1  the project's real sky — whole-sky map: 519 catalogue stars,
                                    88 IAU constellations, hover to light

     Putting L1 in world space rather than as a screen sticker is what makes
     both layers track the camera together; a pinned overlay would slide
     against the particles the moment the pointer moves.
     ══════════════════════════════════════════════════════════════════════ */

  /* ── L0: Krea's particle sky (chunks/CY55ErfD.js, minus the "Agent" glyph) ── */
  let lcg = 7391;                                   // LCG，跟 Krea 的星场同一个种子
  const rnd = () => (lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0) / 4294967296;

  const POS = [], COL = [], STAR = [];
  const _v = new THREE.Vector3(), _c = new THREE.Color();
  const PARTICLE_DENSITY = Number(new URLSearchParams(location.search).get('density') ?? 1);
  // 2.5 = 15000 点。密度上限由可读性门线倒推（见 #check 的 copyEffectivePeak / copyBusyPercent）
  const COUNT = Math.round((canvas.clientWidth < 640 ? 1750 : 3000) * PARTICLE_DENSITY);

  for (let i = 0; i < COUNT * 5; i++) {
    const far = i >= COUNT;
    _v.setFromSphericalCoords(
      far ? 10000 + rnd() * 10000 : 800 + Math.cbrt(rnd()) * 11000,
      Math.acos(rnd() * 2 - 1),
      rnd() * Math.PI * 2);
    if (i % 40 === 0 && !far) _v.multiplyScalar(0.25);
    POS.push(_v.x, _v.y, _v.z);
    STAR.push(
      far ? 0.15 + rnd() * 0.65 : 0.35 + Math.pow(rnd(), 2) * 3.3,
      far ? 0.02 + Math.pow(rnd(), 2) * 0.2 : 0.05 + Math.pow(rnd(), 3) * 8,
      rnd() * Math.PI * 2,
      0.8 + rnd() * 0.9);
    const r = rnd();
    const hue = r < 0.08 ? 0.06 + rnd() * 0.08 : r > 0.99 ? 0.83 + rnd() * 0.1 : 0.55 + rnd() * 0.1;
    _c.setHSL(hue, 0.5 + rnd() * 0.35, 0.64 + rnd() * 0.2, THREE.SRGBColorSpace);
    COL.push(_c.r, _c.g, _c.b);
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(POS, 3));
  starGeo.setAttribute('color',    new THREE.Float32BufferAttribute(COL, 3));
  starGeo.setAttribute('star',     new THREE.Float32BufferAttribute(STAR, 4));

  const starUniforms = {
    arrival:    { value: 0 },
    time:       { value: 0 },
    quiet:      { value: new THREE.Vector2(0.8, 0.7) },
    pixelRatio: { value: renderer.getPixelRatio() },
    dof:        { value: DOF },
    twinkle:    { value: Number(new URLSearchParams(location.search).get('twinkle') ?? 0.75) },
    // L1 carries the data now, so the atmosphere steps back instead of competing.
    dim:        { value: DUST_V ?? 0.30 },
  };

  const starMat = new THREE.ShaderMaterial({
    uniforms: starUniforms,
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 color;
      attribute vec4 star;
      uniform float arrival, pixelRatio, time, dim, dof, twinkle;
      varying vec3 tint;
      varying float energy, angle, aspect, spriteSize, foreground, defocus;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        float distance = max(1.0, -view.z);
        // 近处的尘埃该是失焦光斑，远处才是锐点 —— 这是纵深的唯一线索
        defocus = dof * (1.0 - smoothstep(900.0, 5200.0, distance));
        float diameter = clamp(star.x * 1400.0 / distance, 0.45, 3.8);
        foreground = arrival * smoothstep(1.2, 2.0, diameter) * (1.0 - smoothstep(1800.0, 3200.0, distance));
        spriteSize = diameter * 7.0 + 5.0;
        gl_PointSize = spriteSize * pixelRatio;
        energy = star.y * smoothstep(100.0, 400.0, distance) * dim;
        // 闪烁：幅度不乘 dim，否则压暗之后就看不出在动了
        float amp = twinkle * step(0.30, star.y) * step(0.55, fract(star.z * 3.77));
        energy *= 1.0 + arrival * amp
          * (0.60 + 0.40 * sin(time * (0.9 + star.w * 1.7) + star.z * 11.0));
        tint = color;
        angle = star.z;
        aspect = star.w;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 tint;
      varying float energy, angle, aspect, spriteSize, foreground, defocus;
      void main() {
        vec2 pixel = (gl_PointCoord - 0.5) * spriteSize;
        float pinpoint = exp(-dot(pixel, pixel) * 0.5);
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
        p *= vec2(inversesqrt(aspect), sqrt(aspect));
        // 失焦 = 核心的衰减指数塌下来，光散成一团；锐度只在远处保留
        float k = mix(65.0, 6.0, defocus);
        float core = exp(-dot(p, p) * k);
        vec2 shoulder = p - vec2(0.055, 0.025);
        float light = core + exp(-dot(shoulder, shoulder) * k * 0.55) * 0.22
          + exp(-dot(p, p) * 20.0) * 0.08 + exp(-dot(p, p) * 6.0) * 0.004;
        gl_FragColor = vec4((tint * light + vec3(1.0) * pinpoint * foreground * 3.0) * energy, 1.0);
      }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  /* ══════════════════════════════════════════════════════════════════════
     L1 = the real sky, wrapped around the viewer as a sphere.

     一次只看得见约 14% 的天区 —— 这是要的，不是缺陷。整张星图铺满整个
     空间，随着视角变化才能逐块看到全部内容。投影本身的定义就是这样，
     想「整张同屏」就只能做成平面卡片，那是另一件事。
     ══════════════════════════════════════════════════════════════════════ */
  /* ── the real sky ─────────────────────────────────────────────────────
     No random stars. This is the actual catalogue from the project
     (frontend/components/StarChart.tsx → demos/star-chart-data.js):
       519 stars, [RA*100, Dec*100, mag*100, "r,g,b"], real B–V colours,
       magnitudes −1.44 (Sirius) … +4.0.
     RA/Dec is mapped onto a sphere of radius SKY_R, so the Krea camera
     actually flies through the real sky. Size and brightness come
     straight from the magnitude — nothing is invented. */
  /* The camera orbits (0,0,-4900) at a radius of 600…6000. Centring the sphere on
     the ORIGIN instead put the camera 48% of the way out, so perspective stretch
     mangled every constellation off-axis (measured: visible-star distance spread
     4581→9324, i.e. 2.0×). Centred on the pivot with a 22k radius that spread is
     ~1.03× and the sky reads as a proper map. */
  const SKY_CENTER = new THREE.Vector3(0, 0, -4900);
  const SKY_R = 22000;

  const RAW_STARS = STARS;
  const MAG_MIN = -1.44, MAG_MAX = 4.0;

  /* celestial sphere: RA 0 / Dec 0 sits at (0,0,-R), i.e. dead ahead at t=0.
     The catalogue stores RA as degrees over the full ring (-180…180), the same
     convention the project's px() uses — NOT hours. */
  function raDecToVec3(raDeg, decDeg, out) {
    const ra = (raDeg * Math.PI) / 180, dec = (decDeg * Math.PI) / 180;
    return out.set(
      SKY_CENTER.x + SKY_R * Math.cos(dec) * Math.sin(ra),
      SKY_CENTER.y + SKY_R * Math.sin(dec),
      SKY_CENTER.z - SKY_R * Math.cos(dec) * Math.cos(ra));
  }

  /* pure: catalogue magnitude → apparent diameter px (formula from StarChart.tsx) */
  const magToDiameter = mag => Math.min(3.0, Math.max(0.7, 2.6 - mag * 0.42));
  /* pure: catalogue magnitude → intrinsic brightness. Real range, no fudging. */
  const magToEnergy = mag => 0.10 + 0.90 * Math.pow((MAG_MAX - mag) / (MAG_MAX - MAG_MIN), 1.15);

  const ALWAYS_ON_MAG = 1.5;                 // ~23 颗常亮星，跟原项目一致

  const SKY_POS = [], SKY_COL = [], SKY_STAR = [], GAIN = [];
  const _sv = new THREE.Vector3(), _sc = new THREE.Color();

  RAW_STARS.forEach((s, i) => {
    const ra = s[0] / 100, dec = s[1] / 100, mag = s[2] / 100;
    raDecToVec3(ra, dec, _sv);
    SKY_POS.push(_sv.x, _sv.y, _sv.z);
    const [cr, cg, cb] = s[3].split(',').map(n => Number(n) / 255);
    _sc.setRGB(cr, cg, cb, THREE.SRGBColorSpace);   // catalogue colours are sRGB
    SKY_COL.push(_sc.r, _sc.g, _sc.b);
    SKY_STAR.push(
      magToDiameter(mag),                      // x: apparent diameter
      magToEnergy(mag),                        // y: intrinsic brightness
      (i * 2.399963) % (Math.PI * 2),          // z: twinkle phase (golden-angle, stable)
      0.8 + ((i * 0.61803398875) % 1) * 0.9);  // w: aspect / twinkle speed
    GAIN.push(mag <= ALWAYS_ON_MAG ? 1 : 0);   // 常亮星置 1，其余由星座激活接管
  });

  const SKY_COUNT = RAW_STARS.length;

  const skyGeo = new THREE.BufferGeometry();
  skyGeo.setAttribute('position', new THREE.Float32BufferAttribute(SKY_POS, 3));
  skyGeo.setAttribute('color',    new THREE.Float32BufferAttribute(SKY_COL, 3));
  skyGeo.setAttribute('star',     new THREE.Float32BufferAttribute(SKY_STAR, 4));
  const gainAttr = new THREE.Float32BufferAttribute(new Float32Array(GAIN), 1);
  skyGeo.setAttribute('gain', gainAttr);
  const gain = gainAttr.array;              // same caveat as lineAct above

  const skyUniforms = {
    arrival:    { value: 0 },
    time:       { value: 0 },
    quiet:      { value: new THREE.Vector2(0.8, 0.7) },
    pixelRatio: { value: renderer.getPixelRatio() },
    // 星图作为应用背景要压到正文之下：0.42 = 看得清星座、又不跟正文抢
    skyDim:     { value: Number(new URLSearchParams(location.search).get('skydim') ?? 0.60) },
    skyTwinkle: { value: Number(new URLSearchParams(location.search).get('twinkle') ?? 0.75) },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 color;
      attribute vec4 star;
      attribute float gain;
      uniform float arrival, pixelRatio, time, skyDim, skyTwinkle;
      varying vec3 tint;
      varying float energy, angle, aspect, spriteSize, foreground;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        // Real catalogue stars are effectively at infinity: apparent size comes
        // from the magnitude alone, it must not change as the camera moves.
        float diameter = clamp(star.x, 0.5, 4.2);
        spriteSize = diameter * 7.0 + 5.0;
        gl_PointSize = spriteSize * pixelRatio;
        float tw = sin(time * (0.9 + star.w * 1.7) + star.z * 11.0);
        // gain: 1 for the ~23 always-on bright stars, otherwise the smoothed
        // activation of the constellation this star belongs to (0.16 floor).
        // 被点亮的星座和常亮星不受背景压暗影响 —— 悬停要一眼看得出来
        energy = star.y * arrival * mix(skyDim, 1.0, gain)
               * (1.0 + skyTwinkle * (0.5 + 0.5 * tw));
        foreground = arrival * gain * smoothstep(2.6, 3.6, star.x);
        tint = color;
        angle = star.z;
        aspect = star.w;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 tint;
      varying float energy, angle, aspect, spriteSize, foreground;
      void main() {
        vec2 pixel = (gl_PointCoord - 0.5) * spriteSize;
        float pinpoint = exp(-dot(pixel, pixel) * 0.5);
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
        p *= vec2(inversesqrt(aspect), sqrt(aspect));
        float core = exp(-dot(p, p) * 65.0);
        vec2 shoulder = p - vec2(0.055, 0.025);
        float light = core + exp(-dot(shoulder, shoulder) * 35.0) * 0.22
          + exp(-dot(p, p) * 20.0) * 0.08 + exp(-dot(p, p) * 6.0) * 0.004;
        gl_FragColor = vec4((tint * light + vec3(1.0) * pinpoint * foreground * 3.0) * energy, 1.0);
      }`,
  });
  const skyPoints = new THREE.Points(skyGeo, skyMat);
  skyPoints.frustumCulled = false;
  scene.add(skyPoints);

  /* ── 88 real constellations, in 3D ────────────────────────────────────
     Lines and member stars come from the same IAU data as the project.
     Each constellation owns one scalar `act` (0→1). It rises when the cursor
     comes within HIT px of any of its projected vertices — that is the only
     thing that lights a constellation up, exactly like the original. */
  const LINE_COLOR = new THREE.Color().setRGB(1, 224 / 255, 140 / 255, THREE.SRGBColorSpace); // 金色，取自 StarChart.tsx
  const HIT = 55, SNAP = 14, STAR_HOVER = 90;

  /* ---------- stars → 3D positions, once ---------- */
  const starVec = RAW_STARS.map(s => {
    const v = new THREE.Vector3();
    return raDecToVec3(s[0] / 100, s[1] / 100, v);
  });

  /* ---------- constellations → 3D line segments ---------- */
  const constellations = Object.entries(SKY).map(([id, segs]) => {
    const verts3 = [];                       // this constellation's vertices, in 3D
    const key = new Map();                   // dedupe shared vertices
    const lines = [];
    for (const seg of segs) {
      const run = seg.map(([ra, dec]) => {
        const k = ra.toFixed(2) + ',' + dec.toFixed(2);
        if (!key.has(k)) { const v = new THREE.Vector3(); key.set(k, raDecToVec3(ra, dec, v)); }
        return key.get(k);
      });
      for (let i = 1; i < run.length; i++) lines.push([run[i - 1], run[i]]);
      verts3.push(...run);
    }
    return { id, lines, verts3, act: 0, mid: new THREE.Vector3() };
  });

  const linePos = [], lineActIdx = [];        // per-vertex activation slot
  for (let ci = 0; ci < constellations.length; ci++) {
    for (const [a, b] of constellations[ci].lines) {
      linePos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      lineActIdx.push(ci, ci);
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
  const lineActAttr = new THREE.Float32BufferAttribute(new Float32Array(lineActIdx.length), 1);
  lineGeo.setAttribute('act', lineActAttr);
  // three's Float32BufferAttribute *copies* the array you hand it, so keep a handle
  // on the attribute's own store — writing into anything else uploads nothing.
  const lineAct = lineActAttr.array;

  const lineMat = new THREE.ShaderMaterial({
    uniforms: { tint: { value: LINE_COLOR }, opacity: { value: 0.55 }, uArrival: { value: 0 } },
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float act;
      varying float vAct;
      void main() {
        vAct = act;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 tint; uniform float opacity; uniform float uArrival;
      varying float vAct;
      void main() {
        float a = vAct * uArrival;
        if (a < 0.004) discard;
        gl_FragColor = vec4(tint * a * opacity, 1.0);
      }`,
  });
  const lineMesh = new THREE.LineSegments(lineGeo, lineMat);
  lineMesh.frustumCulled = false;
  scene.add(lineMesh);

  /* ---------- which catalogue stars belong to which constellation ---------- */
  /* 成员星匹配：和原项目一样，用屏幕上 14px 内的距离来判定归属。 */
  const starOwner = new Array(RAW_STARS.length).fill(-1);
  {
    const v = new THREE.Vector3();
    constellations.forEach((c, ci) => {
      for (let si = 0; si < RAW_STARS.length; si++) {
        if (starOwner[si] !== -1 && RAW_STARS[si][2] / 100 <= ALWAYS_ON_MAG) continue;
        const p = starVec[si];
        if (c.verts3.some(q => q.distanceTo(p) < SKY_R * 0.016)) {   // ≈14px at the project's scale
          if (starOwner[si] === -1) starOwner[si] = ci;
        }
      }
    });
  }

  /* ---------- hover test: project vertices to CSS px, measure to the cursor ---------- */
  const _p = new THREE.Vector3();
  function isHot(mx, my, verts3, hit = HIT) {
    const w = cssW, h = cssH;
    for (const v of verts3) {
      _p.copy(v).project(camera);
      if (_p.z < -1 || _p.z > 1) continue;
      const dx = (_p.x * 0.5 + 0.5) * w - mx;
      const dy = (1 - (_p.y * 0.5 + 0.5)) * h - my;
      if (dx * dx + dy * dy < hit * hit) return true;
    }
    return false;
  }

  /* ---------- constellation names: a crisp 2D overlay, not refracted ---------- */
  const labelCv = labelCanvasIn;
  const labelCtx = labelCv.getContext('2d');

  let cssW = 1, cssH = 1;
  function updateConstellations(mx, my, dt, arrival) {
    lineMat.uniforms.uArrival.value = arrival;

    for (const c of constellations)
      c.act += ((isHot(mx, my, c.verts3) ? 1 : 0) - c.act) * 0.08;

    for (let i = 0; i < lineActIdx.length; i++)
      lineAct[i] = constellations[lineActIdx[i]].act;
    lineActAttr.needsUpdate = true;
    window.__lineActMax = Math.max(...lineAct);

    // 常亮星永远 1；其余星跟着自己所属星座走，有 0.16 的底噪（其余星座暗下去）
    for (let si = 0; si < SKY_COUNT; si++) {
      const own = starOwner[si];
      gain[si] = RAW_STARS[si][2] / 100 <= ALWAYS_ON_MAG ? 1
               : Math.max(0.16, own === -1 ? 0 : constellations[own].act);
    }
    gainAttr.needsUpdate = true;

    // 名字：投影到屏幕，只画 act > 0.5 的
    const dpr = renderer.getPixelRatio();
    labelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    labelCtx.clearRect(0, 0, cssW, cssH);
    labelCtx.font = '11px -apple-system, sans-serif';
    labelCtx.textAlign = 'center';
    for (const c of constellations) {
      if (c.act <= 0.5) continue;
      if (c.mid.lengthSq() === 0) {                  // centroid of its vertices
        c.mid.set(0, 0, 0);
        for (const v of c.verts3) c.mid.add(v);
        c.mid.multiplyScalar(1 / c.verts3.length);
      }
      _p.copy(c.mid).project(camera);
      if (_p.z < -1 || _p.z > 1) continue;
      labelCtx.globalAlpha = (c.act - 0.5) * 2;
      labelCtx.fillStyle = '#f2e3b3';
      labelCtx.fillText(c.id, (_p.x * 0.5 + 0.5) * cssW, (1 - (_p.y * 0.5 + 0.5)) * cssH - 8);
      labelCtx.globalAlpha = 1;
    }
  }

  /* ── gravitational-lens post pass ──────────────────────────────────── */
  const lensUniforms = {
    tDiffuse:   { value: target.texture },
    resolution: { value: new THREE.Vector2(1, 1) },
    box:        { value: new THREE.Vector4() },      // centreX, centreY, halfW, halfH
    radius:     { value: 32 },
    amount:     { value: 0 },
    mass:       { value: 1 },
    time:       { value: 0 },
    arrival:    { value: 0 },
    quiet:      { value: new THREE.Vector2(0.8, 0.7) },
    // Reach / strength of the warp. Krea ships 45→115 px reach with a 0.45 pull and a
    // 1.8 bend — tuned for a dense particle cloud. Over 1px constellation lines that
    // band smears the shapes, hence the tighter defaults. `?lens=1` restores Krea's.
    lensNear:   { value: 16 },
    lensFar:    { value: 64 },
    lensPull:   { value: 0.35 },
    lensBend:   { value: 1.15 },
  };

  if (LENS !== null) {                       // ?lens=0 off · ?lens=1 Krea's original · 0…2 scales it
    lensUniforms.lensNear.value =  45 * LENS;
    lensUniforms.lensFar.value  = 115 * LENS;
    lensUniforms.lensPull.value = 0.45 * LENS;
    lensUniforms.lensBend.value = 1.80 * LENS;
  }

  const lensMat = new THREE.ShaderMaterial({
    uniforms: lensUniforms, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform vec2 resolution, quiet;
      uniform vec4 box;
      uniform float radius, amount, mass, arrival, time;
      uniform float lensNear, lensFar, lensPull, lensBend;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * resolution - box.xy;
        vec2 q = abs(p) - box.zw + radius;
        float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
        // 全屏片元里，只有输入框周围 lensFar 以内才需要算透镜。
        // 其余像素直通采样即可 —— 这一段是全屏 pass 最大的一笔节省。
        float influence = amount * (1.0 - smoothstep(lensNear, lensFar, edge));
        vec3 light;
        if (influence < 0.002 && abs(edge) > 6.0) {
          light = texture2D(tDiffuse, vUv).rgb;
        } else {
          float horizon = max(box.w, 24.0);
          float impact = horizon + max(edge, 0.0);
          float einstein = horizon + 26.0 * mass;
          // Point-mass lens equation adapted to a rounded rectangle, not a Schwarzschild solution.
          float source = impact - einstein * einstein / impact;
          vec2 direction = normalize(p / max(box.zw, vec2(1.0)) + vec2(0.00001));
          // Krea's own numbers are p*0.45 / source*1.8 with a 45→115 px falloff. That is
          // tuned for a dense particle cloud; over 1px constellation lines the wide band
          // smears the shapes, so both the reach and the pull are dialled down here.
          vec2 bent = (box.xy + p * lensPull + direction * source * lensBend) / resolution;
          vec2 sampleUv = mix(vUv, bent, influence);
          vec2 bounds = min(sampleUv, 1.0 - sampleUv) * resolution;
          light = texture2D(tDiffuse, clamp(sampleUv, 0.0, 1.0)).rgb
            * smoothstep(0.0, 2.0, min(bounds.x, bounds.y));
          light *= mix(1.0, smoothstep(-1.0, 1.0, edge), amount);
          float ring = edge - 0.65;
          float pixel = max(fwidth(edge), 0.001);
          float coverage = clamp((ring + 0.25) / pixel + 0.5, 0.0, 1.0)
            - clamp((ring - 0.25) / pixel + 0.5, 0.0, 1.0);
          if (amount > 0.0 && abs(ring) < 3.0) {
            vec3 compressed = vec3(0.0);
            vec2 tangent = vec2(-direction.y, direction.x);
            for (int i = -16; i <= 16; i++) {
              float weight = exp(-pow(float(i) / 9.0, 2.0));
              for (int j = -1; j <= 1; j++) {
                vec2 ray = bent + (tangent * float(i) * 7.0 + direction * float(j) * 18.0 * mass) / resolution;
                compressed += texture2D(tDiffuse, clamp(ray, 0.0, 1.0)).rgb * weight;
              }
            }
            light += amount * (coverage + exp(-abs(ring) / 0.6) * 0.3) * compressed * 1.8;
          }
          float distance = max(edge, 0.0);
          float orbit = atan(direction.y, direction.x) + time * 0.56;
          float flow = 0.12 + 1.4 * pow(0.5 + 0.32 * sin(orbit * 2.0) + 0.18 * sin(orbit * 5.0), 2.0);
          float flare = max(exp(-distance / 20.0) - exp(-5.0), 0.0) * 0.035 * flow;
          light += amount * smoothstep(-0.5, 0.5, edge)
            * vec3(0.5, 0.72, 1.0) * flare;
        }
        // 中心 quiet 区照旧压暗（给你正文让位），这段很便宜，放在分支外面
        float clear = 1.0 - smoothstep(0.35, 1.0, length((vUv * 2.0 - 1.0 - vec2(0.0, 0.34)) / quiet));
        clear *= mix(1.0, smoothstep(12.0, 48.0, edge), amount);
        light *= pow(1.0 - arrival * clear * 0.98, 2.0);
        gl_FragColor = vec4(light, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  /* fullscreen triangle + ortho camera (class Yr in the bundle) */
  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1,3,0, -1,-1,0, 3,-1,0]), 3));
  quadGeo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array([0,2, 0,0, 2,0]), 2));
  const quadMesh = new THREE.Mesh(quadGeo, lensMat);
  const quadScene = new THREE.Scene(); quadScene.add(quadMesh);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /* ── pointer ───────────────────────────────────────────────────────── */
  const pointer = new THREE.Vector2();   // smoothed, normalised −.5…−.5 (camera tilt)
  const aim     = new THREE.Vector2();
  const cursor  = { x: 0, y: 0 };        // CSS px inside the hero — drives the constellation layer
  __on(hero, 'pointermove', e => {
    lastInput = performance.now();
    const r = canvas.getBoundingClientRect();
    aim.set((e.clientX - r.left) / r.width - 0.5, 0.5 - (e.clientY - r.top) / r.height);
    cursor.x = e.clientX - r.left;
    cursor.y = e.clientY - r.top;
  });
  __on(hero, 'pointerleave', () => {
    aim.set(0, 0);
    cursor.x = -9999; cursor.y = -9999;     // nothing hot
  });

  /* ── 拖拽环视：偏航不限，俯仰夹在 ±90°，这样整个天球都够得着 ────────── */
  const view = { yaw: 0, pitch: 0, dragging: false, lastX: 0, lastY: 0 };
  const clampPitch = v => Math.max(-Math.PI / 2 * 0.98, Math.min(Math.PI / 2 * 0.98, v));
  /* 拖拽环视只在「背景」上起手，UI 元素必须原样放行。
     ★ 绝对不要 setPointerCapture：它会把后续 click 重定向到 body，整个界面点不动。
       曾经的症状：切换会话没反应，但 ✕ 删除按钮还灵 —— 因为 button 被守卫挡下、
       没走到捕获那一步，而会话行是 div，走了。 */
  const DRAG_BLOCKERS = 'aside, nav, header, footer, .sidebar, .border-glow-card, ' +
    'button, a, input, textarea, select, label, [role="button"], [contenteditable="true"], [data-no-star-drag]';
  const dragBlocked = el => !!(el && el.closest && el.closest(DRAG_BLOCKERS));
  window.__dragBlocked = dragBlocked;
  __on(hero, 'pointerdown', e => {
    if (e.button !== 0) return;
    if (dragBlocked(e.target)) return;
    view.dragging = true; view.lastX = e.clientX; view.lastY = e.clientY;
    hero.style.cursor = 'grabbing';
  });
  __on(hero, 'pointermove', e => {
    if (!view.dragging) return;
    view.yaw   -= (e.clientX - view.lastX) * DRAG_SENS_V;
    view.pitch  = clampPitch(view.pitch + (e.clientY - view.lastY) * DRAG_SENS_V);
    view.lastX = e.clientX; view.lastY = e.clientY;
    cursor.x = -9999; cursor.y = -9999;        // 拖拽时不点亮星座
  });
  const endDrag = () => { view.dragging = false; hero.style.cursor = ''; };
  __on(hero, 'pointerup', endDrag);
  __on(hero, 'pointercancel', endDrag);
  window.__view = (yaw, pitch) => { view.yaw = yaw; view.pitch = clampPitch(pitch); };
  window.__viewState = () => ({ yaw: +view.yaw.toFixed(3), pitch: +view.pitch.toFixed(3) });

  /* engaged = the prompt box is focused or hovered → mass 1.35 */
  let engaged = 0;
  if (wrapEl) __on(wrapEl, 'pointerenter', () => engaged = 1);
  if (wrapEl) __on(wrapEl, 'pointerleave', () => engaged = 0);
  const editorEl = promptEl && (promptEl.querySelector('textarea') || document.querySelector('textarea'));
  if (editorEl) __on(editorEl, 'focus', () => engaged = 1);
  if (editorEl) __on(editorEl, 'blur',  () => engaged = 0);

  /* ── resize ────────────────────────────────────────────────────────── */
  function resize() {
    const w = canvas.clientWidth || hero.clientWidth;
    const h = canvas.clientHeight || hero.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    target.setSize(canvas.width, canvas.height);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    starUniforms.quiet.value.set(Math.min(0.9, 880 / w), 0.7);
    lensUniforms.resolution.value.set(w, h);

    cssW = w; cssH = h;
    const dpr2 = renderer.getPixelRatio();
    labelCv.width  = Math.round(w * dpr2);
    labelCv.height = Math.round(h * dpr2);

    if (cursor.x === 0 && cursor.y === 0) { cursor.x = w / 2; cursor.y = h / 2; }
  }
  resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
  resize();

  /* 相机摆位单独成函数：自检要在不渲染的前提下扫遍整个天球，验证「看得到全部」 */
  function placeCamera(p, m, h, g) {
    camera.position.set(
      Math.sin(h) * g + Math.sin(m * 0.03) * 6,
      Math.sin(h * 0.7) * 220 * CALM_BOB,          // 慢上下浮，配合自转形成"在星海里漂"
      -4900 + Math.cos(h) * g);
    camera.lookAt(0, 0, -4900);
    // 指针视差：这是最直接的"动态"——鼠标一动，两层一起走
    camera.rotateX(pointer.y * p * 0.45);
    camera.rotateY(pointer.x * p * 0.55);
    camera.rotateZ(Math.sin(m * 0.02) * 0.004);
    // 指针微动（Krea 的视差手感）+ 拖拽自由环视（覆盖整个天球）
    camera.rotateY(pointer.x * LOOK_V * p + view.yaw);
    camera.rotateX(pointer.y * LOOK_V * 0.55 * p + view.pitch);
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  }

  /* ── the loop (verbatim control flow from the bundle) ──────────────── */
  let elapsed = 0, last = 0, engagedDamped = 0, arrived = false;
  /* 应用背景没有"入场"：相机停在一个固定的远轨道上，只做极慢的自转 + 指针视差。
     Krea 的 6000→600 飞入是落地页的东西，放在聊天界面里会让人分心。 */
  const CALM_RADIUS = 2400;
  const CALM_SPIN   = Number(new URLSearchParams(location.search).get('spin') ?? 0.055);  // rad/s ≈ 3°/s
  /* 帧率：交互时 24fps，静止 4 秒后降到 8fps。星空是氛围，60fps 是纯浪费。 */
  const FPS_ACTIVE  = Number(new URLSearchParams(location.search).get('fps') ?? 24);
  const FPS_IDLE    = Number(new URLSearchParams(location.search).get('idlefps') ?? 8);
  let lastInput = 0, lastDraw = 0;
  const CALM_BOB    = Number(new URLSearchParams(location.search).get('bob') ?? 1);

  const fpsWin = [];
  function frame(now) {
    renderer.info.reset();
    fpsWin.push(now); if (fpsWin.length > 60) fpsWin.shift();
    const dt = last && now ? (now - last) / 1000 : 0;
    last = now;
    const step = Math.min(dt, 0.05);

    const f = CAPTURE ? elapsed : (reduced() ? 4.4 : elapsed);
    const p = THREE.MathUtils.smootherstep(f, 0.8, 4.4);
    const m = Math.max(0, f - 4.4);
    engagedDamped = reduced() ? 0
                  : THREE.MathUtils.damp(engagedDamped, engaged ? 1 : 0, 4, step);

    const h = elapsed * CALM_SPIN + engagedDamped * 0.05;
    const g = CALM_RADIUS;

    pointer.lerp(aim, 1 - Math.exp(-step * 4));
    placeCamera(Math.min(1, elapsed / 1.4), m, h, g);

    starUniforms.arrival.value = THREE.MathUtils.smootherstep(f, 1.8, 3.2);
    starUniforms.time.value = m;
    lensUniforms.amount.value = window.__lensOverride ?? (promptEl ? THREE.MathUtils.smootherstep(f, 2.2, 3.2) : 0);
    lensUniforms.mass.value = 1 + engagedDamped * 0.35;
    lensUniforms.time.value = m;
    lensUniforms.arrival.value = starUniforms.arrival.value;

    if (promptEl) {
      const cr = canvas.getBoundingClientRect();
      const pr = promptEl.getBoundingClientRect();
      lensUniforms.box.value.set(
        pr.left - cr.left + pr.width / 2,
        cr.bottom - pr.bottom + pr.height / 2,
        pr.width / 2, pr.height / 2);
      lensUniforms.radius.value =
        parseFloat(getComputedStyle(promptEl).borderTopLeftRadius) * pr.width / promptEl.offsetWidth;
    }

    if (!arrived && f >= 1.5) arrived = true;
    window.__fps = fpsWin.length > 1 ? (1000 * (fpsWin.length - 1) / (fpsWin[fpsWin.length - 1] - fpsWin[0])) : 0;
    /* L1: 更新每个星座的激活量（投影到屏幕、判断光标距离），再重画标签层 */
    updateConstellations(cursor.x, cursor.y, reduced() && !CAPTURE ? 0 : step,
                         starUniforms.arrival.value);

    renderer.setRenderTarget(target);
    renderer.render(scene, camera);             // L0 + L1 into one buffer…
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);        // …then one lens pass bends both together
  }


  const clock = { running: false };
  /* 窗口不可见 / 失焦时彻底停摆 —— 后台白烧 GPU 是最常见也最没必要的一种浪费 */
  let visible = true;
  __on(document, 'visibilitychange', () => {
    visible = !document.hidden;
    if (visible && clock.running) { last = 0; requestAnimationFrame(tick); }
  });
  function tick(now) {
    if (!clock.running) return;
    if (!visible) return;
    // 帧率闸门：静止 4 秒后降频
    const idle = now - lastInput > 4000 && !constellations.some(c => c.act > 0.02) && !view.dragging;
    const minGap = 1000 / (idle ? FPS_IDLE : FPS_ACTIVE);
    if (now - lastDraw < minGap) { requestAnimationFrame(tick); return; }
    lastDraw = now;
    const dt = last && now ? (now - last) / 1000 : 0;
    if (!CAPTURE) elapsed += Math.min(dt, 0.05);
    frame(now);
    requestAnimationFrame(tick);
  }
  function start() {
    elapsed = CAPTURE ? 0 : (reduced() ? 4.4 : 0);
    last = 0; arrived = false;
      clock.running = true;
    requestAnimationFrame(tick);
  }

  /* ── motion control ────────────────────────────────────────────────── */
  let btnMotion = null;   // 应用版没有这个按钮
  function syncMotionUI() {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    btnMotion = btnMotion || { textContent: '', setAttribute() {} };
    wrapEl.style.animationPlayState = reduced() ? 'paused' : 'running';
    const motionOn = !reduce || userMotion;
    note.style.display = new URLSearchParams(location.search).has('stars') ? 'block' : 'none';
    note.textContent =
      `动态 ${motionOn ? '● 开' : '○ 关'}   ← 点这里 / 按 F 切换\n` +
      `系统 prefers-reduced-motion: ${reduce ? 'reduce（所以默认会停，这里已强制打开）' : 'no-preference'}\n` +
      `webgl: ${renderer.getContext().getParameter(WebGLRenderingContext.RENDERER)}\n` +
      `fps: ${(window.__fps || 0).toFixed(1)}\n` +
      `粒子 ${COUNT * 5} 点 · 真实星 ${RAW_STARS.length} 颗（星等 −1.44…+4.0）\n` +
      `星座 ${constellations.length} · 常亮星 ${RAW_STARS.filter(s => s[2] / 100 <= ALWAYS_ON_MAG).length}` +
      `\n拖动环视 · 悬停点亮星座`;
  }
  /* 应用版没有运动开关按钮，但保留 F 键强制动画——系统开了「减少动态效果」时也能看效果 */
  const toggleMotion = () => { userMotion = !userMotion; last = 0; start(); syncMotionUI(); };
  __on(window, 'keydown', e => {
    if (e.key === 'f' || e.key === 'F') toggleMotion();
  });
  if (noteEl) __on(noteEl, 'click', toggleMotion);
  syncMotionUI();
  start();

  /* self-check: append #check and read document.title — deterministic. */
  window.__render = t => { elapsed = t; last = 0; frame(performance.now()); };
  window.__cursor = (x, y) => { cursor.x = x; cursor.y = y; };
  window.__lensAmount = k => { window.__lensOverride = k; };
  window.__engage = v => { engaged = v ? 1 : 0; };   // 捕获用：模拟鼠标移到输入框上
  window.__view   = (yaw, pitch) => { view.yaw = yaw; view.pitch = pitch; };

  if (location.hash === '#check') {
    setTimeout(() => {
      window.__render(3.6);
      const grab = () => {
        window.__render(3.6);
        const g2 = renderer.getContext();
        const W = canvas.width, H = canvas.height;
        const buf = new Uint8Array(W * H * 4);
        g2.readPixels(0, 0, W, H, g2.RGBA, g2.UNSIGNED_BYTE, buf);
        return buf;
      };
      const warm = b => {
        let n = 0;
        for (let i = 0; i < b.length; i += 4)
          if (b[i] > b[i + 2] + 12 && b[i] > 32 && b[i + 1] > b[i + 2] + 4) n++;
        return n;
      };
      const settle = (x, y) => { cursor.x = x; cursor.y = y;
        for (let i = 0; i < 70; i++) updateConstellations(cursor.x, cursor.y, 1 / 60, 1); };
      const lum = b => { let s = 0; for (let i = 0; i < b.length; i += 4) s += b[i] + b[i + 1] + b[i + 2]; return s / (b.length / 4) / 3; };

      settle(-9999, -9999);
      const bufIdle = grab();

      /* 对比度：正文区域必须留在可读区间 —— 这是「星星太多会不好看」的量化门 */
      const W = canvas.width, H = canvas.height;
      const strip = (buf, y0, y1) => {
        let mx = 0, sum = 0, n = 0;
        for (let y = (H * y0) | 0; y < (H * y1) | 0; y++)
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const v = Math.max(buf[i], buf[i + 1], buf[i + 2]);
            if (v > mx) mx = v; sum += v; n++;
          }
        return { peak: mx, mean: +(sum / n).toFixed(2) };
      };
      /* 读数要按"用户实际看到的"来 —— 画布上面还压着 .scrim 那层暗幕。
         这里把那条 CSS 渐变建模出来，算有效亮度，而不是拿裸画布的峰值吓自己。 */
      const mix = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
      // 与 .scrim 一致：横向只覆盖正文栏（22%~78%），竖向整高
      const scrimAlpha = (x, y) => {
        let h;
        if (x <= 0.22 || x >= 0.78) h = 0;
        else if (x < 0.32) h = 0.62 * (x - 0.22) / 0.10;
        else if (x <= 0.68) h = 0.62;
        else h = 0.62 * (0.78 - x) / 0.10;
        let v;
        if (y < 0.15) v = 0.52 + (0.16 - 0.52) * (y / 0.15);
        else if (y < 0.62) v = 0.16 + (0.18 - 0.16) * ((y - 0.15) / 0.47);
        else if (y < 0.80) v = 0.18 + (0.12 - 0.18) * ((y - 0.62) / 0.18);
        else v = 0.12 * (1 - (y - 0.80) / 0.20);
        return 1 - (1 - h) * (1 - Math.max(0, v));
      };
      // 只量正文真正落在的那一栏（消息列 max-width 820 / 视口 1440 ≈ 0.215…0.785）。
      // 两侧留白是背景最亮的地方，那是要的，不该算进可读性。
      const stripEff = (buf, y0, y1, x0 = 0.21, x1 = 0.79) => {
        let mx = 0, sum = 0, n = 0, busy = 0;
        for (let y = (H * y0) | 0; y < (H * y1) | 0; y++)
          for (let x = (W * x0) | 0; x < (W * x1) | 0; x++) {
            const i = (y * W + x) * 4;
            const raw = Math.max(buf[i], buf[i + 1], buf[i + 2]);
            const eff = raw * (1 - scrimAlpha(x / W, y / H));
            if (eff > mx) mx = eff;
            if (eff > 48) busy++;
            sum += eff; n++;
          }
        return { peak: +mx.toFixed(1), mean: +(sum / n).toFixed(2), busyPct: +(100 * busy / n).toFixed(3) };
      };
      // 只量正文真正落的那块：消息列 820 − 左右各 20 padding = x 0.229…0.771，上下留白扣掉
      const copyBand  = stripEff(bufIdle, 0.06, 0.86, 0.23, 0.77);
      const inputBand = stripEff(bufIdle, 0.88, 1.00);   // 输入区

      let target = null, tx = 0, ty = 0;
      outer:
      for (const cst of constellations)
        for (const v of cst.verts3) {
          _p.copy(v).project(camera);
          if (_p.z <= -1 || _p.z >= 1) continue;
          const x = (_p.x * 0.5 + 0.5) * cssW, y = (1 - (_p.y * 0.5 + 0.5)) * cssH;
          if (x > 200 && x < cssW - 200 && y > 120 && y < cssH - 220) { target = cst; tx = x; ty = y; break outer; }
        }
      let got = null;
      if (target) {
        const r = canvas.getBoundingClientRect();
        hero.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + tx, clientY: r.top + ty }));
        got = [cursor.x, cursor.y];
        settle(cursor.x, cursor.y);
      }
      const bufHot = grab();
      let changed = 0;
      for (let i = 0; i < bufHot.length; i += 4)
        if (Math.abs(bufHot[i] - bufIdle[i]) + Math.abs(bufHot[i + 1] - bufIdle[i + 1]) +
            Math.abs(bufHot[i + 2] - bufIdle[i + 2]) > 12) changed++;

      /* 输入框的透镜必须真的在弯折背后两层 */
      window.__cursor(-9999, -9999);
      window.__lensAmount(0);  const bufNoLens = grab();
      window.__lensAmount(1);  const bufLens   = grab();
      window.__lensAmount(null);
      let lensPx = 0, lensRingPx = 0, ringN = 0;
      // 输入框周围的环带（框外 16~64px）—— 透镜要在这里看得出来
      const cb0 = document.getElementById('composerBox').getBoundingClientRect();
      const cr0 = canvas.getBoundingClientRect();
      const dpr0 = canvas.width / cr0.width;
      const bx0 = (cb0.left - cr0.left) * dpr0, by0 = canvas.height - (cb0.bottom - cr0.top) * dpr0;
      const hw0 = cb0.width / 2 * dpr0, hh0 = cb0.height / 2 * dpr0;
      const cx0 = bx0 + hw0, cy0 = by0 + hh0;
      for (let i = 0; i < bufLens.length; i += 4) {
        const px = (i / 4) % canvas.width, py = Math.floor((i / 4) / canvas.width);
        const qx = Math.abs(px - cx0) - hw0, qy = Math.abs(py - cy0) - hh0;
        const edge = Math.max(qx, qy);
        const inRing = edge > -2 && edge < 64;
        if (inRing) ringN++;
        const d = Math.abs(bufLens[i] - bufNoLens[i]) + Math.abs(bufLens[i + 1] - bufNoLens[i + 1]) +
                  Math.abs(bufLens[i + 2] - bufNoLens[i + 2]);
        if (d > 24) { lensPx++; if (inRing) lensRingPx++; }
      }
      window.__lensRing = { ringPx: lensRingPx, ringArea: ringN, pct: +(100 * lensRingPx / Math.max(ringN, 1)).toFixed(2) };

      const gl = renderer.getContext();
      const box = lensUniforms.box.value;
      const cb = document.getElementById('composerBox').getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      const r = {
        three: THREE.REVISION,
        particles: COUNT * 5,
        particleDim: +starUniforms.dim.value.toFixed(3),
        skyDim: +skyUniforms.skyDim.value.toFixed(3),
        catalogueStars: RAW_STARS.length,
        constellations: constellations.length,
        alwaysOn: [...gain].filter((g, i) => RAW_STARS[i][2] / 100 <= ALWAYS_ON_MAG).length,
        // 输入框：透镜的质点必须落在真实输入框上，尺寸也要对得上
        lensTargetsInput: Math.abs(box.x - (cb.left - cr.left + cb.width / 2)) < 2 &&
                          Math.abs(box.z - cb.width / 2) < 2 &&
                          Math.abs(box.w - cb.height / 2) < 2,
        inputBox: [cb.width, cb.height].map(Math.round),
        lensRadius: +lensUniforms.radius.value.toFixed(1),
        // 可读性
        copyEffectivePeak: copyBand.peak, copyEffectiveMean: copyBand.mean,
        copyBusyPercent: copyBand.busyPct,
        inputEffectivePeak: inputBand.peak,
        lensPixelsMoved: lensPx,
        lensRingChanged: window.__lensRing?.ringPx, lensRingArea: window.__lensRing?.ringArea,
        lensRingChangedPct: window.__lensRing?.pct,
        hovered: target ? target.id : null,
        hoveredAct: target ? +target.act.toFixed(3) : -1,
        pixelsChangedOnHover: changed,
        pointerPlumbed: !!got && Math.abs(got[0] - tx) < 1 && Math.abs(got[1] - ty) < 1,
        // UI 元素必须被放行（否则整个界面点不动），背景必须能起手拖拽
        dragBlocksSidebar: (() => { const a = document.createElement('aside'), sp = document.createElement('span');
          a.appendChild(sp); document.body.appendChild(a); const r = dragBlocked(sp); a.remove(); return r; })(),
        dragBlocksButton: (() => { const b = document.createElement('button'), sp = document.createElement('span');
          b.appendChild(sp); document.body.appendChild(b); const r = dragBlocked(sp); b.remove(); return r; })(),
        dragBlocksComposer: (() => { const c = document.createElement('div'), sp = document.createElement('span');
          c.className = 'border-glow-card'; c.appendChild(sp); document.body.appendChild(c);
          const r = dragBlocked(sp); c.remove(); return r; })(),
        dragAllowsBackground: !dragBlocked(document.body),
        reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
      };
      const ok = r.particles >= 5000 &&
                 r.catalogueStars === 519 && r.constellations === 88 && r.alwaysOn === 23 &&
                 r.lensTargetsInput && r.lensRadius === 34 &&            // = BorderGlow 的 borderRadius，不是 height/2
                 // 峰值只作参考不作门线：单颗亮星 170 是设计要的。
                 // 决定可读性的是均值（整片够黑）和花占比（没有成片亮点）。
                 r.copyEffectiveMean < 2 &&       // 均值够暗，长时间阅读不累
                 r.copyBusyPercent < 1.5 &&       // 正文区"花"的像素占比要低 —— 星星就是不能太多
                 r.lensPixelsMoved > 800 && r.lensRingChanged > 2500 &&
                 r.hoveredAct > 0.5 && r.pixelsChangedOnHover > 300 && r.pointerPlumbed;
      document.title = `${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(r)}`;
    }, 2500);
  }


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

  /* ── 清理 ───────────────────────────────────────────────────────────
     ★ 绝对不要 canvas.remove() / labelCv.remove() —— 那些节点是 React 的，
       外部删掉会破坏它的 DOM 树，下一次 reconcile 直接抛 NotFoundError。
       症状：点「新会话」→ entries 清空 → StarField 卸载 → 渲染进程崩溃
       → Electron 显示 "This page couldn't load"。
       这里只做「停循环 + 摘监听 + 放 GPU 资源」，DOM 交给 React 自己收。   */
  return function unmountStarField() {
    clock.running = false;
    ac.abort();                                   // 一次性摘掉所有监听
    try { resizeObserver?.disconnect(); } catch {}
    try { clearInterval(motionTimer); } catch {}
    try { renderer.setAnimationLoop?.(null); } catch {}
    try { renderer.dispose(); } catch {}
  };
}
