"use client";

// 模板库面板：列出已保存的节点图模板，可载入执行 / 保存当前图为模板（目标架构 §7 决策2 模板库）
import { useState } from "react";
import type { PiTemplate } from "@/hooks/usePiSession";

function fmt(ts?: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function TemplatesPanel({
  templates,
  onSave,
  onLoad,
  onClose,
}: {
  templates: PiTemplate[];
  onSave: (title: string) => void;
  onLoad: (file: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)", borderRadius: 12, boxShadow: "0 18px 60px rgba(0,0,0,0.4)",
          width: 560, maxWidth: "92vw", maxHeight: "70vh", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>模板库（{templates.length}）</strong>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="保存当前图为模板，起个名…"
            onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) { onSave(title.trim()); setTitle(""); } }}
            className="focus-accent"
            style={{ flex: 1, maxWidth: 260, background: "rgba(0,0,0,0.35)", color: "var(--text)", padding: "6px 10px", fontSize: 12 }}
          />
          <button onClick={() => { if (title.trim()) onSave(title.trim()); setTitle(""); }} disabled={!title.trim()} style={{ fontSize: 12, padding: "4px 8px", background: "transparent", border: "none", color: title.trim() ? "var(--accent)" : "var(--text-dim)", fontWeight: 650, cursor: title.trim() ? "pointer" : "default" }}>保存</button>
          <button onClick={onClose} style={{ padding: "2px 8px", background: "transparent", border: "none" }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: 8 }}>
          {templates.length === 0 && <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 20, fontSize: 13 }}>还没有模板。先把一张跑通的图存下来。</p>}
          {templates.map((t) => (
            <div key={t.file} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, marginBottom: 4 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                <strong>{t.title}</strong>
                <span style={{ marginLeft: 8, fontSize: 10, color: "var(--text-muted)" }}>{t.nodeCount} 节点 · {fmt(t.saved)}</span>
              </div>
              <button onClick={() => onLoad(t.file)} style={{ fontSize: 11, padding: "3px 10px" }}>载入执行</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
