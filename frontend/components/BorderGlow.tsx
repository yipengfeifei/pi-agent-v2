"use client";

// BorderGlow —— border-glow-demo.html / input-glow-demo.html 的精确移植
//
// 关键坑（对齐 demo 的关键）：demo 里 buildGlowVars/buildGradientVars 用
// `Object.assign(card.style, vars)` 批量赋值 CSS 自定义属性，浏览器里**不生效**，
// 所以 --glow-color* / --gradient-* 全部走 CSS fallback（紫粉绿青青黄橙 7 色 + 金色光）。
// 这里同样不设置这些变量，让 BorderGlow.css 的 fallback 生效 —— 渲染与 demo 逐像素一致。
// 生效的只有 setProperty 系列：--edge-sensitivity / --border-radius / --glow-padding /
// --cone-spread / --fill-opacity / --card-bg / --edge-proximity / --cursor-angle
import { useRef, useCallback, type ReactNode, type CSSProperties } from "react";
import "./BorderGlow.css";

export function BorderGlow({
  children,
  className = "",
  edgeSensitivity = 30,
  backgroundColor = "#120F17",
  borderRadius = 28,
  glowRadius = 40,
  coneSpread = 25,
  fillOpacity = 0.5,
  style,
}: {
  children: ReactNode;
  className?: string;
  edgeSensitivity?: number;
  backgroundColor?: string;
  borderRadius?: number;
  glowRadius?: number;
  coneSpread?: number;
  fillOpacity?: number;
  style?: CSSProperties;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  const getCenterOfElement = useCallback((el: HTMLElement) => {
    const { width, height } = el.getBoundingClientRect();
    return [width / 2, height / 2];
  }, []);

  const getEdgeProximity = useCallback((el: HTMLElement, x: number, y: number) => {
    const [cx, cy] = getCenterOfElement(el);
    const dx = x - cx;
    const dy = y - cy;
    let kx = Infinity;
    let ky = Infinity;
    if (dx !== 0) kx = cx / Math.abs(dx);
    if (dy !== 0) ky = cy / Math.abs(dy);
    // ponytail: 扁盒子中心区 proximity 天然趋近 0，加 0.5 下限 → 鼠标在输入框内任意位置都触发光晕，贴边再渐强到满
    return Math.min(Math.max(Math.max(1 / Math.min(kx, ky), 0.5), 0), 1);
  }, [getCenterOfElement]);

  const getCursorAngle = useCallback((el: HTMLElement, x: number, y: number) => {
    // 焦点与 CSS --glow-focus-x/y 一致（50%, 250%）：在盒子下方，不在正中心
    const { width, height } = el.getBoundingClientRect();
    const cx = width / 2;
    const cy = height * 2.5;
    const dx = x - cx;
    const dy = y - cy;
    if (dx === 0 && dy === 0) return 0;
    const radians = Math.atan2(dy, dx);
    let degrees = radians * (180 / Math.PI) + 90;
    if (degrees < 0) degrees += 360;
    return degrees;
  }, [getCenterOfElement]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const edge = getEdgeProximity(card, x, y);
    const angle = getCursorAngle(card, x, y);
    card.style.setProperty("--edge-proximity", `${(edge * 100).toFixed(3)}`);
    card.style.setProperty("--cursor-angle", `${angle.toFixed(3)}deg`);
  }, [getEdgeProximity, getCursorAngle]);

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      className={`border-glow-card ${className}`}
      style={{
        "--card-bg": backgroundColor,
        "--edge-sensitivity": edgeSensitivity,
        "--border-radius": `${borderRadius}px`,
        "--glow-padding": `${glowRadius}px`,
        "--cone-spread": coneSpread,
        "--fill-opacity": fillOpacity,
        ...style,
      } as CSSProperties}
    >
      <span className="edge-light" />
      <div className="border-glow-inner">{children}</div>
    </div>
  );
}
