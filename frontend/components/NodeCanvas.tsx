"use client";

// 画布（MagicBento 风格卡片网格 + deps 连线）：节点 = 发光卡片，hover 粒子/边框光，点击看详情（含产物文件预览）
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PiGraph, PiNode } from "@/hooks/usePiSession";
import MagicBento from "./MagicBento";
import { NodeIcon } from "./NodeIcon";
import { MarkdownBody } from "./MarkdownBody";
import { ArtifactPreview } from "./ArtifactPreview";

export function NodeCanvas({ graph, readArtifact }: { graph: PiGraph; readArtifact: (path: string) => Promise<{ kind: string; data: string; ext: string }> }) {
  const [selected, setSelected] = useState<PiNode | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState<Array<{ x1: number; y1: number; x2: number; y2: number }>>([]);
  const nodes = graph.graph?.nodes ?? [];
  const outputs = new Map(graph.outputs.map((o) => [o.nodeId, o]));

  // 产物文件预览（artifactPreview：document/image/audio）
  const [preview, setPreview] = useState<{ path: string; kind: string; data: string; ext: string } | null>(null);
  const [previewErr, setPreviewErr] = useState("");
  const openFile = async (path: string) => {
    setPreviewErr("");
    try {
      const r = await readArtifact(path);
      setPreview({ path, ...r });
    } catch (e) {
      setPreviewErr(String(e));
    }
  };

  // 节点 → bento 卡片数据（状态文本进 description，label=类型）
  const cards = useMemo(
    () =>
      nodes.map((n) => {
        const done = outputs.has(n.id);
        const running = graph.runningNodeId === n.id;
        const blocked = !done && !running && graph.blockedNodeIds.includes(n.id);
        const status = running ? "⏳ 运行中" : blocked ? "⚠ 卡住" : done ? "✓ 完成" : "○ 未执行";
        const deps = n.deps?.length ? `依赖: ${n.deps.join(", ")}` : "无依赖";
        return {
          color: "#120F17",
          label: `${n.type}`,
          title: n.name || n.id,
          description: `${status} · ${deps}`,
        };
      }),
    [nodes, outputs, graph.runningNodeId, graph.blockedNodeIds]
  );

  // deps 连线：测量卡片实际位置（grid 布局由 CSS 决定），画 SVG 贝塞尔线
  useEffect(() => {
    const draw = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const cards = wrap.querySelectorAll(".magic-bento-card");
      if (cards.length !== nodes.length) return;
      const wr = wrap.getBoundingClientRect();
      const centers = [...cards].map((c) => {
        const r = c.getBoundingClientRect();
        return { x: r.left - wr.left + r.width / 2, y: r.top - wr.top + r.height / 2 };
      });
      setEdges(
        nodes.flatMap((n, i) =>
          (n.deps ?? []).map((d) => {
            const j = nodes.findIndex((x) => x.id === d);
            if (j === -1) return null;
            return { x1: centers[j].x, y1: centers[j].y, x2: centers[i].x, y2: centers[i].y };
          })
        ).filter(Boolean) as Array<{ x1: number; y1: number; x2: number; y2: number }>
      );
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", draw);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [nodes]);

  if (nodes.length === 0) return null;

  return (
    <div ref={wrapRef} style={{ width: 760, fontSize: 14, position: "relative" }} className="magic-bento-scope">
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>节点图 · 点卡片看详情</div>
      {/* deps 连线层：指向下游（依赖 → 本节点），箭头在终点 */}
      <svg style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }} width="100%" height="100%">
        {edges.map((e, i) => {
          const mx = (e.x1 + e.x2) / 2;
          const my = (e.y1 + e.y2) / 2;
          const ang = Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
          const al = 10;
          return (
            <g key={i}>
              <path
                d={`M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`}
                fill="none" stroke="rgba(132,0,255,0.5)" strokeWidth={1.5}
              />
              <path
                d={`M ${e.x2} ${e.y2} L ${e.x2 - al * Math.cos(ang - 0.4)} ${e.y2 - al * Math.sin(ang - 0.4)} L ${e.x2 - al * Math.cos(ang + 0.4)} ${e.y2 - al * Math.sin(ang + 0.4)} Z`}
                fill="rgba(132,0,255,0.6)"
              />
            </g>
          );
        })}
      </svg>
      <MagicBento
        cardData={cards}
        textAutoHide={true}
        enableStars={true}
        enableSpotlight={true}
        enableBorderGlow={true}
        enableTilt={true}
        enableMagnetism={true}
        clickEffect={true}
        spotlightRadius={300}
        particleCount={12}
        glowColor="132, 0, 255"
        onCardClick={(i) => setSelected(nodes[i])}
      />

      {selected && createPortal(
        <div
          onClick={() => setSelected(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 60,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-panel)",
              width: 520, maxWidth: "90vw", maxHeight: "70vh", display: "flex", flexDirection: "column",
            }}
          >
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ display: "flex", color: "var(--accent)" }}><NodeIcon type={selected.type} size={16} /></span>
                {selected.type} · {selected.id} {selected.name ? `· ${selected.name}` : ""}
              </strong>
              <button onClick={() => setSelected(null)} style={{ padding: "2px 8px" }}>✕</button>
            </div>
            <div style={{ padding: "12px 14px", overflowY: "auto", fontSize: 13 }}>
              {selected.deps?.length ? <p style={{ color: "var(--text-muted)", margin: "0 0 8px" }}>依赖：{selected.deps.join(", ")}</p> : null}
              {selected.input?.length ? <p style={{ color: "var(--text-muted)", margin: "0 0 8px" }}>输入：{selected.input.join(", ")}</p> : null}
              {selected.prompt ? <p style={{ margin: "0 0 10px", whiteSpace: "pre-wrap" }}>指令：{selected.prompt}</p> : null}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>
                  产出（{selected.output ?? "无"}）{outputs.has(selected.id) ? "✓" : "未执行"}
                </div>
                {outputs.has(selected.id) ? (
                  <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    {/* 产出用 Markdown 渲染（worker 产出是 markdown 报告） */}
                    <MarkdownBody>{outputs.get(selected.id)?.output ?? ""}</MarkdownBody>
                  </div>
                ) : (
                  <p style={{ color: "var(--text-muted)", margin: 0 }}>—</p>
                )}
                {/* 产物文件预览（artifactPreview：document/image/audio） */}
                {(outputs.get(selected.id)?.artifacts ?? []).length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6 }}>产物文件（点击预览）</div>
                    {outputs.get(selected.id)!.artifacts!.map((a) => (
                      <button
                        key={a}
                        onClick={() => openFile(a)}
                        style={{ display: "block", width: "100%", textAlign: "left", fontSize: 12, padding: "4px 8px", margin: "2px 0", background: "var(--tool-bg)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", cursor: "pointer" }}
                        title={a}
                      >
                        📄 {a}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 产物文件预览弹层（artifactPreview：document/image/audio）——共享组件，宽度已加大 */}
      <ArtifactPreview preview={preview} error={previewErr} onClose={() => setPreview(null)} />
    </div>
  );
}
