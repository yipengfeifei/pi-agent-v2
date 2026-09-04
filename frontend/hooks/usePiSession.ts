"use client";

// Pi Agent V2 唯一会话 hook：WS 桥接后端（pi-agent-v2/backend server.js）
// 事件流 → 消息投影（合并逻辑照搬 Execute 版：running 工具活动与其返回折叠为一条）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";


// 工具活动行描述：args → 一句话（图标已代表工具名，这里只出描述，不带工具名前缀）
// bash 命令 → 虚拟工具类型（图标+描述一起换）：bash 是万能壳，按命令内容识别真实操作
const classifyBash = (cmd: string): { virtualTool: string; text: string } => {
  if (/ego-browser/.test(cmd)) return { virtualTool: "browser", text: "浏览器操作（ego-browser）" };
  if (/anysearch/.test(cmd)) {
    const q = cmd.match(/search\s+"([^"]+)"/)?.[1] ?? cmd.match(/search\s+'([^']+)'/)?.[1];
    return { virtualTool: "search", text: `网络搜索：${(q ?? "").slice(0, 40) || "anysearch"}` };
  }
  if (/curl/.test(cmd)) {
    const u = cmd.match(/https?:\/\/[^\s"']+/)?.[0] ?? "";
    return { virtualTool: "http_request", text: `HTTP 请求：${u.slice(0, 50)}` };
  }
  if (/python3?\s/.test(cmd)) return { virtualTool: "python", text: `运行脚本：${cmd.split("\n")[0].replace(/^python3?\s+/, "").slice(0, 50)}` };
  if (/node\s/.test(cmd)) return { virtualTool: "terminal", text: `运行 node：${cmd.split("\n")[0].replace(/^node\s+/, "").slice(0, 50)}` };
  // 常见 shell 命令 → 对应工具图标（模型常用 bash 调它们，直接识别）
  const first = cmd.split("\n")[0].trim();
  if (/^ls\b/.test(first)) return { virtualTool: "ls", text: `列出目录：${first.slice(2).trim() || "."}` };
  if (/^grep\b/.test(first)) return { virtualTool: "grep", text: `搜索：${first.replace(/^grep\s+/, "").slice(0, 40)}` };
  if (/^find\b/.test(first)) return { virtualTool: "find", text: `查找：${first.replace(/^find\s+/, "").slice(0, 40)}` };
  if (/^(cat|head|tail|less|more)\b/.test(first)) return { virtualTool: "read", text: `查看：${first.slice(0, 50)}` };
  if (/^(mkdir|rm|mv|cp|touch|chmod)\b/.test(first)) return { virtualTool: "bash", text: `文件操作：${first.slice(0, 50)}` };
  return { virtualTool: "bash", text: first.slice(0, 60) };
};

const describeTool = (name: string, args: any = {}) => {
  switch (name) {
    case "bash": return classifyBash(String(args.command ?? "")).text;
    case "write": return `写入 ${args.path ?? ""}`;
    case "read": return `读取 ${args.path ?? ""}`;
    case "http_request": return `请求 ${args.url ?? ""}`;
    case "execution_app_snapshot": return `快照 ${args.appName ?? ""}`;
    case "grep": return `搜索 ${args.pattern ?? ""}${args.path ? `（${args.path}）` : ""}`;
    case "search": return `搜索：${String(args.query ?? "").slice(0, 40)}`;
    case "find": return `查找 ${args.path ?? ""}`;
    case "ls": return `列出 ${args.path ?? ""}`;
    case "plan": return "拆解任务";
    case "worker": return `执行节点 ${args.nodeId ?? ""}`;
    case "research": return `专家研究：${String(args.goal ?? "").slice(0, 40)}`;
    case "browser": return `浏览器操作：${String(args.url ?? "").slice(0, 50)}`;
    case "subagent": return args.tasks?.length ? `派出 ${args.tasks.length} 个取证员并行` : args.agent ? `派出取证员 ${args.agent}` : "派出取证员";
    case "site_memory": return args.action === "get" ? `读取站点经验：${args.url ?? ""}` : args.action === "set" ? "固化站点经验" : `站点记忆：${args.action ?? ""}`;
    case "wait_for": return `定时唤醒：${args.minutes ?? "?"} 分钟后（${args.note ?? ""}）`;
    case "run_status": return "查看任务运行状态";
    default: return name;
  }
};

export type ResearchRound = { round: number; phase: string; status: string; elapsed?: string; summary?: string };

export type PiEntry = {
  id: string;
  seq?: number; // 单调递增序号（事件到达顺序），排序用——time 只做展示（流式期间会被反复更新，不可用于排序）
  role: "user" | "assistant" | "activity";
  text: string;
  thinking?: string;
  time: number;
  status?: "running" | "done" | "error";
  toolName?: string;
  virtualTool?: string; // bash 命令识别的真实操作类型（browser/python/http…），图标按它显示
  args?: unknown; // 工具调用参数（plan 的节点图等），活动条目展开用
  runId?: string; // 节点活动条目所属 workflow runId（心跳流 key 用）
  turnId?: number; // agent 回合号：agent_start 递增；同一回合的条目（含用户中途反馈）同号，回合结束整轮折叠
  entryId?: string; // JSONL message entry id：分支按钮数据源（history 重放时由后端按序 zip）
};

export type PiNode = {
  id: string;
  type: string;
  name?: string;
  deps?: string[];
  input?: string[];
  output?: string;
  prompt?: string;
  status?: "pending" | "running" | "done";
};

export type PiGraph = {
  graph: { nodes?: PiNode[] } | null;
  outputs: Array<{ nodeId?: string; output?: string; artifacts?: string[] }>;
  runningNodeId: string | null;
  blockedNodeIds: string[];
};

export type PiSkill = {
  name: string;
  description?: string;
  filePath?: string;
  source?: string;
  disableModelInvocation: boolean;
  sourceInfo?: Record<string, string | undefined>;
};

export type PiSessionInfo = {
  id: string;
  path: string;
  cwd?: string; // 归属项目（header.cwd）；默认 CWD = 最近聊天（未归属）
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
};

export type PiProject = {
  cwd: string;
  name: string;
  modified: string;
  sessionCount: number;
  sessions: PiSessionInfo[];
};

export type PiSidebar = {
  projects: PiProject[]; // 注册项目（用户明确选过的文件夹）
  recent: PiSessionInfo[]; // 最近聊天（默认 CWD 的未归属会话）
};

export type PiModel = {
  provider: string;
  hasAuth: boolean;
  models: Array<{ id: string; name: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number }>;
};

export type PiTemplate = {
  file: string;
  title: string;
  nodeCount: number;
  saved?: number | null;
};

type Incoming =
  | { type: "ready"; sessionId: string; sessionFile: string; mode?: string; cwd?: string; modelFallbackMessage?: string }
  | { type: "error"; message: string }
  | { type: "artifacts"; artifacts: string[] }
  | { type: "artifact_added"; path: string }
  | { type: "artifact_content"; path: string; kind: string; data: string; ext: string }
  | { type: "graph"; graph: { nodes?: PiNode[] } | null; outputs: Array<{ nodeId?: string; output?: string; artifacts?: string[] }> }
  | { type: "skills"; skills: PiSkill[] }
  | { type: "models"; providers: PiModel[] }
  | { type: "templates"; templates: PiTemplate[] }
  | { type: "template_saved"; file: string }
  | { type: "template_loaded"; file: string }
  | { type: "api_key_set"; provider: string }
  | { type: "skill_toggled"; name: string; disabled: boolean }
  | { type: "sidebar"; sidebar: PiSidebar }
  | { type: "session_renamed"; sessionId: string; name: string }
  | { type: "session_moved"; sessionFile: string; cwd: string; targetFile: string }
  | { type: "session_deleted"; sessionFile: string }
  | { type: "history"; messages: Array<{ id: string; role: string; text: string; thinking?: string; toolName?: string; args?: unknown; status?: "running" | "done" | "error"; time: number; entryId?: string }> }
  | { type: "node_progress"; runId?: string; nodeId?: string; delta?: string; at?: number }
  | { type: "bash_progress"; toolCallId?: string; delta?: string }
  | { type: "research_progress"; toolCallId?: string; round?: number; phase?: string; status?: string; delta?: string; elapsed?: string; summary?: string; conclusion?: string; note?: string; at?: number }
  | { type: "subagent_progress"; toolCallId?: string; index?: number; delta?: string }
  | { type: "search_results"; toolCallId?: string; query?: string; sources?: Array<{ title: string; url: string }> }
  | { type: "event"; event: any };

export function usePiSession(wsUrl = `ws://127.0.0.1:${process.env.NEXT_PUBLIC_WS_PORT ?? "4700"}`) {
  const wsRef = useRef<WebSocket | null>(null);
  // pi SDK 事件里 assistant message 无稳定 id：按 turn 自增序号做 key，turn 内合并
  const turnSeqRef = useRef(0);
  const activeAssistantRef = useRef<string | null>(null);
  const turnIdRef = useRef(0); // agent 回合号（agent_start 递增）
  const [currentTurnId, setCurrentTurnId] = useState(0);
  // 模型自然结束的回合号集合（agent_end 事件显式标记）——折叠段边界，不靠 busy 推断
  const [endedTurns, setEndedTurns] = useState<ReadonlySet<number>>(new Set());
  // 会话模式：normal=全量注入；simple/simple-pro=简单·Pro；simple-flash=简单·Flash（persona 按模型分流，后端实测驱动）
  type PiMode = "normal" | "simple" | "simple-pro" | "simple-flash";
  const modeRef = useRef<PiMode>("normal");
  // worker 工具调用：toolCallId → nodeId 映射（end 时判卡住）
  const workerNodeRef = useRef<Map<string, string>>(new Map());
  const [ready, setReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionCwd, setSessionCwd] = useState<string | null>(null);
  const [mode, setMode] = useState<PiMode>("normal");
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<PiEntry[]>([]);
  const seqRef = useRef(0); // 单调递增序号：事件到达顺序（time 在流式期间反复更新，不能排序）
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  // 断连后置 true（显示"连接断开，正在重连…"横幅），重连成功置 false
  const [reconnecting, setReconnecting] = useState(false);
  // 画布数据：node_graph + node_output（worker/plan 工具事件后拉取）
  const [graph, setGraph] = useState<PiGraph>({ graph: null, outputs: [], runningNodeId: null, blockedNodeIds: [] });
  // Artifact（会话级）：主会话 write 写出的文件 + 节点产出文件（get_artifacts / artifact_added 推送）
  const [artifacts, setArtifacts] = useState<string[]>([]);
  // applyEvent 闭包用：最新图（事件回调不能依赖 state 闭包）
  const graphRef = useRef(graph);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);
  // 节点实时心跳流：key=`${runId||""}:${nodeId}` → 已累积文本（点击节点展开显示）
  const [nodeStreams, setNodeStreams] = useState<Record<string, string>>({});
  const nodeStreamsRef = useRef(nodeStreams);
  useEffect(() => { nodeStreamsRef.current = nodeStreams; }, [nodeStreams]);
  // research 轮次元数据：toolCallId → [{round, phase, status, elapsed, summary}]（展开区按轮次分区渲染）
  const [researchRounds, setResearchRounds] = useState<Record<string, ResearchRound[]>>({});
  const researchRoundsRef = useRef(researchRounds);
  useEffect(() => { researchRoundsRef.current = researchRounds; }, [researchRounds]);
  // 搜索结果：toolCallId → sources（展开区渲染网页列表，favicon + 标题 · 域名）
  const [searchSources, setSearchSources] = useState<Record<string, Array<{ title: string; url: string }>>>({});
  // 产物文件预览：readArtifact(path) → Promise（等 artifact_content 事件）
  const artifactPending = useRef(new Map<string, (r: { kind: string; data: string; ext: string }) => void>());
  const readArtifact = useCallback((path: string) => {
    return new Promise<{ kind: string; data: string; ext: string }>((resolve, reject) => {
      artifactPending.current.set(path, resolve);
      send({ type: "read_artifact", path });
      // 兜底：后端 error/超时时不挂起（error 事件不带 path，无法精准匹配）
      setTimeout(() => {
        if (artifactPending.current.has(path)) {
          artifactPending.current.delete(path);
          reject(new Error("读取超时"));
        }
      }, 8000);
    });
  }, []);
  const [skills, setSkills] = useState<PiSkill[]>([]);
  const [models, setModels] = useState<PiModel[]>([]); // API/模型配置面板数据
  const [templates, setTemplates] = useState<PiTemplate[]>([]); // 模板库列表
  // Skill 列表（保留清单：Session 的 Skill 面板）
  // 会话列表（侧边栏）：项目分组 + 最近聊天
  const [sidebar, setSidebar] = useState<PiSidebar>({ projects: [], recent: [] });

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      setReconnecting(false); // 重连成功：撤掉横幅（ready 到达时 busy 已复位）
    };
    ws.onclose = () => {
      setConnected(false);
      setReady(false);
      // 后端崩溃/断连：agent_end 永远到不了，busy 不复位会卡死在暂停态（暂停按钮、Enter 全失灵）。
      // 与 ready 复位同一原则——断连即"运行态已不可信"，busy 复位恒正确。
      setBusy(false);
      setReconnecting(true); // 后端看门狗 2s 内重启，重连后自动恢复
      // 自动重连：后端重启/临时断开后标签页不死（卸载时 wsRef 已置 null，不会误重连）
      setTimeout(() => {
        if (wsRef.current === ws && wsRef.current.readyState === WebSocket.CLOSED) connect();
      }, 2000);
    };
    ws.onerror = () => setConnected(false);
    ws.onmessage = (raw) => {
      let msg: Incoming;
      try {
        msg = JSON.parse(raw.data as string);
      } catch {
        return;
      }
      if (msg.type === "ready") {
        // 会话替换（切换/新建/分支）都经 open()→ready：旧 session 已被后端 dispose，agent_end 不会送达
        // → busy 必须随 ready 复位，否则卡死在暂停态（输入框一直显示暂停、Enter 走 steer 无响应）
        setBusy(false);
        setSessionId(msg.sessionId);
        if (msg.cwd) setSessionCwd(msg.cwd);
        setReady(true);
        setError(null);
        // 模式是会话级的（每会话独立）：切换/新建后必须双向同步，否则从简单会话切回普通会话仍显示简单模式
        modeRef.current = msg.mode === "simple" || msg.mode === "simple-pro" || msg.mode === "simple-flash" ? (msg.mode as PiMode) : "normal";
        setMode(modeRef.current);
        refreshGraph();
        refreshArtifacts();
        refreshSkills();
        refreshSidebar();
        refreshModels();
        refreshTemplates();
        return;
      }
      if (msg.type === "graph") {
        setGraph((prev) => ({ ...prev, graph: msg.graph, outputs: msg.outputs }));
        return;
      }
      if (msg.type === "artifacts") {
        setArtifacts(msg.artifacts);
        return;
      }
      if (msg.type === "artifact_added") {
        setArtifacts((prev) => (prev.includes(msg.path) ? prev : [...prev, msg.path]));
        return;
      }
      if (msg.type === "skills") {
        setSkills(msg.skills);
        return;
      }
      if (msg.type === "session_renamed") {
        refreshSidebar(); // 改名后重拉列表（显示名覆盖优先）
        return;
      }
      if (msg.type === "sidebar") {
        setSidebar(msg.sidebar);
        return;
      }
      if (msg.type === "session_moved") {
        refreshSidebar(); // 归属变了，重拉分组
        return;
      }
      if (msg.type === "session_deleted") {
        setSidebar((prev) => ({
          projects: prev.projects.map((p) => ({ ...p, sessions: p.sessions.filter((s) => s.path !== msg.sessionFile), sessionCount: Math.max(0, p.sessionCount - 1) })),
          recent: prev.recent.filter((s) => s.path !== msg.sessionFile),
        }));
        return;
      }
      if (msg.type === "node_progress") {
        const key = `${msg.runId ?? ""}:${msg.nodeId ?? ""}`;
        const prev = nodeStreamsRef.current;
        prev[key] = (prev[key] ?? "") + (msg.delta ?? "");
        setNodeStreams({ ...prev });
        return;
      }
      if (msg.type === "bash_progress") {
        // bash 实时输出（后端把 SDK 全量快照转成增量再推）：key = tool:<toolCallId>，与活动条目 id 一致
        if (!msg.toolCallId || !msg.delta) return;
        const key = `tool:${msg.toolCallId}`;
        const prev = nodeStreamsRef.current;
        prev[key] = (prev[key] ?? "") + msg.delta;
        if (prev[key].length > 30000) prev[key] = prev[key].slice(-30000); // 只留尾部，防巨输出拖垮渲染
        setNodeStreams({ ...prev });
        return;
      }
      if (msg.type === "search_results") {
        if (msg.toolCallId && Array.isArray(msg.sources)) {
          setSearchSources((prev) => ({ ...prev, [msg.toolCallId!]: msg.sources! }));
        }
        return;
      }
      if (msg.type === "subagent_progress") {
        // 取证员实时心跳：key = tool:<toolCallId>:<index>（与拆条条目 id 一致）
        const key = `tool:${msg.toolCallId ?? ""}:${msg.index ?? 0}`;
        const prev = nodeStreamsRef.current;
        prev[key] = (prev[key] ?? "") + (msg.delta ?? "");
        setNodeStreams({ ...prev });
        return;
      }
      if (msg.type === "research_progress") {
        // research 活动条目 id = tool:<toolCallId>；展开区按轮次分区，每轮独立信息流 key = tool:<id>:r<round>
        const entryKey = `tool:${msg.toolCallId ?? ""}`;
        const streamKey = `${entryKey}:r${msg.round ?? 0}`;
        if (msg.delta) {
          const prev = nodeStreamsRef.current;
          prev[streamKey] = (prev[streamKey] ?? "") + (msg.delta ?? "");
          setNodeStreams({ ...prev });
        }
        if (msg.round) {
          const prev = researchRoundsRef.current;
          const list = prev[entryKey] ?? [];
          const idx = list.findIndex((r) => r.round === msg.round);
          const meta = { round: msg.round, phase: msg.phase ?? "", status: msg.status ?? "running", elapsed: msg.elapsed, summary: msg.summary ?? "" };
          if (idx >= 0) list[idx] = { ...list[idx], ...meta };
          else list.push(meta);
          prev[entryKey] = [...list].sort((a, b) => a.round - b.round);
          setResearchRounds({ ...prev });
        }
        // 轮次推进 → 更新活动行文字（第 X 轮 · 阶段）
        if (msg.round && msg.status === "running") {
          setEntries((prev) =>
            prev.map((e) => (e.id === entryKey ? { ...e, text: `专家研究 · 第 ${msg.round} 轮（${msg.phase ?? ""}）` } : e))
          );
        }
        // 研究整体完成 → 更新文字为结论速览
        if (msg.status === "complete" && msg.conclusion) {
          setEntries((prev) => prev.map((e) => (e.id === entryKey ? { ...e, text: msg.conclusion as string } : e)));
        }
        return;
      }
      if (msg.type === "models") {
        setModels(msg.providers);
        return;
      }
      if (msg.type === "api_key_set") {
        setModels((prev) => prev.map((p) => (p.provider === msg.provider ? { ...p, hasAuth: true } : p)));
        return;
      }
      if (msg.type === "templates") {
        setTemplates(msg.templates);
        return;
      }
      if (msg.type === "template_saved") {
        refreshTemplates();
        return;
      }
      if (msg.type === "template_loaded") {
        refreshTemplates();
        return;
      }
      if (msg.type === "history") {
        // 切换/恢复会话：历史消息替换当前投影（保留乐观条目的合并逻辑照搬）
        const hist = msg.messages.filter((m) => m.role !== "user" || m.text.trim());
        // 历史回合：按 user 消息分段标负数 turnId（-1, -2, …）——不与新回合 1,2,3 冲突，
        // 且 turnId < currentTurnId 恒成立 → 刷新/切换后旧回合也能段式折叠（提问 + N 步骤 + 最后回复）
        let histTurn = 0;
        setEntries(hist.map((m, i) => {
          if (m.role === "user") histTurn += 1;
          return {
          id: m.id ?? `hist:${i}`,
          seq: ++seqRef.current,
          role: m.role as PiEntry["role"],
          // 历史工具条目只带工具名，用 describeTool 补描述（与实时一致）；用户/助手消息用原 text
          text: m.role === "activity" ? describeTool(m.toolName ?? "", m.args) : m.text,
          thinking: m.thinking,
          toolName: m.toolName,
          virtualTool: m.role === "activity" && m.toolName === "bash" ? classifyBash(String((m.args as any)?.command ?? "")).virtualTool : undefined,
          args: m.args,
          status: m.status,
          entryId: m.entryId,
          time: m.time || Date.now() - (hist.length - i),
          turnId: -histTurn,
          };
        }));
        return;
      }
      if (msg.type === "skill_toggled") {
        setSkills((prev) => prev.map((s) => (s.name === msg.name ? { ...s, disableModelInvocation: msg.disabled } : s)));
        return;
      }
      if (msg.type === "artifact_content") {
        // 产物文件预览响应：resolve 对应 readArtifact Promise
        const resolve = artifactPending.current.get(msg.path);
        if (resolve) {
          artifactPending.current.delete(msg.path);
          resolve({ kind: msg.kind, data: msg.data, ext: msg.ext });
        }
        return;
      }
      if (msg.type === "error") {
        setError(msg.message);
        setBusy(false);
        return;
      }
      const event = msg.event;
      applyEvent(event);
    };
  }, [wsUrl]);

  const applyEvent = useCallback((event: any) => {
    const upsert = (entry: PiEntry) =>
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.id === entry.id);
        const withTurn = { ...entry, turnId: entry.turnId ?? turnIdRef.current };
        if (idx === -1) return [...prev, { ...withTurn, seq: ++seqRef.current }];
        const next = [...prev];
        // 已有条目：只更新内容，保留原 seq（顺序不因流式更新而变）
        // thinking 只增不覆：SDK 流式 message_update 里有的帧 content 不含 thinking（纯 text 帧），
        // 若全量覆盖会把已积累的 thinking 清空 → 思考块不渲染（只有正文里的思考内容）。非空才更新。
        next[idx] = {
          ...next[idx],
          ...withTurn,
          thinking: withTurn.thinking && withTurn.thinking.trim() ? withTurn.thinking : next[idx].thinking,
          id: entry.id,
          seq: next[idx].seq ?? ++seqRef.current,
        };
        return next;
      });
    const textOf = (message: any) => {
      const parts = Array.isArray(message?.content) ? message.content : [];
      return parts
        .filter((p: any) => p?.type === "text")
        .map((p: any) => p.text)
        .join("");
    };
    const thinkingOf = (message: any) => {
      const parts = Array.isArray(message?.content) ? message.content : [];
      return parts
        .filter((p: any) => p?.type === "thinking")
        .map((p: any) => p.thinking ?? "")
        .join("");
    };

    const upsertAssistant = (message: any) => {
      const text = textOf(message);
      if (!activeAssistantRef.current) {
        turnSeqRef.current += 1;
        activeAssistantRef.current = `assistant:${turnSeqRef.current}`;
      }
      upsert({
        id: activeAssistantRef.current,
        role: "assistant",
        text,
        thinking: thinkingOf(message),
        time: Date.now(),
      });
    };

    switch (event.type) {
      case "agent_start":
        setBusy(true);
        turnIdRef.current += 1;
        setCurrentTurnId(turnIdRef.current);
        setError(null);
        break;
      case "tool_result_end": {
        // 工具完成：条目行文字更新为结果的最后一句（用户：结束的时候展示最后一句）
        const m = event.message;
        const parts = Array.isArray(m?.content) ? m.content : [];
        for (const p of parts) {
          if (p?.type === "toolResult" && p.toolCallId) {
            const id = `tool:${p.toolCallId}`;
            const raw = typeof p.result === "string" ? p.result : JSON.stringify(p.result ?? "");
            const lastLine = raw.split("\n").map((l: string) => l.trim()).filter(Boolean).pop()?.slice(0, 80) ?? "";
            if (lastLine) {
              setEntries((prev) =>
                prev.map((e) => {
                  // research 用专门的 complete 文字；subagent 拆条保持描述——都不覆盖
                  if (e.id !== id || e.toolName === "research" || e.toolName === "subagent") return e;
                  return { ...e, text: lastLine };
                })
              );
            }
          }
        }
        break;
      }
      case "agent_end":
        setBusy(false);
        // 模型自然结束：显式标记当前回合已结束（前端直接监听，不靠 busy/currentTurnId 推断）
        setEndedTurns((prev) => new Set(prev).add(turnIdRef.current));
        break;
      case "message_update":
      case "message_end":
      case "turn_end": {
        const m = event.message;
        if (!m) break;
        if (m.role === "assistant") upsertAssistant(m);
        if (event.type === "turn_end") activeAssistantRef.current = null; // 本轮完成，下一轮开新条目
        break;
      }
      case "tool_execution_start":
        if (event.toolName === "worker") {
          workerNodeRef.current.set(event.toolCallId, event.args?.nodeId ?? "");
          setGraph((prev) => ({ ...prev, runningNodeId: event.args?.nodeId ?? null }));
          // 进度文本流：从图里取节点语义（Execute progressUpdates 的 V2 形态）
          const node = graphRef.current?.graph?.nodes?.find((n) => n.id === event.args?.nodeId);
          // 心跳流 key：runId:nodeId，从 worker args 的 graph 里取 runId
          let runId = "";
          try { runId = JSON.parse(String(event.args?.graph ?? "{}")).runId ?? ""; } catch {}
          upsert({
            id: `node:${event.args?.nodeId ?? event.toolCallId}`,
            role: "activity",
            text: `节点 ${event.args?.nodeId ?? "?"}${node ? `：${node.name}（${node.type}）` : ""}`,
            time: Date.now(),
            status: "running",
            toolName: "node",
            runId,
          });
        }
        // subagent 并行：按任务数拆成独立活动行（每条独立信息流 key = tool:<id>:<i>）
        if (event.toolName === "subagent" && Array.isArray(event.args?.tasks) && event.args.tasks.length > 1) {
          event.args.tasks.forEach((t: any, i: number) => {
            upsert({
              id: `tool:${event.toolCallId}:${i}`,
              role: "activity",
              text: `取证员 ${["①","②","③","④","⑤","⑥","⑦","⑧"][i] ?? i + 1}：${String(t?.task ?? "").slice(0, 44)}…`,
              time: Date.now(),
              status: "running",
              toolName: "subagent",
              args: t,
            });
          });
          break;
        }
        upsert({
          id: `tool:${event.toolCallId}`,
          role: "activity",
          text: describeTool(event.toolName, event.args),
          time: Date.now(),
          status: "running",
          toolName: event.toolName,
          virtualTool: event.toolName === "bash" ? classifyBash(String(event.args?.command ?? "")).virtualTool : undefined,
          args: event.args,
        });
        break;
      case "tool_execution_end": {
        const id = `tool:${event.toolCallId}`;
        if (event.toolName === "subagent" && Array.isArray(event.args?.tasks) && event.args.tasks.length > 1) {
          // 批量更新该 subagent 的所有子条目
          setEntries((prev) => prev.map((e) => (e.id.startsWith(id) ? { ...e, status: event.isError ? "error" : "done" } : e)));
          break;
        }
        setEntries((prev) => {
          const idx = prev.findIndex((e) => e.id === id);
          if (idx === -1) return prev;
          const next = [...prev];
          // 合并逻辑：running 活动与其返回折叠为一条（Execute merge 的简化版）
          next[idx] = { ...next[idx], status: event.isError ? "error" : "done" };
          return next;
        });
        // plan/worker 结束后刷新画布（图或产出变了）；worker 失败 → 节点记入卡住
        if (event.toolName === "plan" || event.toolName === "worker") {
          const nodeId = workerNodeRef.current.get(event.toolCallId);
          if (event.toolName === "worker" && nodeId) {
            // 节点进度折叠为完成（Execute merge 的节点版）
            setEntries((prev) => {
              const nidx = prev.findIndex((e) => e.id === `node:${nodeId}`);
              if (nidx === -1) return prev;
              const next = [...prev];
              const node = graphRef.current?.graph?.nodes?.find((n) => n.id === nodeId);
              next[nidx] = {
                ...next[nidx],
                status: event.isError ? "error" : "done",
                text: event.isError
                  ? `节点 ${nodeId}${node ? `：${node.name}` : ""} 卡住`
                  : `节点 ${nodeId}${node ? `：${node.name}` : ""} 完成`,
              };
              return next;
            });
            if (event.isError) {
              setGraph((prev) => ({ ...prev, blockedNodeIds: [...new Set([...prev.blockedNodeIds, nodeId])] }));
            }
          }
          workerNodeRef.current.delete(event.toolCallId);
          setGraph((prev) => ({ ...prev, runningNodeId: null }));
          refreshGraph();
        }
        break;
      }
      case "compaction_start":
        upsert({ id: "compaction", role: "activity", text: "正在压缩会话上下文…", time: Date.now(), status: "running" });
        break;
      case "compaction_end":
        setEntries((prev) => prev.filter((e) => e.id !== "compaction"));
        break;
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  // 画布：拉取最新 node_graph + node_output
  const refreshGraph = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "get_graph" }));
  }, []);
  // Artifact：拉取会话级合并列表（write 文件 + 节点产出）
  const refreshArtifacts = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "get_artifacts" }));
  }, []);

  // Skill 面板
  const refreshSkills = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "get_skills" }));
  }, []);
  // 会话侧边栏：项目分组 + 最近聊天（get_sidebar 一次拉全量）
  const refreshSidebar = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "get_sidebar" }));
  }, []);
  // 新建项目（侧边栏）：登记文件夹 + 自定义名，完成后重拉 sidebar
  const createProject = useCallback((cwd: string, name: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "create_project", cwd, name }));
      refreshSidebar();
    }
  }, [refreshSidebar]);
  // API/模型配置面板：拉 provider/模型目录 + 设 API key
  const refreshModels = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "get_models" }));
  }, []);
  const setApiKey = useCallback((provider: string, apiKey: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "set_api_key", provider, apiKey }));
  }, []);
  // 自定义 OpenAI 兼容端点（API 引导弹窗）：写 ~/.pi/agent/models.json，未显式 MAIN_MODEL 时切为主模型
  const setCustomProvider = useCallback((baseUrl: string, apiKey: string, modelId: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "set_custom_provider", provider: "custom", baseUrl, apiKey, modelId }));
  }, []);
  // 模板库：列出 / 保存当前图 / 载入执行
  const refreshTemplates = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "list_templates" }));
  }, []);
  const saveTemplate = useCallback((title: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "save_template", title }));
  }, []);
  const loadTemplate = useCallback((file: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "load_template", file }));
  }, []);
  const switchSession = useCallback(
    (sessionFile: string) => {
      setEntries([]);
      setBusy(false); // 会话切换：busy 是会话级状态，不复位会卡暂停态（后端 dispose 丢 agent_end）
      turnSeqRef.current = 0;
      activeAssistantRef.current = null;
      setGraph({ graph: null, outputs: [], runningNodeId: null, blockedNodeIds: [] });
      nodeStreamsRef.current = {};
      setNodeStreams({});
      setArtifacts([]);
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "switch_session", sessionFile, mode: modeRef.current }));
        ws.send(JSON.stringify({ type: "get_graph" })); // 切到旧会话也拉图（否则画布不显示）
        ws.send(JSON.stringify({ type: "get_artifacts" }));
      }
    },
    [],
  );
  const deleteSession = useCallback((sessionFile: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "delete_session", sessionFile }));
  }, []);
  const renameSession = useCallback((sessionId: string, name: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "rename_session", sessionId, name }));
  }, []);
  const toggleSkill = useCallback(
    (name: string, disabled: boolean) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "set_skill_disabled", name, disabled }));
    },
    [],
  );

  // 乐观本地条目（Execute 版：发送即上屏，去重后与持久消息合并）
  const prompt = useCallback(
    (text: string) => {
      const id = `local:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      setEntries((prev) => [...prev, { id, role: "user", text, seq: ++seqRef.current, time: Date.now() }]);
      send({ type: "prompt", text });
    },
    [send],
  );
  const steer = useCallback((text: string) => send({ type: "steer", text }), [send]);
  const abort = useCallback(() => send({ type: "abort" }), [send]);

  // 会话级命令（后端命令层）：
  // setModel —— /model <关键词>，模糊匹配 provider/模型 id（336 模型打字记不住全名）
  // compact —— /compact [说明]，SDK 原生压缩（compaction_start/end 事件自动走前端进度显示）
  // setQueue —— /queue on|off，多条输入排队（steering+followUp 都开 all）
  // branch —— 从某条消息（entryId）分叉为独立会话并切换（原会话保留）
  const setModel = useCallback((query: string) => send({ type: "set_model", query }), [send]);
  const compactSession = useCallback((note?: string) => send({ type: "compact", note }), [send]);
  const setQueue = useCallback((enabled: boolean) => send({ type: "set_queue", enabled }), [send]);
  const branch = useCallback((entryId: string) => {
    // 与 switchSession 同款清态：分支=切到新会话，ready/history 由后端推
    setEntries([]);
    turnSeqRef.current = 0;
    activeAssistantRef.current = null;
    setGraph({ graph: null, outputs: [], runningNodeId: null, blockedNodeIds: [] });
    nodeStreamsRef.current = {};
    setNodeStreams({});
    setArtifacts([]);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "branch", entryId }));
      ws.send(JSON.stringify({ type: "get_graph" }));
      ws.send(JSON.stringify({ type: "get_artifacts" }));
    }
  }, []);

  // 本地助手消息（斜杠命令的即时反馈，不进 WS/不打扰模型）
  const pushLocal = useCallback((text: string) => {
    setEntries((prev) => [...prev, { id: `local:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, role: "assistant", text, seq: ++seqRef.current, time: Date.now() }]);
  }, []);

  // 斜杠命令分发：SDK prompt() 会把 / 开头当扩展命令/模板展开，必须前端拦截解析
  const runCommand = useCallback((text: string) => {
    const [cmd, ...rest] = text.trim().slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();
    switch (cmd) {
      case "help":
        pushLocal(
          [
            "可用命令：",
            "/help — 本列表",
            "/model <关键词> — 切换模型（匹配 provider 或模型名子串，如 /model deepseek）",
            "/compact [说明] — 手动压缩会话上下文",
            "/queue on|off — 开启/关闭输入排队（多任务同时说，按序处理）",
            "提示：斜杠命令只在本窗口生效，不会发给模型。",
          ].join("\n"),
        );
        break;
      case "model":
        if (!arg) {
          pushLocal("用法：/model <关键词>，如 /model deepseek。可用模型见「API」面板。");
        } else {
          setModel(arg);
          pushLocal(`正在切换模型：${arg}…`);
        }
        break;
      case "compact":
        compactSession(arg || undefined);
        pushLocal("正在压缩会话上下文…（完成后自动继续）");
        break;
      case "queue":
        setQueue(arg !== "off");
        pushLocal(arg === "off" ? "输入队列已关闭。" : "输入队列已开启：可连续输入多条，按序处理。");
        break;
      default:
        pushLocal(`未知命令：/${cmd}（输入 /help 查看可用命令）`);
    }
  }, [pushLocal, setModel, compactSession, setQueue]);

  const newSession = useCallback((nextMode?: PiMode, cwd?: string) => {
    const m = nextMode ?? modeRef.current;
    modeRef.current = m;
    setMode(m);
    setEntries([]);
    setBusy(false); // 新建会话：同 switchSession，busy 不复位会卡暂停态
    turnSeqRef.current = 0;
    turnIdRef.current = 0;
    setEndedTurns(new Set());
    activeAssistantRef.current = null;
    setGraph({ graph: null, outputs: [], runningNodeId: null, blockedNodeIds: [] });
    nodeStreamsRef.current = {};
    setNodeStreams({});
    setArtifacts([]);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "new_session", mode: m, cwd: cwd ?? undefined }));
  }, [send]);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER)),
    [entries],
  );

  return { connected, reconnecting, ready, sessionId, sessionCwd, busy, currentTurnId, endedTurns, entries: sorted, error, graph, artifacts, skills, models, templates, sidebar, mode, prompt, steer, abort, newSession, toggleSkill, switchSession, renameSession, deleteSession, createProject, nodeStreams, researchRounds, searchSources, setApiKey, setCustomProvider, saveTemplate, loadTemplate, readArtifact, setModel, compactSession, setQueue, branch, runCommand };
}
