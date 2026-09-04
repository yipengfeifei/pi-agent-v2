"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePiSession, type PiEntry, type ResearchRound } from "@/hooks/usePiSession";
import Orb from "@/components/Orb";
import StarChart from "@/components/StarChart";
import { MarkdownBody } from "@/components/MarkdownBody";
import { NodeCanvas } from "@/components/NodeCanvas";
import { SkillsPanel } from "@/components/SkillsPanel";
import { CustomEndpointGuide } from "@/components/CustomEndpointGuide";
import { ModelsPanel } from "@/components/ModelsPanel";
import { TemplatesPanel } from "@/components/TemplatesPanel";
import { SessionSidebar } from "@/components/SessionSidebar";
import { ProjectPicker } from "@/components/ProjectPicker";
import { ProjectCreateModal } from "@/components/ProjectCreateModal";
import { ThinkingBlock, BRAIN_PATHS } from "@/components/ThinkingBlock";
import { BorderGlow } from "@/components/BorderGlow";
import { ArtifactPreview, type ArtifactPreviewData } from "@/components/ArtifactPreview";

export default function ChatPage() {
  const { ready, reconnecting, sessionId, sessionCwd, busy, currentTurnId, endedTurns, entries, error, graph, artifacts, skills, models, templates, sidebar, mode, prompt, steer, abort, newSession, toggleSkill, switchSession, renameSession, deleteSession, createProject, nodeStreams, researchRounds, searchSources, setApiKey, setCustomProvider, saveTemplate, loadTemplate, readArtifact, branch, runCommand } =
    usePiSession();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [openTurns, setOpenTurns] = useState<Set<number>>(new Set());
  const toggleTurn = (ti: number) =>
    setOpenTurns((prev) => {
      const next = new Set(prev);
      if (next.has(ti)) next.delete(ti);
      else next.add(ti);
      return next;
    });
  // 折叠段展开状态（key = 段内回合号 join）：段头位置固定，展开时中间信息显示在头下、回复上
  const [openSegs, setOpenSegs] = useState<Set<string>>(new Set());
  const toggleSeg = (key: string) =>
    setOpenSegs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  // 轻量计划面板：取最新一条 update_plan 活动条目（数据源 = 工具 args，与 DAG 画布零耦合）
  const latestPlanEntry = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.role === "activity" && e.toolName === "update_plan" && Array.isArray((e.args as { plan?: unknown })?.plan)) return e;
    }
    return null;
  }, [entries]);
  const [apiOpen, setApiOpen] = useState(false);
  const [apiGuideOpen, setApiGuideOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  // 侧边栏展开状态：弹开时正文让位（paddingLeft 同步）
  const [sideOpen, setSideOpen] = useState(false);
  // 顶栏展开状态：正常收起只露 16px 触发条，悬停弹出（同侧边栏模式）
  const [topOpen, setTopOpen] = useState(false);
  // 产物预览（会话级 Artifact 条点击 → readArtifact → 共享 ArtifactPreview 弹层）
  const [preview, setPreview] = useState<ArtifactPreviewData | null>(null);
  const [previewErr, setPreviewErr] = useState("");
  const openFile = async (path: string) => {
    setPreviewErr("");
    try {
      const r = await readArtifact(path);
      setPreview({ path, ...r });
    } catch (e) {
      setPreviewErr(String(e));
    }
  };
  const bottomRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // 画布面板：点击外部关闭
  useEffect(() => {
    if (!canvasOpen) return;
    const onDown = (e: MouseEvent) => {
      if (canvasRef.current && !canvasRef.current.contains(e.target as Node)) setCanvasOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [canvasOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    // 斜杠命令：前端拦截（SDK 会把 / 开头当扩展命令/模板展开，不能发给模型）
    if (text.startsWith("/")) {
      runCommand(text);
      setInput("");
      return;
    }
    prompt(text);
    setInput("");
  };

  // 拖本地文件进输入框 → 光标处插入文件路径（agent 用已有 read/bash 工具读，不碰内容）
  // Electron 32+ 无 File.path，走 preload 的 webUtils.getPathForFile（window.fly）
  const insertPathsAtCursor = (paths: string[]) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    const prefix = start > 0 && input[start - 1] !== " " && input[start - 1] !== "\n" ? " " : "";
    const next = input.slice(0, start) + prefix + paths.join(" ") + input.slice(end);
    setInput(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.length, next.length);
    });
  };

  const onDropFiles = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const paths = Array.from(e.dataTransfer.files ?? [])
      .map((f) => window.fly?.getPathForFile?.(f) || (f as unknown as { path?: string }).path || "")
      .filter(Boolean);
    if (paths.length) insertPathsAtCursor(paths);
  };

  // 未配置 API（无已认证 provider）时自动弹自定义端点引导（本次会话只弹一次）
  const apiGuideShown = useRef(false);
  useEffect(() => {
    if (apiGuideShown.current || !ready || models.length === 0) return;
    if (models.some((p) => p.hasAuth)) return; // 已配置过
    apiGuideShown.current = true;
    setApiGuideOpen(true);
  }, [ready, models]);

  // 面板（Skills/API/模板/新建项目）：无会话分支也渲染（否则刚打开 app 时点不开）
  const panels = (
    <>
      {skillsOpen && (
        <SkillsPanel skills={skills} onToggle={toggleSkill} onClose={() => setSkillsOpen(false)} />
      )}
      {apiOpen && (
        <ModelsPanel
          providers={models}
          onSetApiKey={setApiKey}
          onOpenGuide={() => {
            setApiOpen(false);
            setApiGuideOpen(true);
          }}
          onClose={() => setApiOpen(false)}
        />
      )}
      {apiGuideOpen && (
        <CustomEndpointGuide onSetCustomProvider={setCustomProvider} onClose={() => setApiGuideOpen(false)} />
      )}
      {templatesOpen && (
        <TemplatesPanel templates={templates} onSave={saveTemplate} onLoad={loadTemplate} onClose={() => setTemplatesOpen(false)} />
      )}
      {createProjectOpen && (
        <ProjectCreateModal
          onClose={() => setCreateProjectOpen(false)}
          onCreate={(cwd, name) => {
            createProject(cwd, name);
            setCreateProjectOpen(false);
          }}
        />
      )}
    </>
  );

  // 未选项目：先选文件夹再对话（原 Session 流程）
  if (!sessionCwd) {
    return (
      <div style={{ display: "flex", height: "100vh", position: "relative", zIndex: 1, paddingLeft: sideOpen ? 240 : 16, transition: "padding-left 0.28s ease" }}>
        {/* 能量球：居中，半尺寸（960×720），忙碌时发力 */}
        <Orb
          intensity={busy ? 1 : 0}
          style={{
            position: "fixed", left: "50%", top: "50%",
            width: 960, height: 720, zIndex: 0, pointerEvents: "none",
            transform: "translate(-50%, -50%)",
          }}
        />
        <SessionSidebar
          sidebar={sidebar}
          activeSessionId={null}
          onSwitch={() => {}}
          onDelete={() => {}}
          onRename={() => {}}
          onNewSession={() => {}}
          onNewProject={createProject}
          onOpenCreateProject={() => setCreateProjectOpen(true)}
          onOpenSkills={() => setSkillsOpen(true)}
          onOpenApi={() => setApiOpen(true)}
          onOpenChange={setSideOpen}
        />
        <ProjectPicker onSelect={(cwd) => newSession("normal", cwd)} />
        {panels}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", position: "relative", zIndex: 1 }}>
      {/* 能量球：发第一条消息前居中显示（与选文件夹页一致），开始对话后消失 */}
      {entries.length === 0 ? (
        <Orb
          intensity={busy ? 1 : 0}
          style={{
            position: "fixed", left: "50%", top: "50%",
            width: 960, height: 720, zIndex: 0, pointerEvents: "none",
            transform: "translate(-50%, -50%)",
          }}
        />
      ) : (
        /* 正式对话：星空背景（88 真实星座 + 519 星，鼠标靠近点亮） */
        <StarChart zIndex={0} />
      )}
      <SessionSidebar
        sidebar={sidebar}
        activeSessionId={sessionId ?? null}
        projectName={sessionCwd.split("/").pop() || sessionCwd}
        onSwitch={switchSession}
        onDelete={deleteSession}
        onRename={renameSession}
        onNewSession={(cwd) => newSession(undefined, cwd ?? sessionCwd ?? undefined)}
        onNewProject={createProject}
        onOpenCreateProject={() => setCreateProjectOpen(true)}
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenApi={() => setApiOpen(true)}
        onOpenChange={setSideOpen}
      />

      {/* 顶栏按钮组（无横条）：悬停顶部右上角滑出——Artifact/画布/模板/模式 */}
      <div
        style={{
          position: "fixed", top: 0, left: sideOpen ? 240 : 0, right: 0, zIndex: 20,
          transform: topOpen ? "translateY(0)" : "translateY(calc(-100% + 16px))",
          transition: "transform 0.28s ease, left 0.28s ease",
        }}
        onMouseEnter={() => setTopOpen(true)}
        onMouseLeave={() => setTopOpen(false)}
      >
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", justifyContent: "flex-end" }}>
          {/* Artifact 会话级入口：始终显示，不依赖画布/产物数量（产物数据源缺口见上方注释） */}
          <button
            onClick={() => setArtifactsOpen((v) => !v)}
            title="Artifacts"
            style={{
              fontSize: 12, padding: "5px 10px", background: "transparent", border: "none", borderRadius: 8,
              ...(artifactsOpen ? { background: "linear-gradient(90deg, rgba(255,255,255,0.28), rgba(255,255,255,0.08) 70%, transparent)", color: "#fff" } : {}),
            }}
          >
            Artifacts{artifacts.length > 0 ? ` (${artifacts.length})` : ""}
          </button>
          {graph.graph && (
            <div ref={canvasRef} style={{ position: "relative" }}>
              <button
                onClick={() => setCanvasOpen((v) => !v)}
                title="节点图画布"
                style={{
                  fontSize: 12, padding: "5px 10px", background: "transparent", border: "none", borderRadius: 8,
                  ...(canvasOpen ? { background: "linear-gradient(90deg, rgba(255,255,255,0.28), rgba(255,255,255,0.08) 70%, transparent)", color: "#fff" } : {}),
                }}
              >
                {canvasOpen ? "收起画布" : `画布 (${graph.graph.nodes?.length ?? 0})`}
              </button>
              {canvasOpen && (
                <div
                  style={{
                    position: "absolute", top: "100%", right: 0, marginTop: 6, zIndex: 40,
                    background: "var(--bg-panel)",
                    borderRadius: "var(--radius-panel)", padding: 12,
                    boxShadow: "0 18px 40px rgba(0,0,0,0.4)",
                    maxHeight: "80vh", overflowY: "auto", /* 8/12 节点时画布可滚动 */
                  }}
                >
                  <NodeCanvas graph={graph} readArtifact={readArtifact} />
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => setTemplatesOpen((v) => !v)}
            title="模板库：保存/载入已跑通节点图"
            style={{
              fontSize: 12, padding: "5px 10px", background: "transparent", border: "none", borderRadius: 8,
              ...(templatesOpen ? { background: "linear-gradient(90deg, rgba(255,255,255,0.28), rgba(255,255,255,0.08) 70%, transparent)", color: "#fff" } : {}),
            }}
          >
            模板
          </button>
          <button
            onClick={() => newSession(mode !== "normal" ? "normal" : "simple-pro")}
            title="正常模式（全量注入 AGENTS/skills/ponytail）"
            style={{
              fontSize: 12, padding: "5px 10px", background: "transparent", border: "none", borderRadius: 8,
              ...(mode === "normal" ? { background: "linear-gradient(90deg, rgba(255,255,255,0.28), rgba(255,255,255,0.08) 70%, transparent)", color: "#fff" } : {}),
            }}
          >
            正常
          </button>
          <button
            onClick={() => newSession("simple-pro")}
            title="简单模式 · V4 Pro（RL 句 + We need 定式 + 首轮工具锚定）"
            style={{
              fontSize: 12, padding: "5px 10px", background: "transparent", border: "none", borderRadius: 8,
              ...((mode === "simple-pro" || mode === "simple") ? { background: "linear-gradient(90deg, rgba(255,255,255,0.28), rgba(255,255,255,0.08) 70%, transparent)", color: "#fff" } : {}),
            }}
          >
            简单·Pro
          </button>
          <button
            onClick={() => newSession("simple-flash")}
            title="简单模式 · V4 Flash（neutral + 任务分类 + 防 rumination 锚 + 首轮工具锚定）"
            style={{
              fontSize: 12, padding: "5px 10px", background: "transparent", border: "none", borderRadius: 8,
              ...(mode === "simple-flash" ? { background: "linear-gradient(90deg, rgba(255,255,255,0.28), rgba(255,255,255,0.08) 70%, transparent)", color: "#fff" } : {}),
            }}
          >
            简单·Flash
          </button>
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, position: "relative", paddingLeft: sideOpen ? 240 : 16, paddingTop: topOpen ? 50 : 16, overflow: "hidden", transition: "padding-left 0.28s ease, padding-top 0.28s ease" }}>

        {/* Artifact 条（顶部产物栏）：绝对定位在顶栏条下方（top 48 > 顶栏展开高度 47），永不遮挡、不挤正文 */}
        {artifactsOpen && (
          <div style={{ position: "absolute", top: 48, left: 20, right: 20, zIndex: 15, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {artifacts.length > 0 ? (
              artifacts.map((a) => (
                <button
                  key={a}
                  onClick={() => openFile(a)}
                  style={{
                    fontSize: 12, padding: "8px 16px",
                    background: "#000", color: "#e8e8e8",
                    border: "none", borderRadius: 999, cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                    boxShadow: "0 2px 8px rgba(0,0,0,.35), 0 8px 24px rgba(0,0,0,.25)",
                  }}
                  title={a}
                >
                  📄 {a.split("/").pop()}
                </button>
              ))
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>暂无产物文件</p>
            )}
          </div>
        )}

        <main style={{ flex: 1, overflowY: "auto", padding: "28px 0 108px", background: "transparent" }}>
          {latestPlanEntry && <PlanChecklist entry={latestPlanEntry} />}
          {entries.length === 0 && (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#fff" }}>
              <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em" }}>
                Pi Agent V2
              </div>
              <p style={{ fontSize: 16, fontWeight: 600, marginTop: 10 }}>发送一条消息开始 —— 规划、执行、交付，都在对话里。</p>
            </div>
          )}
          {renderTurns(entries, endedTurns, busy, nodeStreams, researchRounds, searchSources, openSegs, toggleSeg, branch)}
          <div ref={bottomRef} />
        </main>

        {/* 输入区：fixed 贴窗口底，不占布局（消息区不压缩）；黑条 42px 在输入框上方 */}
        <footer style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 10, padding: "42px 20px 12px", background: "transparent" }}>
  {reconnecting && (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)", margin: "0 0 8px" }}>
      <svg
        viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor"
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
        style={{ flexShrink: 0, display: "block", animation: "spin 1.2s linear infinite" }}
      >
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
      </svg>
      <span>自动重连</span>
    </div>
  )}
          {error && (
            <p style={{ color: "var(--status-danger)", margin: "0 0 8px", fontSize: 12 }}>错误：{error}</p>
          )}
          <div style={{ display: "flex", gap: 10, maxWidth: 780, margin: "0 auto", alignItems: "flex-end" }}>
            <BorderGlow
              className="border-glow-input"
              edgeSensitivity={20}
              backgroundColor="#000"
              borderRadius={34}
              glowRadius={45}
              coneSpread={29}
              fillOpacity={0.5}
              style={{
                flex: 1,
                borderRadius: 34,
                // 拖文件进输入框时蓝框提示（其余时间保持原阴影）
                boxShadow: dragOver
                  ? "0 0 0 2px rgba(96,165,250,0.55)"
                  : "0 2px 8px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.25)",
                transition: "box-shadow 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDropFiles}
              onKeyDown={(e) => {
                // 输入法上屏中（中文拼音等）：Enter 是确认键，不触发发送
                if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.shiftKey && !busy) return; // 空闲时 Shift+Enter = 换行
                e.preventDefault();
                const text = input.trim();
                if (!text) return;
                if (text.startsWith("/")) { runCommand(text); setInput(""); return; } // 斜杠命令前端拦截
                if (busy) steer(text); // busy：直接回车 = Steer 插入
                else prompt(text);
                setInput("");
              }}
              placeholder={busy ? "Shift+Enter 插话" : "输入消息，Enter 发送（/help 查看命令）"}
              rows={1}
              style={{
                flex: 1, background: "transparent", color: "#e8e8e8",
                border: "none", borderRadius: 32,
                padding: "12px 22px", fontSize: 15, outline: "none", resize: "none",
                minHeight: 52, maxHeight: 300, lineHeight: 1.5,
              }}
            />
              {/* 发送/暂停/Steer：纯文字，合在输入框内（无按钮样式） */}
              {busy ? (
                <>
                  <span
                    onClick={abort}
                    title="停止生成"
                    style={{ padding: "0 14px 0 6px", fontSize: 13, fontWeight: 650, color: "var(--status-danger)", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                  >
                    暂停
                  </span>
                  <span
                    onClick={() => {
                      const t = input.trim();
                      if (!t) return;
                      steer(t);
                      setInput("");
                    }}
                    title="插入指令，继续生成（同 Shift+Enter）"
                    style={{ padding: "0 20px 0 0", fontSize: 13, fontWeight: 650, color: "var(--text-dim)", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                  >
                    Steer 插入
                  </span>
                </>
              ) : (
                <span
                  onClick={submit}
                  title="发送（同 Enter）"
                  style={{
                    padding: "0 20px 0 6px", fontSize: 13, fontWeight: 650,
                    color: input.trim() && ready ? "var(--accent)" : "var(--text-dim)",
                    cursor: input.trim() && ready ? "pointer" : "default",
                    whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  发送
                </span>
              )}
            </div>
            </BorderGlow>
          </div>
        </footer>
      </div>

      {panels}

      {/* 产物预览弹层（会话级 Artifact 条与画布节点详情共用） */}
      <ArtifactPreview preview={preview} error={previewErr} onClose={() => setPreview(null)} />

    </div>
  );
}

// ---- lucide 工具图标（内联自 icons/*.svg，lucide ISC）----
const TOOL_ICONS: Record<string, string> = {
  read: '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2 5 5 0 0 1 4-2z"/>',
  write: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
  bash: '<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>',
  grep: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/>',
  find: '<path d="M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1"/><path d="m21 21-1.9-1.9"/><circle cx="17" cy="17" r="3"/>',
  ls: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  browser: '<path d="M14 4.1 12 6"/><path d="m5.1 8-2.9-.8"/><path d="m6 12-1.9 2"/><path d="M7.2 2.2 8 5.1"/><path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z"/>',
  parallel: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  python: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  http_request: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  execution_app_snapshot: '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
  node: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  plan: '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><rect x="3" y="4" width="6" height="6" rx="1"/>',
  update_plan: '<path d="m3 17 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  worker: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  research: '<path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/>',
  subagent: '<circle cx="10" cy="7" r="4"/><path d="M10.3 15H7a4 4 0 0 0-4 4v2"/><circle cx="17" cy="17" r="3"/><path d="m21 21-1.9-1.9"/>',
  site_memory: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  wait_for: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M6.38 18.7 4 21"/><path d="M17.64 18.67 20 21"/>',
  run_status: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  compaction: '<path d="m15 15 6 6m-6-6v4.8m0-4.8h4.8"/><path d="M9 19.8V15m0 0H4.2M9 15l-6 6"/><path d="M15 4.2V9m0 0h4.8M15 9l6-6"/><path d="M9 4.2V9m0 0H4.2M9 9 3 3"/>',
  artifact: '<path d="M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M8 12v-1"/><path d="M8 18v-2"/><path d="M8 7V6"/><circle cx="8" cy="20" r="2"/>',
};

// 按 agent 回合（turnId）分组渲染：回合中信息流直出；回合结束（最终输出已在最后）整轮折叠
// history 条目（无 turnId）不折叠直接展示；1 步回合不折叠；折叠头为淡灰小字"N 个步骤"
// 段式折叠：段 = 连续"模型自然结束"（agent_end）的回合
// 段渲染（demo 设计，位置固定）：[提问] → [N 个步骤头] → [折叠体（展开时）] → [每个自然结束回合的回复]
function renderTurns(entries: PiEntry[], endedTurns: ReadonlySet<number>, busy: boolean, nodeStreams: Record<string, string> | undefined, researchRounds: Record<string, ResearchRound[]> | undefined, searchSources: Record<string, Array<{ title: string; url: string }>> | undefined, openSegs: Set<string>, toggleSeg: (key: string) => void, onBranch: (entryId: string) => void) {
  const turns: PiEntry[][] = [];
  for (const e of entries) {
    if (e.turnId === undefined) { turns.push([e]); continue; }
    const last = turns[turns.length - 1];
    if (last && last.length > 0 && last[0]?.turnId === e.turnId) last.push(e);
    else turns.push([e]);
  }
  const stepCountOf = (turn: PiEntry[]) => turn.filter((e) => e.role === "activity" || e.thinking).length;
  // 已结束 = agent_end 显式标记（history 负回合恒已结束）；running/当前回合 → 直出
  const isEnded = (turn: PiEntry[]) => {
    const turnId = turn[0]?.turnId;
    if (turnId === undefined) return false;
    return turnId < 0 || endedTurns.has(turnId);
  };
  // 段辅助：段内第一个 user 消息（段起点提问）；每回合最后一个 assistant 正文（该回合自然结束的回复）
  const segFirstUser = (segs: PiEntry[][]) => {
    for (const t of segs) for (const e of t) if (e.role === "user") return e;
    return null;
  };
  const lastAsstOf = (turn: PiEntry[]) => {
    for (let j = turn.length - 1; j >= 0; j--) if (turn[j].role === "assistant" && turn[j].text.trim()) return turn[j];
    return null;
  };
  // 统一条目渲染（展开态/折叠体/段提问/回复共用同一排版，避免样式错开）
  const entryRowEl = (entry: PiEntry, gap = 2) => {
    if (entry.role === "activity") {
      return <ActivityRow key={entry.id} entry={entry} busy={busy} nodeStreams={nodeStreams} researchRounds={researchRounds} searchSources={searchSources} />;
    }
    return (
      <div key={entry.id} style={{ display: "flex", maxWidth: 820, margin: `${gap}px auto 2px`, padding: "0 20px", justifyContent: entry.role === "user" ? "flex-end" : "flex-start" }}>
        <div style={{ flex: entry.role === "user" ? "0 1 auto" : 1, minWidth: 0, maxWidth: entry.role === "user" ? "78%" : "100%" }}>
          {entry.role === "user" && entry.entryId && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 2 }}>
              <button
                onClick={() => onBranch(entry.entryId!)}
                title="从这里分支：复制本消息前的对话为独立会话"
                style={{ fontSize: 11, padding: "2px 8px", background: "transparent", border: "none", borderRadius: 6, color: "var(--text-dim)", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-dim)")}
              >
                ↳ 分支
              </button>
            </div>
          )}
          {entry.role === "assistant" && entry.thinking && (
            <ThinkingBlock thinking={entry.thinking} />
          )}
          <div>
            {entry.role === "assistant" ? (
              entry.text.startsWith("plan 结果：") ? (
                <PlanResultBlock text={entry.text} />
              ) : (
                <MarkdownBody isStreaming={busy && !entry.text.trim().endsWith("\n\n")}>
                  {entry.text}
                </MarkdownBody>
              )
            ) : (
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", textAlign: "left" }}>{entry.text}</div>
            )}
          </div>
        </div>
      </div>
    );
  };
  const out: React.ReactNode[] = [];
  let turnIdx = 0;
  // 段 = 单个"模型自然结束"的回合：自己的提问 + N 步骤 + 自己的回复（不跨回合合并，避免吞掉中间提问）
  const renderSeg = (segs: PiEntry[][]) => {
    const key = segs.map((t) => t[0]!.turnId!).join(":");
    const expanded = openSegs.has(key);
    const firstUser = segFirstUser(segs); // 本回合第一个 user 消息（你发的，始终显示）
    const replies = segs.map((t) => lastAsstOf(t)).filter((x): x is PiEntry => !!x);
    const replyIds = new Set(replies.map((r) => r.id));
    // 折叠体：回合内除提问与回复外的中间内容（插话/工具/思考/中间信息）
    const body = segs.flat().filter((e) => e !== firstUser && !replyIds.has(e.id));
    const steps = segs.reduce((n, t) => n + stepCountOf(t), 0);
    return (
      <div key={`fold:${key}`}>
        {firstUser && entryRowEl(firstUser)}
        {steps > 0 && (
          <div style={{ display: "flex", maxWidth: 820, margin: "8px auto 2px", padding: "0 20px" }}>
            <span
              onClick={() => toggleSeg(key)}
              title={expanded ? "收起中间过程" : "展开中间过程"}
              style={{ cursor: "pointer", fontSize: 12, color: "var(--text-dim)", userSelect: "none" }}
            >
              {expanded ? "收起 · " : ""}{steps} 个步骤 {expanded ? "▲" : "▼"}
            </span>
          </div>
        )}
        {expanded && body.map((e) => entryRowEl(e))}
        {replies.map((r) => entryRowEl(r))}
      </div>
    );
  };
  for (const turn of turns) {
    if (isEnded(turn)) {
      out.push(renderSeg([turn]));
      continue;
    }
    const turnId = turn[0]?.turnId;
    {
      // 展开态：并行组（同一回合内连续的工具活动条目归为一组：左蓝线 + "并行 N 个调用"标签）
      const groups: PiEntry[][] = [];
      let buf: PiEntry[] = [];
      for (const e of turn) {
        if (e.role === "activity") buf.push(e);
        else {
          if (buf.length) { groups.push(buf); buf = []; }
          groups.push([e]);
        }
      }
      if (buf.length) groups.push(buf);
      out.push(
        <div key={turnId !== undefined ? `turn:${turnId}` : `hist:${turnIdx}`}>
          {groups.map((grp, gi) => {
            // 并行组：多个连续工具活动 → 按类型合并（搜索父级分组 / 浏览器一行 / 混合每行）
            if (grp.length > 1 && grp[0].role === "activity") {
              return (
                <ParallelGroup key={`pg:${gi}`} items={grp} busy={busy} nodeStreams={nodeStreams} researchRounds={researchRounds} searchSources={searchSources} />
              );
            }
            return grp.map((entry, idx) => {
              const prev = grp[idx - 1];
              const gap = prev && prev.role !== entry.role && prev.role !== "activity" ? 14 : 2;
              return entryRowEl(entry, gap);
            });
          })}
        </div>
      );
    }
    turnIdx++;
  }
  return out;
}

// 轻量计划面板：Codex 式清单（□/▶/✔），固定在会话上方；只读活动条目的工具 args，与 DAG 完全独立
function PlanChecklist({ entry }: { entry: PiEntry }) {
  const args = (entry.args ?? {}) as { explanation?: string; plan?: Array<{ step: string; status?: string }> };
  const plan = args.plan ?? [];
  if (plan.length === 0) return null;
  const icons: Record<string, string> = { pending: "○", in_progress: "▶", completed: "✔" };
  return (
    <div style={{ maxWidth: 820, margin: "0 auto 14px", padding: "10px 20px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-panel)", fontSize: 13 }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6, display: "flex", gap: 6 }}>
        <span>计划</span>
        {args.explanation ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {args.explanation}</span> : null}
      </div>
      {plan.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", lineHeight: 1.6, ...(p.status === "completed" ? { color: "var(--text-dim)", textDecoration: "line-through" } : {}) }}>
          <span style={{ flexShrink: 0, color: p.status === "in_progress" ? "var(--accent)" : "inherit" }}>{icons[p.status ?? "pending"] ?? "○"}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.step}</span>
        </div>
      ))}
    </div>
  );
}

// plan 结果消息：默认折叠成一行摘要，点击展开完整 JSON（用户不该默认看到一坨 JSON）
function PlanResultBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const json = text.replace(/^plan 结果：\s*/, "").replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();
  let summary = "plan 结果";
  try {
    const p = JSON.parse(json);
    if (p.nodes) summary = `已拆解任务：${p.nodes.length} 个节点`;
    else if (p.direct) summary = "任务可直接执行";
    else if (p.reply) summary = p.reply;
    else if (p.question) summary = `需澄清：${p.question}`;
  } catch { /* 非 JSON（流式中），展示原文 */ }
  return (
    <div onClick={() => setOpen((v) => !v)} style={{ cursor: "pointer" }}>
      <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
        {summary}
        <span style={{ marginLeft: 6 }}>{open ? "▲" : "▼"}</span>
      </span>
      {open && (
        <pre style={{ marginTop: 8, maxHeight: 320, overflow: "auto", fontSize: 12, lineHeight: 1.5, background: "transparent", padding: 10, borderRadius: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {json}
        </pre>
      )}
    </div>
  );
}

function ToolIcon({ toolName, size = 15, color = "var(--text-dim)" }: { toolName?: string; size?: number; color?: string }) {
  const body = (toolName && TOOL_ICONS[toolName]) || TOOL_ICONS.bash;
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block" }}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}

// 打字机：文字逐字出现 → 逐字消失（循环），running 时用
function useTypewriter(text: string, active: boolean, speed = 130) {
  const [n, setN] = useState(0);
  const dirRef = useRef(1);
  useEffect(() => {
    if (!active || !text) return;
    dirRef.current = 1;
    setN(0);
    const t = setInterval(() => {
      setN((prev) => {
        if (prev >= text.length) { dirRef.current = -1; return Math.max(0, text.length - 1); }
        if (prev <= 0) { dirRef.current = 1; return 1; }
        return prev + dirRef.current;
      });
    }, speed);
    return () => clearInterval(t);
  }, [active, text, speed]);
  return text.slice(0, n);
}

// 并行组：全搜索 → 合并父级行"搜索：xxx · N 个网页"（点开小标题分组）；全浏览器 → "浏览器操作 · N 个页面"（点开 favicon+URL）；混合 → 每行独立
function ParallelGroup({ items, busy, nodeStreams, researchRounds, searchSources }: { items: PiEntry[]; busy: boolean; nodeStreams?: Record<string, string>; researchRounds?: Record<string, ResearchRound[]>; searchSources?: Record<string, Array<{ title: string; url: string }>> }) {
  const [open, setOpen] = useState(false);
  // 虚拟类型参与判断：bash -c "ego-browser" 本质是浏览器操作（classifyBash 已识别 virtualTool）
  const vt = (e: PiEntry) => e.virtualTool ?? e.toolName ?? "";
  const allSearch = items.length > 0 && items.every((e) => vt(e) === "search");
  const allBrowser = items.length > 0 && items.every((e) => vt(e) === "browser");
  const toolCallId = (e: PiEntry) => e.id.startsWith("tool:") ? e.id.slice(5) : e.id;
  // 组头文字
  let head = `并行 ${items.length} 个调用`;
  if (allSearch) {
    const firstQ = String((items[0]?.args as any)?.query ?? "").slice(0, 30);
    const total = items.reduce((n, e) => n + (searchSources?.[toolCallId(e)]?.length ?? 0), 0);
    head = `搜索：${firstQ}${items.length > 1 ? ` +${items.length - 1}` : ""} · ${total} 个网页`;
  } else if (allBrowser) {
    head = `浏览器操作 · ${items.length} 个页面`;
  }
  const done = items.filter((e) => e.status !== "running").length;
  const allDone = done === items.length;
  return (
    <div style={{ maxWidth: 820, margin: "4px auto 2px", padding: "0 20px" }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, minHeight: 24, color: "var(--text-muted)" }}
      >
        <ToolIcon toolName="parallel" />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{head}</span>
      </div>
      {open && (
        <div style={{ marginTop: 2 }}>
          <div
            onClick={() => setOpen(false)}
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none", fontSize: 11, color: "var(--text-dim)", padding: "2px 4px" }}
          >
            收起
          </div>
          {allSearch ? (
            // 全搜索：按子搜索词分组（小标题 + 3 条滚动）
            items.map((e) => {
              const q = String((e.args as any)?.query ?? "");
              const sources = searchSources?.[toolCallId(e)] ?? [];
              if (!sources.length) return null;
              return (
                <div key={e.id}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "var(--dim)", padding: "2px 8px 0", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 9, color: "var(--border)" }}>▾</span>{q}
                  </div>
                  <SearchResults sources={sources} />
                </div>
              );
            })
          ) : allBrowser ? (
            // 全浏览器：favicon + URL 列表（无状态词）
            <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "2px 2px 6px" }}>
              {items.map((e) => {
                const url = String((e.args as any)?.url ?? "");
                let host = "";
                try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
                const fav = host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : "";
                return (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 8px", borderRadius: 6 }}>
                    <span style={{ width: 15, height: 15, borderRadius: 3, position: "relative", overflow: "hidden", flexShrink: 0, background: "linear-gradient(135deg,#3b82f6,#60a5fa)", color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {host?.[0]?.toUpperCase() ?? "?"}
                      {fav && <img src={fav} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{host || url}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            // 混合：每行独立 ActivityRow
            <div style={{ borderLeft: "2px solid rgba(96,165,250,.25)", paddingLeft: 10 }}>
              {items.map((entry) => (
                <ActivityRow key={entry.id} entry={entry} busy={busy} nodeStreams={nodeStreams} researchRounds={researchRounds} searchSources={searchSources} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 搜索展开：网页列表（favicon + 标题 · 域名），交错浮现 120ms/条，默认只显示 3 条 + 区域内滚动
function SearchResults({ sources }: { sources: Array<{ title: string; url: string }> }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const timers = sources.map((_, i) => setTimeout(() => setShown(i + 1), i * 120));
    return () => timers.forEach(clearTimeout);
  }, [sources]);
  return (
    <div style={{ maxHeight: 96, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent", display: "flex", flexDirection: "column", gap: 2, padding: "2px 2px 6px" }}>
      {sources.slice(0, shown).map((s, i) => {
        let host = "";
        try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch {}
        const fav = host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : "";
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, minHeight: 28, maxWidth: "100%", transition: "opacity .3s ease, transform .3s ease" }}>
            <span style={{ width: 15, height: 15, borderRadius: 3, position: "relative", overflow: "hidden", flexShrink: 0, background: "linear-gradient(135deg,#3b82f6,#60a5fa)", color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {host?.[0]?.toUpperCase() ?? "?"}
              {fav && <img src={fav} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
            </span>
            <span style={{ fontSize: 12.5, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {s.title} <span style={{ color: "var(--dim)", fontWeight: 400, fontSize: 11 }}>· {host}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// 活动条目行：lucide 工具图标 + 纯文字（running 打字机）；带 args 的（plan/node 等）点击文字展开
function ActivityRow({ entry, busy, nodeStreams, researchRounds, searchSources }: { entry: PiEntry; busy: boolean; nodeStreams?: Record<string, string>; researchRounds?: Record<string, ResearchRound[]>; searchSources?: Record<string, Array<{ title: string; url: string }>> }) {
  const [open, setOpen] = useState(false);
  const isNode = entry.toolName === "node";
  // bash 也有实时输出流（bash_progress 事件 → nodeStreams）
  const hasStream = isNode || entry.toolName === "research" || entry.toolName === "subagent" || entry.toolName === "bash";
  // 可展开：节点/研究/取证（信息流）、search（网页列表）、plan/browser（参数/URL）
  const expandable = hasStream || entry.toolName === "search" || entry.toolName === "plan" || entry.toolName === "browser" || entry.args !== undefined;
  const running = entry.status === "running" && busy;
  const clickable = expandable;
  const color = entry.status === "error" ? "var(--status-danger)" : "var(--text-muted)";
  const tw = useTypewriter(entry.text, running);
  // 节点心跳流：key=`${runId}:${nodeId}`（node 条目 id 形如 "node:n2"）
  const streamKey = `${entry.runId ?? ""}:${entry.id.startsWith("node:") ? entry.id.slice(5) : entry.id}`;
  const stream = nodeStreams?.[streamKey] ?? "";
  return (
    <div style={{ display: "flex", maxWidth: 820, margin: "0 auto 3px", padding: "0 20px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, minHeight: 24 }}>
          <ToolIcon toolName={entry.virtualTool ?? entry.toolName} color={color} />
          <span
            onClick={clickable ? () => setOpen((v) => !v) : undefined}
            style={{
              flex: 1, minWidth: 0, cursor: clickable ? "pointer" : "default", color,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {running ? tw : entry.text}
          </span>
        </div>
        {open && hasStream && (stream || entry.status === "running") && (
          <div style={{ marginTop: 6, border: "1px solid var(--border)", borderRadius: 6, background: "transparent", overflow: "hidden" }}>
            <pre
              style={{
                margin: 0, padding: "8px 10px", fontSize: 11.5, lineHeight: 1.6,
                color: "var(--text-muted)", maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap",
                fontFamily: "var(--font-mono)",
              }}
            >
              {stream || "运行中，等待输出…"}
            </pre>
            {entry.status === "running" && (
              <div style={{ fontSize: 10, color: "var(--text-dim)", padding: "3px 10px", borderTop: "1px solid var(--border)" }}>
                ● 运行中（实时心跳）
              </div>
            )}
          </div>
        )}
        {/* search：展开 = 网页列表（favicon + 标题 · 域名，交错浮现） */}
        {open && entry.toolName === "search" && (() => {
          const toolCallId = entry.id.startsWith("tool:") ? entry.id.slice(5) : entry.id;
          const sources = searchSources?.[toolCallId] ?? [];
          if (!sources.length) return null;
          return <SearchResults sources={sources} />;
        })()}
        {/* research：展开区按轮次分区（徽章 + 标题 + 耗时 + MarkdownBody 产出 + 折叠信息流） */}
        {open && entry.toolName === "research" && (() => {
          const rounds = researchRounds?.[entry.id] ?? [];
          if (!rounds.length) return null;
          return (
            <div style={{ marginTop: 6, border: "1px solid var(--border)", borderRadius: 6, background: "transparent", overflow: "hidden" }}>
              {rounds.map((r) => {
                const rKey = `${entry.id}:r${r.round}`;
                const rStream = nodeStreams?.[rKey] ?? "";
                const done = r.status === "done" || entry.status !== "running";
                return (
                  <div key={r.round} style={{ borderBottom: "1px solid var(--border)", padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 4, background: done ? "rgba(52,211,153,.12)" : "rgba(96,165,250,.12)", color: done ? "var(--green)" : "var(--accent)" }}>
                        {done ? "✓" : "●"}
                      </span>
                      <span style={{ fontSize: 11.5, fontWeight: 600 }}>第 {r.round} 轮 · {r.phase || ""}</span>
                      <span style={{ fontSize: 10.5, color: "var(--dim)", marginLeft: "auto" }}>{done ? (r.elapsed ? `${r.elapsed}s` : "完成") : "进行中…"}</span>
                    </div>
                    {done && r.summary && (
                      <div style={{ fontSize: 11.5, color: "var(--text)", margin: "2px 0 6px", lineHeight: 1.6 }}>
                        <MarkdownBody>{r.summary}</MarkdownBody>
                      </div>
                    )}
                    {rStream && (
                      <details style={{ fontSize: 10.5 }}>
                        <summary style={{ cursor: "pointer", color: "var(--dim)" }}>过程记录（{rStream.length} 字符）</summary>
                        <pre style={{ margin: "4px 0 0", fontFamily: "var(--font-mono)", fontSize: 10.5, lineHeight: 1.6, color: "var(--text-muted)", maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap" }}>{rStream}</pre>
                      </details>
                    )}
                  </div>
                );
              })}
              {entry.status === "running" && (
                <div style={{ fontSize: 10, color: "var(--text-dim)", padding: "3px 10px", borderTop: "1px solid var(--border)" }}>● 运行中（实时心跳）</div>
              )}
            </div>
          );
        })()}
        {/* bash：展开区只显示实时输出流，不重复 command JSON（args 留给未运行完的历史条目） */}
        {open && entry.args !== undefined && !(entry.toolName === "bash" && entry.status === "running") && (
          <pre
            style={{
              margin: "6px 0 0", padding: "8px 10px", fontSize: 11.5, lineHeight: 1.6,
              color: "var(--text-muted)", maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap",
              border: "1px solid var(--border)", borderRadius: 6, background: "transparent",
              fontFamily: "var(--font-mono)",
            }}
          >
            {typeof entry.args === "object" && entry.args !== null
              ? JSON.stringify(entry.args, null, 2)
              : String(entry.args)}
          </pre>
        )}
      </div>
    </div>
  );
}
