"use client";

// Skill 管理面板（保留清单：Session 的 Skill）——简化版，逻辑照搬旧 SkillsConfig
import { useMemo, useState } from "react";
import type { PiSkill } from "@/hooks/usePiSession";

function sourceLabel(s: PiSkill): string {
  const scope = s.sourceInfo?.scope;
  if (scope === "user" || s.source === "user") return "global";
  if (scope === "project" || s.source === "project") return "project";
  return "path";
}

function shortenPath(p?: string): string {
  return p ? p.replace(/^\/(?:Users|home)\/[^/]+/, "~") : "";
}

export function SkillsPanel({
  skills,
  onToggle,
  onClose,
}: {
  skills: PiSkill[];
  onToggle: (name: string, disabled: boolean) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? skills.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q)) : skills;
    return [...list].sort((a, b) => Number(a.disableModelInvocation) - Number(b.disableModelInvocation) || a.name.localeCompare(b.name));
  }, [skills, query]);

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
          <strong style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            Skills（{skills.length}）
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索…"
              className="focus-accent"
              style={{
                width: 180, background: "rgba(0,0,0,0.35)", color: "var(--text)",
                borderRadius: 10, padding: "6px 10px", fontSize: 12,
              }}
            />
          </strong>
          <button onClick={onClose} style={{ padding: "2px 8px", background: "transparent", border: "none" }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: 8 }}>
          {filtered.length === 0 && <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 20, fontSize: 13 }}>无匹配 skill</p>}
          {filtered.map((s) => (
            <div
              key={s.name}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8,
                marginBottom: 4, opacity: s.disableModelInvocation ? 0.55 : 1,
              }}
            >
              <button
                onClick={() => onToggle(s.name, !s.disableModelInvocation)}
                title={s.disableModelInvocation ? "已禁用 — 点击启用" : "已启用 — 点击禁用"}
                style={{
                  flexShrink: 0, width: 38, height: 20, borderRadius: 10, border: "none", padding: 0,
                  cursor: "pointer", background: s.disableModelInvocation ? "var(--border)" : "var(--accent)",
                  position: "relative", transition: "background .18s",
                }}
              >
                <span
                  style={{
                    position: "absolute", top: 2, width: 16, height: 16, borderRadius: 8,
                    background: "#fff", transition: "left .18s",
                    left: s.disableModelInvocation ? 2 : 20,
                  }}
                />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "baseline" }}>
                  <strong>{s.name}</strong>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{sourceLabel(s)}</span>
                </div>
                {s.description && (
                  <div style={{ fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.description}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {shortenPath(s.filePath)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
