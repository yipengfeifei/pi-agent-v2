"use client";

// 通用快选弹窗：/model 选模型、/resume 选历史会话
// 外壳样式与 ModelsPanel 一致；职责单一 —— 列出候选 → 搜索 → 点击选择
// 设计：不在组件内做业务判断（谁可点、点了做什么由调用方决定），只负责"呈现 + 选中回调"
import { useEffect, useMemo, useRef, useState } from "react";

export type PickerItem = {
  key: string;
  label: string;
  sub?: string; // 右侧次要信息（provider 名 / 时间 / 条数）
  group?: string; // 分组标题
  badge?: string; // 右侧徽标（当前 / 未配 Key）
  active?: boolean; // 当前选中项：高亮
  dim?: boolean; // 弱化显示（仍可点，例如未配 Key 的 provider）
};

export function QuickPicker({
  title,
  hint,
  items,
  placeholder = "搜索…",
  emptyText = "无匹配项",
  onSelect,
  onClose,
}: {
  title: string;
  hint?: string;
  items: PickerItem[];
  placeholder?: string;
  emptyText?: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return items;
    return items.filter((it) =>
      `${it.label} ${it.sub ?? ""} ${it.group ?? ""}`.toLowerCase().includes(k),
    );
  }, [items, q]);

  const groups = useMemo(() => {
    const m = new Map<string, PickerItem[]>();
    for (const it of filtered) {
      const g = it.group ?? "";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(it);
    }
    return [...m.entries()];
  }, [filtered]);

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
          width: 560, maxWidth: "92vw", maxHeight: "75vh", display: "flex", flexDirection: "column",
          boxShadow: "0 18px 60px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 13 }}>
            {title}
            <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-dim)", fontWeight: 400 }}>
              {filtered.length === items.length ? `${items.length} 项` : `${filtered.length}/${items.length}`}
            </span>
          </strong>
          <button onClick={onClose} style={{ padding: "2px 8px", background: "transparent", border: "none", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "0 14px 8px" }}>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            className="focus-accent"
            style={{
              width: "100%", padding: "6px 10px", fontSize: 13, borderRadius: 8,
              border: "1px solid var(--border-subtle)", background: "transparent",
              color: "var(--text-primary)", outline: "none",
            }}
          />
          {hint && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>{hint}</div>}
        </div>

        <div style={{ overflowY: "auto", padding: "4px 8px 10px" }}>
          {filtered.length === 0 && (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 20, fontSize: 13 }}>{emptyText}</p>
          )}
          {groups.map(([g, list]) => (
            <div key={g} style={{ marginBottom: 6 }}>
              {g && (
                <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "6px 8px 4px" }}>{g}</div>
              )}
              {list.map((it) => (
                <button
                  key={it.key}
                  onClick={() => {
                    onSelect(it.key);
                    onClose();
                  }}
                  style={{
                    display: "flex", alignItems: "baseline", gap: 8, width: "100%", textAlign: "left",
                    padding: "6px 10px", borderRadius: 8, border: "none",
                    background: it.active ? "rgba(127,127,127,.16)" : "transparent",
                    color: it.dim ? "var(--text-dim)" : "var(--text-primary)",
                    cursor: "pointer", fontSize: 13,
                  }}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.label}
                  </span>
                  {it.sub && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{it.sub}</span>}
                  {it.badge && (
                    <span style={{ fontSize: 10, color: it.active ? "var(--status-success)" : "var(--text-dim)" }}>
                      {it.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
