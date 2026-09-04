"use client";

// 会话侧边栏：两个可展开/收起的小标签 —— 「聊天」（默认工作区会话）+ 「项目」（项目树）
// 项目标签下：新建项目（＋）→ 项目列表 → 项目内展开/收起 session + 新建 session
// 鼠标悬停左缘弹出、移开收回（fixed 覆盖层 + translateX 过渡）
import { useState } from "react";
import type { PiSidebar, PiSessionInfo } from "@/hooks/usePiSession";
import GlareHover from "./GlareHover";

// 行统一视觉：hover 渐变 / 选中渐变 / 扫光参数（全部行共用）
const GRAD_HOVER = "linear-gradient(90deg, rgba(255,255,255,0.20), rgba(255,255,255,0.06) 70%, transparent)";
const GRAD_SELECTED = "linear-gradient(90deg, rgba(255,255,255,0.28), rgba(255,255,255,0.08) 70%, transparent)";
const GLARE_PROPS = {
  background: "transparent",
  borderRadius: "8px",
  borderColor: "transparent",
  glareColor: "#ffffff",
  glareOpacity: 0.3,
  glareAngle: -30,
  glareSize: 300,
  transitionDuration: 800,
  playOnce: true,
} as const;

// 单个会话行（聊天 / 项目内共用）：单击切换，双击改名（行内输入框，Enter/失焦提交，Esc 取消）
function SessionRow({
  s,
  active,
  onSwitch,
  onDelete,
  onRename,
}: {
  s: PiSessionInfo;
  active: boolean;
  onSwitch: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const startEdit = () => {
    setDraft(s.firstMessage || "");
    setEditing(true);
  };
  const commit = () => {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== s.firstMessage) onRename(s.id, v); // 空输入 = 取消，不改名
  };
  return (
    <GlareHover
      className="glare-session-row"
      width="100%" height="40px"
      {...GLARE_PROPS}
    >
      <div
        onClick={() => !editing && !active && onSwitch(s.path)}
        onDoubleClick={() => !editing && startEdit()}
        title={s.path}
        style={{
          position: "relative",
          display: "flex", alignItems: "center", gap: 6, flex: 1, width: "100%",
          minHeight: 40, padding: "0 10px", borderRadius: 8,
          cursor: active ? "default" : "pointer",
          background: active ? GRAD_SELECTED : "transparent",
          color: active ? "#ffffff" : "#e2e2ea",
        }}
        onMouseEnter={(e) => {
          if (!active) e.currentTarget.style.background = GRAD_HOVER;
          const del = e.currentTarget.querySelector("button");
          if (del) del.style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          if (!active) e.currentTarget.style.background = "transparent";
          const del = e.currentTarget.querySelector("button");
          if (del) del.style.opacity = "0";
        }}
      >
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") setEditing(false);
            }}
            onBlur={commit}
            style={{
              flex: 1, minWidth: 0,
              background: "rgba(255,255,255,0.07)", border: "1px solid rgba(96,165,250,0.55)", borderRadius: 6,
              padding: "2px 7px", fontSize: 13, color: "#f2f2f6", outline: "none",
            }}
          />
        ) : (
          <span style={{ flex: 1, fontSize: 13, fontWeight: 400, color: "#f2f2f6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.firstMessage || "(空会话)"}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`删除会话 ${s.firstMessage?.slice(0, 20) || ""}？`)) onDelete(s.path);
          }}
          title="删除会话（双击名称可改名）"
          style={{
            opacity: 0, flexShrink: 0, width: 22, height: 22,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "none", border: "none", padding: 0,
            color: "#8a8a96", fontSize: 15, cursor: "pointer",
            transition: "opacity 0.12s",
          }}
        >
          ✕
        </button>
      </div>
    </GlareHover>
  );
}

// 小标签头：▶/▼ + 标题（可点击展开/收起），右侧可挂按钮
function SectionHead({
  open,
  onClick,
  title,
  count,
  right,
}: {
  open: boolean;
  onClick: () => void;
  title: string;
  count?: number;
  right?: React.ReactNode;
}) {
  return (
    <GlareHover
      className="glare-session-row"
      width="100%" height="36px"
      {...GLARE_PROPS}
    >
      <div
        onClick={onClick}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          minHeight: 36, padding: "0 8px", borderRadius: 8,
          cursor: "pointer", color: "#e2e2ea", userSelect: "none",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = GRAD_HOVER)}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <span style={{ flexShrink: 0, fontSize: 10, color: "#8a8a96", width: 10 }}>{open ? "▼" : "▶"}</span>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{title}</span>
        {typeof count === "number" && <span style={{ flexShrink: 0, fontSize: 11, color: "#8a8a96", marginLeft: 4 }}>{count}</span>}
        {right && <span style={{ display: "flex", marginLeft: "auto" }}>{right}</span>}
      </div>
    </GlareHover>
  );
}

