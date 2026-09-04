"use client";

// preload 桥（electron/preload.js 暴露）：拖拽文件夹拿真实路径（Electron 32+ 无 File.path）
declare global {
  interface Window {
    fly?: { getPathForFile: (f: File) => string };
  }
}

// 空态：选择项目文件夹后开始对话（原 Session 的"先选文件夹再对话"流程）
import { useState } from "react";

export function ProjectPicker({ onSelect }: { onSelect: (cwd: string) => void }) {
  const [path, setPath] = useState("");
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const [recent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("v2-recent-projects") || "[]");
    } catch {
      return [];
    }
  });

  const select = (p: string) => {
    const v = p.trim();
    if (!v) return;
    const next = [v, ...recent.filter((r) => r !== v)].slice(0, 5);
    localStorage.setItem("v2-recent-projects", JSON.stringify(next));
    onSelect(v);
  };

  // 从 Finder 拖文件夹进窗口选项目路径（Electron 32+ 无 File.path，走 preload webUtils）
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const p = window.fly?.getPathForFile?.(file) || (file as unknown as { path?: string }).path || "";
    if (p) {
      setPath(p);
      select(p);
    }
  };

  return (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, minHeight: 0 }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // 拖出子元素会触发 dragleave，只有离开容器根时才收起高亮
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
        <div
          style={{
            width: 420, textAlign: "center", borderRadius: 16,
            padding: "28px 24px", transition: "background 0.15s",
            background: dragging ? "rgba(96,165,250,0.08)" : "transparent",
            border: dragging ? "1.5px dashed rgba(96,165,250,0.5)" : "1.5px dashed transparent",
          }}
        >
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em" }}>Pi Agent V2</div>
        <p style={{ color: "#fff", fontSize: 16, fontWeight: 600, margin: "10px 0 24px" }}>
          先选择项目文件夹，再开始对话 —— 会话将归档在该项目下
        </p>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => e.key === "Enter" && select(path)}
          placeholder="输入项目文件夹路径，如 ~/Desktop/pi Agent V2 或 /Users/you/project"
          style={{
            width: "100%", color: "var(--text)",
            border: `2px dashed ${focused || path ? "var(--accent)" : "var(--border)"}`,
            borderRadius: 16,
            background: focused || path ? "rgba(96,165,250,0.06)" : "transparent",
            transition: "border-color .15s, background .15s",
            padding: "13px 16px", fontSize: 13, outline: "none", textAlign: "center",
          }}
        />
        <button onClick={() => select(path)} disabled={!path.trim()} style={{ marginTop: 12, padding: "10px 36px", background: "#fff", color: "#000", fontWeight: 700, border: "none", borderRadius: 999, opacity: 1 }}>
          开始对话
        </button>
        {recent.length > 0 && (
          <div style={{ marginTop: 28, textAlign: "left" }}>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6 }}>最近项目</div>
            {recent.map((r) => (
              <button
                key={r}
                onClick={() => select(r)}
                title={r}
                style={{
                  display: "block", width: "100%", textAlign: "left", marginBottom: 4,
                  padding: "7px 12px", background: "transparent", fontSize: 12,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
