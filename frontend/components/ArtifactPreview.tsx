"use client";

// 产物文件预览弹层（artifactPreview：document/image/audio）——NodeCanvas 节点详情与顶部 Artifact 条共用
import { createPortal } from "react-dom";
import { MarkdownBody } from "./MarkdownBody";

export type ArtifactPreviewData = { path: string; kind: string; data: string; ext: string };

export function ArtifactPreview({
  preview,
  error,
  onClose,
}: {
  preview: ArtifactPreviewData | null;
  error: string;
  onClose: () => void;
}) {
  if (!preview && !error) return null; // 有错误也弹层（读取失败不再静默）
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 70,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)", borderRadius: "var(--radius-panel)", boxShadow: "0 18px 60px rgba(0,0,0,0.4)",
          width: "min(88vw, 1000px)", maxWidth: "92vw", maxHeight: "85vh", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: 12, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {preview?.path ?? "读取失败"}</strong>
          <button onClick={onClose} style={{ padding: "2px 8px" }}>✕</button>
        </div>
        <div style={{ padding: 12, overflowY: "auto", minHeight: 0 }}>
          {error && <p style={{ color: "var(--status-danger)", fontSize: 12 }}>读取失败：{error}</p>}
          {preview?.kind === "image" && (
            <img src={`data:image/${preview.ext};base64,${preview.data}`} alt={preview.path} style={{ maxWidth: "100%", borderRadius: 8 }} />
          )}
          {preview?.kind === "audio" && (
            <audio controls src={`data:audio/${preview.ext};base64,${preview.data}`} style={{ width: "100%" }} />
          )}
          {preview?.kind === "text" && (preview.ext === "md" || preview.ext === "markdown" ? (
            <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
              <MarkdownBody>{preview.data}</MarkdownBody>
            </div>
          ) : (
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 12, color: "var(--text-muted)", maxHeight: "70vh", overflowY: "auto" }}>
              {preview.data}
            </pre>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
