"use client";

// 产物文件预览弹层（artifactPreview：document/image/audio/html）——NodeCanvas 节点详情与顶部 Artifact 条共用
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MarkdownBody } from "./MarkdownBody";

export type ArtifactPreviewData = { path: string; kind: string; data: string; ext: string };

// 能当页面跑起来的：用沙箱 iframe 真渲染，而不是把源码丢给用户看
export const RENDERABLE_EXT = ["html", "htm", "svg"];

export function ArtifactPreview({
  preview,
  error,
  onClose,
  onDismiss,
}: {
  preview: ArtifactPreviewData | null;
  error: string;
  onClose: () => void;
  /** 读不到时提供的清理动作（从会话文件条移除）；调用方不传就不显示 */
  onDismiss?: () => void;
}) {
  // 能渲染的文件默认看渲染结果，想看源码手动切
  const [mode, setMode] = useState<"render" | "source">("render");
  const path = preview?.path;
  useEffect(() => { setMode("render"); }, [path]);
  if (!preview && !error) return null; // 有错误也弹层（读取失败不再静默）
  const renderable = !!preview && RENDERABLE_EXT.includes(preview.ext);
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
        <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 12, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview?.path ?? "读取失败"}</strong>
          {renderable && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              {(["render", "source"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    fontSize: 11, padding: "3px 10px", cursor: "pointer",
                    background: mode === m ? "var(--bg-selected)" : "transparent",
                    color: mode === m ? "var(--text)" : "var(--text-muted)",
                    border: "1px solid var(--border)", borderRadius: 999,
                  }}
                >
                  {m === "render" ? "看页面" : "看源码"}
                </button>
              ))}
            </div>
          )}
          <button onClick={onClose} style={{ padding: "2px 8px", flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ padding: 12, overflowY: "auto", minHeight: 0 }}>
          {error && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <p style={{ color: "var(--status-danger)", fontSize: 12, margin: 0 }}>读取失败：{error}</p>
              {onDismiss && (
                <button onClick={onDismiss} style={{ fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>
                  从列表移除
                </button>
              )}
            </div>
          )}
          {/* HTML / SVG：沙箱 iframe 真渲染。
              sandbox 只给 allow-scripts，**不给 allow-same-origin** ——
              否则 AI 生成的页面能读到父窗口的 localStorage/cookie。不给 allow-top-navigation
              与 allow-popups，防止它把 app 主窗口导航走或弹窗盖住界面。 */}
          {preview && renderable && mode === "render" && (
            <iframe
              title={preview.path}
              srcDoc={preview.data}
              sandbox="allow-scripts"
              style={{ width: "100%", height: "70vh", border: 0, borderRadius: 8, background: "#fff", display: "block" }}
            />
          )}
          {preview && renderable && mode === "source" && (
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 12, color: "var(--text-muted)", maxHeight: "70vh", overflowY: "auto" }}>
              {preview.data}
            </pre>
          )}
          {preview?.kind === "image" && (
            <img src={`data:image/${preview.ext};base64,${preview.data}`} alt={preview.path} style={{ maxWidth: "100%", borderRadius: 8 }} />
          )}
          {preview?.kind === "audio" && (
            <audio controls src={`data:audio/${preview.ext};base64,${preview.data}`} style={{ width: "100%" }} />
          )}
          {preview?.kind === "text" && !renderable && (preview.ext === "md" || preview.ext === "markdown" ? (
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
