"use client";

// 新建项目弹窗（与 API 引导页同款设计）：虚线框拖入文件夹读路径 + BorderGlow 名称输入框
// 路径和名称齐备后回车创建；拖拽走 preload webUtils（Electron 32+ 无 File.path）
import { useState } from "react";
import { BorderGlow } from "./BorderGlow";

export function ProjectCreateModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (cwd: string, name: string) => void;
}) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const p = window.fly?.getPathForFile?.(file) || (file as unknown as { path?: string }).path || "";
    if (p) {
      setPath(p);
      setName((prev) => prev || p.split(/[\\/]/).pop() || "");
    }
  };

  const ready = path.trim() && name.trim();

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
      }}
      onClick={onClose}
    >
      {/* 整个弹窗 BorderGlow（420px 自适应高） */}
      <BorderGlow
        edgeSensitivity={20}
        backgroundColor="#242424"
        borderRadius={18}
        glowRadius={45}
        coneSpread={29}
        fillOpacity={0.5}
        style={{ width: "min(420px, calc(100vw - 36px))", height: "auto", minHeight: "min(340px, 80vh)", borderRadius: 18 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ height: "100%", display: "grid", gridTemplateRows: "1fr auto", color: "var(--text)" }}
        >
          <section style={{ overflow: "auto", padding: "6vh 26px 0", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 18 }}>
            {/* 拖拽区：标题+提示在框内，拖入后显示路径 */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDragging(false);
              }}
              onDrop={onDrop}
              style={{
                width: "min(420px, 100%)",
                border: `2px dashed ${dragging || path ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 16, padding: "40px 12px",
                display: "grid", gap: 8, justifyItems: "center",
                background: dragging || path ? "rgba(96,165,250,0.06)" : "transparent",
                transition: "border-color .15s, background .15s",
              }}
            >
              {path ? (
                <>
                  <div style={{ fontSize: 14.5, fontWeight: 650, color: "var(--accent)", wordBreak: "break-all" }}>
                    📁 {path}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>名称已自动填入（可修改）</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.08 }}>新建项目</div>
                  <div style={{ fontSize: 13, color: "var(--text-dim)" }}>把文件拖进来</div>
                </>
              )}
            </div>

            {/* 名称输入框：BorderGlow 胶囊（扁版） */}
            <BorderGlow
              edgeSensitivity={20}
              backgroundColor="#000"
              borderRadius={22}
              glowRadius={45}
              coneSpread={29}
              fillOpacity={0.5}
              style={{ width: "min(420px, 100%)", borderRadius: 22 }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready) {
                    onCreate(path.trim(), name.trim());
                    onClose();
                  }
                }}
                placeholder="项目名称（默认取文件夹名）"
                style={{
                  flex: 1, background: "transparent", color: "#e8e8e8",
                  border: "none", borderRadius: 22,
                  padding: "8px 20px", fontSize: 14.5, outline: "none",
                  minHeight: 32, fontFamily: "inherit", textAlign: "center", width: "100%",
                }}
              />
            </BorderGlow>
          </section>

          <footer style={{ padding: "8px 24px 18px", textAlign: "center" }}>
            <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
              路径和名称齐备后，按 <b style={{ color: "var(--text-muted)" }}>回车</b> 创建
            </span>
          </footer>
        </div>
      </BorderGlow>
    </div>
  );
}
