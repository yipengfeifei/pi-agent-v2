"use client";

// StarField —— Krea Agent 那套星空背景的移植版
//   L0  Krea 粒子场（chunks/CY55ErfD.js）：氛围层，近处自动失焦
//   L1  真实星图（StarChart.tsx 的 519 星 / 88 星座）：铺在半径 22000 的天球内壁
//   L2  引力透镜：质点 = 传入的 promptEl，也就是 BorderGlow 输入框本身
//
// 引擎在 ./starfield/engine.js，是一段独立 vanilla module，输入只有 DOM 节点。
// 这里只负责挂载/卸载。
import { useEffect, useRef } from "react";
import { mountStarField } from "./starfield/engine";

export default function StarField({ zIndex = 0 }: { zIndex?: number }) {
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLCanvasElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const failRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 输入框是 BorderGlow 渲染出来的，等它挂载完再取
    const promptEl = document.querySelector<HTMLElement>(".border-glow-card");
    if (!promptEl || !sceneRef.current || !labelsRef.current) return;
    return mountStarField({
      root: document.body as HTMLElement,
      promptEl,
      canvas: sceneRef.current,
      labelCanvas: labelsRef.current,
      noteEl: noteRef.current as HTMLElement,
      failEl: failRef.current as HTMLElement,
    });
  }, []);

  // 关键：这三个图层必须落在「正文之下」。
  // main 是无 z-index 的普通文档流；positioned + z-index:0 会画在它上面 → 黑纱糊在字上。
  // 负值才会被画到 in-flow 内容下面（父容器背景是透明的，所以看得见）。
  const base = (zIndex ?? 0) - 3;   // -3 画布 / -2 标签 / -1 暗幕

  return (
    <>
      <canvas ref={sceneRef} aria-hidden style={{ position: "fixed", inset: 0, width: "100%", height: "100%", display: "block", zIndex: base }} />
      <canvas ref={labelsRef} aria-hidden style={{ position: "fixed", inset: 0, width: "100%", height: "100%", display: "block", zIndex: base + 1, pointerEvents: "none" }} />
      {/* 正文可读性暗幕：压在星星之上、正文之下（见上面的负 z-index 说明）。
          横向只覆盖正文那一栏 —— 整宽的竖向渐变会把侧边栏和四周留白一起压暗，看着像全屏蒙了黑纱。 */}
      <div
        ref={scrimRef}
        style={{
          position: "fixed", inset: 0, zIndex: base + 2, pointerEvents: "none",
          background:
            "linear-gradient(90deg, transparent 0 22%, rgba(14,14,16,.62) 32%, rgba(14,14,16,.62) 68%, transparent 78% 100%)," +
            "linear-gradient(180deg, rgba(14,14,16,.52) 0, rgba(14,14,16,.16) 15%, rgba(14,14,16,.18) 62%, rgba(14,14,16,.12) 80%, rgba(14,14,16,0) 100%)",
        }}
      />
      <div
        ref={failRef}
        style={{
          display: "none", position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)",
          zIndex: 99, background: "rgba(60,20,20,.94)", border: "1px solid #b91c1c", color: "#fecaca",
          borderRadius: 12, padding: "16px 20px", font: "12px/1.7 var(--font-mono)", whiteSpace: "pre",
        }}
      />
      <div
        ref={noteRef}
        data-debug="1"
        title="点这里切换动态 · 或按 F"
        style={{
          position: "fixed", right: 20, bottom: 14, zIndex: 12,
          font: "11px/1.7 var(--font-mono)", color: "#8b93a1", whiteSpace: "pre",
          background: "rgba(18,18,20,.78)", border: ".5px solid rgba(255,255,255,.14)",
          borderRadius: 10, padding: "8px 12px", cursor: "pointer", backdropFilter: "blur(8px)",
        }}
      />
    </>
  );
}