export function SessionSidebar({
  sidebar,
  activeSessionId,
  projectName,
  onSwitch,
  onDelete,
  onRename,
  onNewSession,
  onNewProject,
  onOpenCreateProject,
  onOpenSkills,
  onOpenApi,
  onOpenChange,
}: {
  sidebar: PiSidebar;
  activeSessionId: string | null;
  projectName?: string;
  onSwitch: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (id: string, name: string) => void;
  onNewSession: (cwd?: string) => void;
  onNewProject: (cwd: string, name: string) => void;
  onOpenCreateProject: () => void;
  onOpenSkills: () => void;
  onOpenApi: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const setOpenBoth = (v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
  };
  // 标签展开状态：聊天 / 项目（默认展开）
  const [chatOpen, setChatOpen] = useState(true);
  const [projOpen, setProjOpen] = useState(true);
  // 项目内 session 展开状态：含当前会话的项目默认展开；手动切换后记录
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const isExpanded = (cwd: string) =>
    expanded[cwd] ?? sidebar.projects.find((p) => p.cwd === cwd)?.sessions.some((s) => s.id === activeSessionId) ?? false;

  const emptyAll = sidebar.projects.length === 0 && sidebar.recent.length === 0;

  return (
    <div
      style={{
        position: "fixed", left: 0, top: 0, bottom: 0, zIndex: 30,
        // 收起时仅露左缘 16px 悬停触发条
        transform: open ? "translateX(0)" : "translateX(calc(-100% + 16px))",
        transition: "transform 0.28s ease",
      }}
      onMouseEnter={() => setOpenBoth(true)}
      onMouseLeave={() => setOpenBoth(false)}
    >
      <aside
        style={{
          width: 240, height: "100%", flexShrink: 0,
          background: "var(--side-bg)", /* 与 HTML demo 同款 #141414，保证白渐变观感一致 */
          borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden",
        }}
      >
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", minHeight: 0, flex: 1, width: "100%", height: "100%" }}>
          <div className="sidebar-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "28px 16px 14px 28px", display: "flex", flexDirection: "column", gap: 2 }}>
            {/* 当前项目名（原顶栏位置移入） */}
            {projectName && (
              <div style={{ fontSize: 15, fontWeight: 750, letterSpacing: "-0.02em", color: "#f2f2f6", padding: "2px 8px 10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={projectName}>
                {projectName}
              </div>
            )}
            {emptyAll && (
              <p style={{ color: "#8a8a96", fontSize: 14, textAlign: "center", padding: 24 }}>
                暂无会话
              </p>
            )}

            {/* 标签一：聊天（默认工作区会话）——右侧 ＋ 新建对话 */}
            <SectionHead
              open={chatOpen}
              onClick={() => setChatOpen((v) => !v)}
              title="聊天"
              count={sidebar.recent.length}
              right={
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNewSession();
                  }}
                  title="新建对话"
                  style={{
                    flexShrink: 0, width: 24, height: 24,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 15, background: "transparent", border: "none",
                    color: "#cfcfd8", cursor: "pointer", padding: 0,
                  }}
                >
                  ＋
                </button>
              }
            />
            {chatOpen && (
              sidebar.recent.length === 0 ? (
                <div style={{ padding: "4px 8px 8px 24px", fontSize: 12, color: "#8a8a96" }}>暂无会话</div>
              ) : (
                <div className="sidebar-scroll" style={{ maxHeight: 240 /* 6 行 × 40px，多出滚动 */, overflowY: "auto" }}>
                  {sidebar.recent.map((s) => (
                    <SessionRow key={s.path} s={s} active={s.id === activeSessionId} onSwitch={onSwitch} onDelete={onDelete} onRename={onRename} />
                  ))}
                </div>
              )
            )}

            {/* 标签二：项目（项目树 + 新建项目） */}
            <div style={{ marginTop: 8 }}>
              <SectionHead
                open={projOpen}
                onClick={() => setProjOpen((v) => !v)}
                title="项目"
                count={sidebar.projects.length}
                right={
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenCreateProject();
                    }}
                    title="新建项目"
                    style={{
                      flexShrink: 0, width: 24, height: 24,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 15, background: "transparent", border: "none",
                      color: "#cfcfd8", cursor: "pointer", padding: 0,
                    }}
                  >
                    ＋
                  </button>
                }
              />

              {/* 项目列表 */}
              {projOpen && (
                sidebar.projects.length === 0 ? (
                  <div style={{ padding: "4px 8px 8px 24px", fontSize: 12, color: "#8a8a96" }}>
                    暂无项目
                    <br />
                    <span style={{ fontSize: 11 }}>点右侧 ＋ 新建项目</span>
                  </div>
                ) : (
                  sidebar.projects.map((p) => {
                    const exp = isExpanded(p.cwd);
                    const activeInProj = p.sessions.some((s) => s.id === activeSessionId);
                    return (
                      <div key={p.cwd} style={{ marginBottom: 4 }}>
                        {/* 项目行头：点击展开/收起；＋ 新建会话（不冒泡） */}
                        <GlareHover
                          className="glare-session-row"
                          width="100%" height="36px"
                          {...GLARE_PROPS}
                        >
                        <div
                          onClick={() => setExpanded((prev) => ({ ...prev, [p.cwd]: !exp }))}
                          title={p.cwd}
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            minHeight: 36, padding: "0 8px", borderRadius: 8,
                            cursor: "pointer",
                            background: activeInProj ? GRAD_SELECTED : "transparent",
                            color: activeInProj ? "#ffffff" : "#e2e2ea",
                          }}
                          onMouseEnter={(e) => {
                            if (!activeInProj) e.currentTarget.style.background = GRAD_HOVER;
                            const n = e.currentTarget.querySelector("button");
                            if (n) n.style.opacity = "1";
                          }}
                          onMouseLeave={(e) => {
                            if (!activeInProj) e.currentTarget.style.background = "transparent";
                            const n = e.currentTarget.querySelector("button");
                            if (n) n.style.opacity = "0";
                          }}
                        >
                          <span style={{ flexShrink: 0, fontSize: 10, color: "#8a8a96", width: 10 }}>{exp ? "▼" : "▶"}</span>
                          <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: "#cfcfd9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.name}
                          </span>
                          <span style={{ flexShrink: 0, fontSize: 11, color: "#8a8a96" }}>{p.sessionCount}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onNewSession(p.cwd);
                            }}
                            title={`在「${p.name}」新建会话`}
                            style={{
                              opacity: 0, flexShrink: 0, width: 22, height: 22,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              background: "none", border: "none", padding: 0,
                              color: "#cfcfd8", fontSize: 15, cursor: "pointer", transition: "opacity 0.12s",
                            }}
                          >
                            ＋
                          </button>
                          </div>
                        </GlareHover>
                        {/* 项目路径（省略）+ 会话列表 */}
                        {exp && (
                          <>
                            <div style={{ padding: "0 8px 2px 24px", fontSize: 10.5, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.cwd}>
                              {p.cwd}
                            </div>
                            {p.sessions.length === 0 && (
                              <div style={{ padding: "4px 8px 6px 24px", fontSize: 12, color: "#8a8a96" }}>暂无会话</div>
                            )}
                            {/* 会话列表：最多显示 6 行（300px），更多在区内上滑下滑 */}
                            <div className="sidebar-scroll" style={{ maxHeight: 240 /* 6 行 × 40px，多出滚动 */, overflowY: "auto", paddingLeft: 12 }}>
                              {p.sessions.map((s) => (
                                <SessionRow key={s.path} s={s} active={s.id === activeSessionId} onSwitch={onSwitch} onDelete={onDelete} onRename={onRename} />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )
              )}
            </div>
          </div>

          {/* 底部：Skills / API 入口（左右排列） */}
          <div style={{ padding: "10px 16px 18px 28px", display: "flex", flexDirection: "row", gap: 6 }}>
            <button
              onClick={onOpenSkills}
              style={{ flex: 1, textAlign: "center", padding: "9px 10px", fontSize: 14, fontWeight: 500, background: "transparent", border: "none", borderRadius: 8, color: "#e2e2ea", cursor: "pointer" }}
            >
              🧩 Skills
            </button>
            <button
              onClick={onOpenApi}
              style={{ flex: 1, textAlign: "center", padding: "9px 10px", fontSize: 14, fontWeight: 500, background: "transparent", border: "none", borderRadius: 8, color: "#e2e2ea", cursor: "pointer" }}
            >
              🔌 API
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
