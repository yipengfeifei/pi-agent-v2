"use client";

// API/模型配置面板：列出可用 provider/模型 + 设 API key（AuthStorage 持久化）
// 自定义端点引导在 CustomEndpointGuide（未配置时自动弹出 / ModelsPanel 入口）
import { useState } from "react";
import type { PiModel } from "@/hooks/usePiSession";

export function ModelsPanel({
  providers,
  onSetApiKey,
  onOpenGuide,
  onClose,
}: {
  providers: PiModel[];
  onSetApiKey: (provider: string, apiKey: string) => void;
  onOpenGuide: () => void;
  onClose: () => void;
}) {
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});

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
          background: "var(--bg-panel)", borderRadius: 12,
          width: 640, maxWidth: "92vw", maxHeight: "75vh", display: "flex", flexDirection: "column",
          boxShadow: "0 18px 60px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            模型与 API（{providers.length} 个 provider）
            <button onClick={onOpenGuide} title="自定义端点引导（新增 OpenAI 兼容端点）" style={{ fontSize: 13, padding: 0, background: "transparent", border: "none", color: "var(--text-dim)", cursor: "pointer", fontWeight: 700 }}>
              ⚙
            </button>
          </strong>
          <button onClick={onClose} style={{ padding: "2px 8px", background: "transparent", border: "none" }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: 8 }}>
          {providers.length === 0 && <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 20, fontSize: 13 }}>后台未返回模型列表</p>}
          {providers.map((p) => (
            <div key={p.provider} style={{ marginBottom: 8, padding: "6px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <strong style={{ fontSize: 13 }}>{p.provider}</strong>
                <span style={{ fontSize: 10, color: p.hasAuth ? "var(--status-success)" : "var(--status-danger)" }}>
                  {p.hasAuth ? "✓ 已认证" : "未配 API Key"}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", flexWrap: "wrap", gap: "4px 12px", marginBottom: 6 }}>
                {p.models.map((m) => (
                  <span key={m.id} title={m.reasoning ? "reasoning 模型" : undefined} style={{ opacity: m.reasoning ? 1 : 0.7 }}>
                    {m.name || m.id}{m.reasoning ? "⚡" : ""}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="password"
                  value={keyDraft[p.provider] ?? ""}
                  onChange={(e) => setKeyDraft((d) => ({ ...d, [p.provider]: e.target.value }))}
                  placeholder={p.hasAuth ? "已配置，输入新 Key 可覆盖" : "粘贴 API Key"}
                  className="focus-accent"
                  style={{
                    flex: 1, background: "rgba(0,0,0,0.35)", color: "var(--text)",
                    padding: "6px 10px", fontSize: 12, borderRadius: 10,
                  }}
                />
                <button
                  onClick={() => { if (keyDraft[p.provider]) onSetApiKey(p.provider, keyDraft[p.provider]); setKeyDraft((d) => ({ ...d, [p.provider]: "" })); }}
                  disabled={!keyDraft[p.provider]}
                  style={{
                    fontSize: 12, padding: "4px 8px", background: "transparent", border: "none",
                    color: keyDraft[p.provider] ? "var(--accent)" : "var(--text-dim)",
                    cursor: keyDraft[p.provider] ? "pointer" : "default", fontWeight: 650,
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
