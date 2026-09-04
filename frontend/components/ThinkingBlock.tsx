"use client";

// 思考块：一行"brain 图标 + 思考 + 内容首行"（整行可点击），点击展开滚动区；无多余空白条
import { useState } from "react";

// lucide sparkles 图标（思考标记，替代原 brain）
export const BRAIN_PATHS =
  '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/>';

export function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  const lines = thinking.split("\n").map((l) => l.trim()).filter(Boolean);
  // 展示最后一句（思考完成时的结论/落点），点开看全文
  const lastLine = lines[lines.length - 1] ?? "";
  const preview = lastLine.length > 64 ? lastLine.slice(0, 64) + "…" : lastLine || "思考中…";

  return (
    <div style={{ margin: 0 }}>
      <div
        onClick={() => setOpen((v) => !v)}
        title={open ? "收起思考" : "展开完整思考"}
        style={{
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
          fontSize: 12.5, lineHeight: 1.6, userSelect: "none",
        }}
      >
        <svg
          viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="var(--text-dim)"
          strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, display: "block" }}
          dangerouslySetInnerHTML={{ __html: BRAIN_PATHS }}
        />
        <span style={{ flexShrink: 0, fontWeight: 600, color: "var(--text-dim)" }}>思考</span>
        <span
          style={{
            flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: "var(--text-muted)", minWidth: 0,
          }}
        >
          {preview}
        </span>
      </div>
      {open && (
        <div
          style={{
            marginTop: 6, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.7,
            color: "var(--text-muted)", maxHeight: 300, overflowY: "auto", whiteSpace: "pre-wrap",
            border: "1px solid var(--border)", borderRadius: 8, background: "transparent",
          }}
        >
          {thinking}
        </div>
      )}
    </div>
  );
}
