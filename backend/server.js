// Pi Agent V2 最小闭环后端：WS 事件桥 + pi SDK agent 会话
// 协议：
//   client→server  {type:"prompt",text} | {type:"steer",text} | {type:"followUp",text}
//                   | {type:"abort"} | {type:"new_session"}
//   server→client  {event: <pi AgentSessionEvent>} | {type:"ready",...} | {type:"error",message}
import { createServer } from "node:http";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync, statSync, rmSync, watch } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { WebSocketServer } from "ws";
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { createPlanTool } from "./tools/plan.js";
import { createUpdatePlanTool } from "./tools/update-plan.js";
import { createWorkerTool, nodeProgressEmitter } from "./tools/worker.js";
import { createWaitTool } from "./tools/wait.js";
import { searchTool } from "./tools/search.js";
import { searchResultsEmitter } from "./tools/search.js";
import { tavilySearchTool } from "./tools/tavily-search.js";
import { factreachTool } from "./tools/factreach.js";
import { readPageTool } from "./tools/read-page.js";
import { inspectFileTool } from "./tools/inspect-file.js";
import { browserTool } from "./tools/browser.js";
import { siteMemoryTool } from "./tools/site-memory.js";
import { createResearchTool } from "./tools/research.js";
import { researchProgressEmitter } from "./tools/research.js";
import { createRunStatusTool } from "./tools/run-status.js";
import { createSessionRecallTool } from "./tools/session-recall.js";
import { createToolkitLoader, TOOLKIT_CORE } from "./tools/toolkit-loader.js";
import { disposeWorkerSession } from "./worker-session.js";
import { isArtifact, EXT_WHITELIST } from "./artifacts.js";

const PORT = Number(process.env.PORT || 4700);
// 工具执行超时：bash 等命令挂死（子进程不退出）时自动中止，避免前端永久卡在运行中（默认 10 分钟，env TOOL_TIMEOUT 秒数可覆盖）
const TOOL_TIMEOUT_MS = (Number(process.env.TOOL_TIMEOUT) || 600) * 1000;
// 工具实时输出快照 → 增量提取（SDK bash 每次发全量快照，转成 delta 再推前端，避免每次重传全量）
const toolUpdateText = (pr) => {
  if (!pr || !Array.isArray(pr.content)) return "";
  return pr.content.filter((p) => p?.type === "text").map((p) => p.text ?? "").join("");
};
// 默认 cwd = V2 项目根（backend 的上级），会话按 cwd 归档，与用户其他 pi 会话隔离
const CWD = process.env.CWD || path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// 模板库目录：已跑通节点图存这里（目标架构 §7 决策 2：模板=带标注的已跑通节点图）
const TEMPLATES_DIR = path.join(CWD, "templates");

// 项目模型：项目 = cwd 文件夹。会话归档在 ~/.pi/agent/sessions/<cwd编码>/（pi 原生），
// 归属 = JSONL 第一行 header 的 cwd 字段（权威，目录名编码有损不可逆，不靠它解码）。
const SESSIONS_ROOT = () => path.join(getAgentDir(), "sessions");
const encodeCwd = (cwd) => `--${path.resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
const readSessionHeader = (filePath) => {
  try {
    const header = JSON.parse(readFileSync(filePath, "utf8").split("\n")[0]);
    return header?.type === "session" && typeof header.id === "string" ? header : null;
  } catch {
    return null;
  }
};
// 把一个会话文件移到目标 cwd 的归档目录（改写 header.cwd 为权威归属）
const moveSessionFile = (sessionFile, targetCwd) => {
  if (!existsSync(sessionFile)) throw new Error("会话文件不存在");
  const target = path.resolve(targetCwd);
  const targetDir = path.join(SESSIONS_ROOT(), encodeCwd(target));
  mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, path.basename(sessionFile));
  const raw = readFileSync(sessionFile, "utf8");
  const nl = raw.indexOf("\n");
  const header = JSON.parse(raw.slice(0, nl));
  if (header?.type !== "session") throw new Error("非法会话文件");
  header.cwd = target;
  writeFileSync(targetFile, JSON.stringify(header) + raw.slice(nl));
  unlinkSync(sessionFile);
  return { targetFile, sessionId: header.id };
};
// 会话显示名覆盖：用户改名后优先于 firstMessage 展示（v2-session-names.json: {sessionId: 名字}）
const SESSION_NAMES_FILE = path.join(getAgentDir(), "v2-session-names.json");
const loadSessionNames = () => {
  try {
    const d = JSON.parse(readFileSync(SESSION_NAMES_FILE, "utf8"));
    return typeof d === "object" && d ? d : {};
  } catch {
    return {};
  }
};
// Artifact 归属注册表：文件路径 → 首次登记它的会话 id。产物只出现在首次创建的会话里
// （后续会话重写同一文件不重复登记，get_artifacts 也按此过滤旧数据）
const ARTIFACT_ORIGIN_FILE = path.join(getAgentDir(), "v2-artifact-origin.json");
const loadArtifactOrigins = () => {
  try {
    const d = JSON.parse(readFileSync(ARTIFACT_ORIGIN_FILE, "utf8"));
    return typeof d === "object" && d ? d : {};
  } catch {
    return {};
  }
};
const saveArtifactOrigins = (origins) => writeFileSync(ARTIFACT_ORIGIN_FILE, JSON.stringify(origins, null, 2));

// Artifact 登记（唯一入口）：origins 归属 + 会话条目落库 + 推送前端
// 由 write 工具分支和 CWD watcher 共用——识别不绑定工具，任何写入方式都生效
// 归属首次会话：文件已登记过（首次写出在其他会话）→ 不重复登记，避免同一产物出现在多个会话
let artifactTarget = null; // 模块级：当前登记目标（单用户，最近打开/激活的会话）
let artifactSend = null; // 模块级：最近连接的 send（推送 artifact_added）
let artifactWatchCwd = null; // 当前 watcher 监听的目录（跟随会话 cwd，非固定 CWD）
const setArtifactTarget = (handle) => {
  artifactTarget = { cwd: handle.cwd, session: handle.session, sessionId: handle.session.sessionId };
  // watcher 跟随会话 cwd：dev 版 = 项目根；打包版 = 用户选的任意项目文件夹
  // ponytail: 只在 cwd 变化时重建（fs.watch 不能改路径，重建成本 = fsevents 重新初始化）
  if (artifactWatchCwd !== handle.cwd) {
    artifactWatchCwd = handle.cwd;
    startArtifactWatcher();
  }
};
function registerArtifact(p, opts = {}) {
  const t = artifactTarget;
  if (!t) return;
  // 会话文件：无论隐藏目录/扩展名白名单都登记（成熟做法：写过的文件都可见，交付物再加徽标）
  try {
    t.session.sessionManager.appendCustomEntry("session_file", { path: p, at: Date.now() });
  } catch {
    // sessionManager 未就绪时跳过持久化（推送照常）
  }
  artifactSend?.({ type: "session_file_added", path: p });
  if (!isArtifact(p, { cwd: t.cwd, ...opts })) return;
  try {
    t.session.sessionManager.appendCustomEntry("session_artifact", { path: p, at: Date.now() });
  } catch {
    // sessionManager 未就绪时跳过持久化（推送照常，前端仍能预览该路径）
  }
  artifactSend?.({ type: "artifact_added", path: p });
}

// CWD 文件系统监控：模型常用 bash 写交付物（write 工具分支覆盖不到）——根因修复
// 只要项目里出现白名单交付物文件（任何写入方式：write/bash/编辑器），就登记为 Artifact
// ponytail: 全局单 watcher（单用户足够），多连接共享同一登记目标；node_modules/隐藏目录事件在回调里粗滤
const artifactWatchTimers = new Map(); // path -> 去抖 timer（写文件触发多次 open/change 事件，800ms 稳定后处理）
let artifactWatcher = null;
function startArtifactWatcher() {
  if (artifactWatcher) {
    artifactWatcher.close(); // cwd 变了重建；首次启动时为 null
    artifactWatcher = null;
  }
  const cwd = artifactWatchCwd ?? CWD;
  try {
    artifactWatcher = watch(cwd, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const p = path.resolve(cwd, String(filename));
      if (!p.startsWith(cwd + path.sep)) return;
      const rel = path.relative(cwd, p);
      if (rel.split(path.sep).some((seg) => seg.startsWith(".") || seg === "node_modules")) return; // 隐藏目录/依赖目录不监听
      const ext = path.extname(p).toLowerCase().slice(1);
      if (!EXT_WHITELIST.includes(ext)) return; // 粗滤：非交付物扩展名直接跳过
      clearTimeout(artifactWatchTimers.get(p));
      artifactWatchTimers.set(p, setTimeout(() => {
        artifactWatchTimers.delete(p);
        if (existsSync(p)) registerArtifact(p); // 文件真实存在才登记（rename 删除的中间态不登记）
      }, 800));
    });
    console.log(`[server] CWD watcher 已启动（${cwd}）`);
  } catch (err) {
    console.error(`[server] CWD watcher 启动失败：${err.message}`);
  }
}
// 首次启动时回填：扫描 CWD 会话目录的 session_artifact 登记，最早登记的会话胜出
const backfillArtifactOrigins = () => {
  const origins = loadArtifactOrigins();
  if (Object.keys(origins).length > 0) return origins;
  const dir = path.join(SESSIONS_ROOT(), encodeCwd(CWD));
  if (!existsSync(dir)) return origins;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    let id = null;
    for (const line of readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.type === "session") id = e.id;
        else if (e.type === "custom" && e.customType === "session_artifact" && e.data?.path && !origins[String(e.data.path)] && id) {
          origins[String(e.data.path)] = id; // 最早登记胜出（文件名按创建时间排序）
        }
      } catch {
        // 单行解析失败跳过
      }
    }
  }
  if (Object.keys(origins).length > 0) saveArtifactOrigins(origins);
  return origins;
};
// SDK 空会话 firstMessage 为 "(no messages)" 占位，转空让前端显示「（空会话）」；有自定义名则优先
const toSessionInfo = (s) => ({
  id: s.id,
  path: s.path,
  cwd: s.cwd,
  created: s.created.toISOString(),
  modified: s.modified.toISOString(),
  messageCount: s.messageCount,
  firstMessage: loadSessionNames()[s.id] ?? (s.firstMessage === "(no messages)" ? "" : (s.firstMessage?.slice(0, 80) ?? "")),
});
// 项目注册表：项目 = 用户在 V2 里明确选过的文件夹（精确 cwd，不扫全盘——
// ~/.pi/agent/sessions 是整机 pi 共用的，含大量无关/测试目录；目录名编码也有损不可逆）
const PROJECTS_FILE = path.join(getAgentDir(), "v2-projects.json");
const loadProjects = () => {
  try {
    if (!existsSync(PROJECTS_FILE)) return [];
    const d = JSON.parse(readFileSync(PROJECTS_FILE, "utf8"));
    return Array.isArray(d.projects) ? d.projects : [];
  } catch {
    return [];
  }
};
const saveProjects = (projects) => writeFileSync(PROJECTS_FILE, JSON.stringify({ projects }, null, 2));
const registerProject = (cwd, name) => {
  const resolved = path.resolve(String(cwd));
  if (resolved === path.resolve(CWD)) return; // 默认工作区 = 最近聊天，不是项目
  const projects = loadProjects();
  const existing = projects.find((p) => p.cwd === resolved);
  if (existing) {
    if (name && existing.name !== name) {
      existing.name = name; // 重命名
      saveProjects(projects);
    }
    return;
  }
  projects.push({ cwd: resolved, name: name || resolved.split(/[\\/]/).pop() || resolved, addedAt: Date.now() });
  saveProjects(projects);
};

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

// 主 agent 模型：默认 deepseek-v4.1-flash（强弱统一，够用且便宜）；MAIN_MODEL="provider/id" 可覆盖；set_custom_provider 后切到新端点
let mainModel = (() => {
  const explicit = process.env.MAIN_MODEL;
  if (explicit) {
    const [p, id] = explicit.split("/");
    const m = modelRegistry.find(p, id);
    if (m) return m;
  }
  return modelRegistry.find("opencode-go", "deepseek-v4.1-flash") ?? undefined;
})();

// ═══ 统一 persona（2026-09-13 起，所有会话共用；无 normal/simple 之分）═══
// 只留三样真正起作用的：
//   ① 操作型定位（不自称 coding assistant —— 与「以操作为主」的定位不符）
//   ② 通道指针（load_toolkit 的组目录 + 两处技能库的 ls→read 路径）
//   ③ 编辑纪律里工具描述没说的那两条（edit 优先于 write；write 只用于新文件/整体重写）
// 丢掉：工具列表 389（与工具定义重复）、Guidelines 长版、Pi 文档 1,219 全文，
// 以及为 DeepSeek V4 写的 We 起手定式（4.1 实测已失效 —— 补短板型脚手架，模型换代后应拆）。
const PERSONA_SLIM =
  "You are an agent operating inside pi. You handle whatever the user asks: read/edit files, run commands, search the web, drive a real browser, operate local apps. Be concise; show file paths.\n"
  + "Tooling: the list below is not exhaustive — `load_toolkit` unlocks more specialized tools (its description lists the groups). Skills live in two places: `./.pi/skills/` (project) and `~/.pi/agent/skills/` (global) — for domain tasks `ls` both, then `read` the matching SKILL.md.\n"
  + "Editing: on existing files use `edit`, not `write`; `write` only for new files or full rewrites.\n"
  + "Pi docs: <node_modules/@earendil-works/pi-coding-agent>/{README.md,docs,examples} — only when asked about pi itself.";

// 懒清理：subagent 子进程临时会话（private/tmp cwd）超 1 天直接删，防会话目录无限堆积
// ponytail: 只清已知临时前缀 + 超期，不动任何人工会话；配额/TTL 体系等真出问题再加
function cleanupTempSessions() {
  try {
    const root = SESSIONS_ROOT();
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const d of readdirSync(root)) {
      if (!d.startsWith("--private-tmp-")) continue;
      const p = path.join(root, d);
      try {
        if (statSync(p).mtimeMs < cutoff) rmSync(p, { recursive: true, force: true });
      } catch { /* 目录已删/无权限，跳过 */ }
    }
    console.log("[cleanup] 临时会话清理完成");
  } catch { /* sessions 目录不存在，无需清理 */ }
}

const httpServer = createServer((req, res) => {
  res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "text/plain" });
  res.end(req.url === "/health" ? "ok" : "not found");
});

// 搬自旧 pi-frontend/app/api/skills/route.ts：改 SKILL.md frontmatter 的 disable-model-invocation
function setDisableModelInvocation(raw, disabled) {
  const normalize = (s) => String(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const content = normalize(raw);
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  const hasFrontmatter = !!match;
  const frontmatter = match ? match[1] : "";
  const body = match ? content.slice(match[0].length) : content;
  const lines = (hasFrontmatter ? frontmatter.split("\n") : []).filter((line) => !/^disable-model-invocation\s*:/.test(line.trim()));
  if (disabled) lines.push("disable-model-invocation: true");
  if (!hasFrontmatter) {
    return disabled ? `---\ndisable-model-invocation: true\n---\n${body.replace(/^\n+/, "")}` : content;
  }
  return `---\n${lines.join("\n")}\n---\n${body.replace(/^\n+/, "")}`;
}

// 技能库枚举：**不能**用会话自己的 resourceLoader —— 它为了精简 system prompt 设了 noSkills: true
// （语义 = 只加载显式指定的路径），会把技能集清空，Skill 面板跟着空。
// 这里单独建一个「只用于枚举」的 loader，按 cwd 缓存；每次 reload 让磁盘改动（启用/禁用）即时可见。
const skillCatalogCache = new Map(); // cwd -> DefaultResourceLoader
async function skillCatalog(cwd) {
  const key = cwd || CWD;
  let loader = skillCatalogCache.get(key);
  if (!loader) {
    loader = new DefaultResourceLoader({
      cwd: key,
      agentDir: getAgentDir(),
      noContextFiles: true,
      noPromptTemplates: true,
    });
    skillCatalogCache.set(key, loader);
  }
  await loader.reload();
  return loader.getSkills?.()?.skills ?? [];
}

const wss = new WebSocketServer({ server: httpServer });

// 多会话模型（一个窗口多会话并行）：
// - 每连接持有会话句柄 Map；切换/新建不 dispose 旧会话 → 后台继续跑（各自写各自 JSONL，无同文件竞争）
// - 事件只转发 active 句柄；后台句柄仅跟踪 running，切回时补发合成 agent_start 恢复前端 busy
// - 工具按句柄实例化（getSession 闭包指向自己的会话）；worker/wakeup/模型按句柄隔离
// - 落盘：每会话一个 SessionManager 单写者（appendFileSync 逐行），同一会话绝不双开（活句柄复用）
wss.on("connection", async (ws) => {
  const send = (payload) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  };
  artifactSend = send; // watcher 推送用（单用户：最近连接接管）

  const handles = new Map(); // sessionId -> handle
  let activeId = null;
  let connModel = mainModel; // 连接级默认模型（new_session 沿用；set_model 更新它 + 当前会话）
  const toolWatch = new Map(); // toolCallId -> 超时定时器（工具挂死自动中止）
  const bashSnapshots = new Map(); // toolCallId -> 上次转发过的输出文本（增量 diff 用）

  const activeHandle = () => (activeId ? handles.get(activeId) : null);
  const clearWakeups = (h) => { for (const t of h.wakeups) clearTimeout(t); h.wakeups.clear(); };

  // 定时唤醒：句柄级（后台会话的唤醒继续有效，连接关闭时统一清）
  const scheduleWakeup = (minutes, note, h) => {
    const timer = setTimeout(async () => {
      h.wakeups.delete(timer);
      if (h.session) {
        try {
          await h.session.followUp(`⏰ 定时唤醒：${note}`);
        } catch {
          // 会话已关闭，静默丢弃唤醒
        }
      }
    }, minutes * 60_000);
    h.wakeups.add(timer);
  };

  // 打开一个会话句柄（不激活）：新建/续最近/指定文件共用。工具按句柄实例化，多会话各跑各的
  const openHandle = async ({ fresh = false, sessionFile = null, cwd = null } = {}) => {
    // 切到某会话时，agent 工作目录 = 该会话 header 的 cwd（项目上下文继承）；
    // 否则默认 CWD。这是项目模型的关键：会话归档在哪，agent 就在哪干活
    const effCwd =
      cwd || (sessionFile ? readSessionHeader(String(sessionFile))?.cwd || CWD : CWD);
    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile)
      : fresh
        ? SessionManager.create(effCwd)
        : SessionManager.continueRecent(CWD); // 断点续跑：重连即续最近会话
    // 续最近会话时其文件模型才是真相：重连/刷新后 connModel 默认 flash，
    // 直接用会把手里的 Pro 会话续成 flash（且不写 model_change，事后难排查）
    const effSessionFile = sessionFile || (!fresh && sessionManager.sessionFile ? sessionManager.sessionFile : null);
    // 注意：此数组是「可激活白名单」——不在其中的名字，setActiveToolsByName 会静默忽略
    // （实测：load_toolkit 未列入时无法被激活）。所以新增工具必须同时进这里。
    const FULL_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "plan", "update_plan", "worker", "wait_for", "subagent", "run_status", "register_artifact", "search", "tavily_search", "read_page", "inspect_file", "factreach", "site_memory", "research", "browser", "recall", "load_toolkit"];
    // 工具面：窄起手 + 按场景解锁。核心集与分组定义全在 tools/toolkit-loader.js。
    // 所有模式统一给核心集起手（不再区分 normal/simple 的起手工具）。
    const activeToolNames = new Set(TOOLKIT_CORE);
    const customTools = [
      createPlanTool({ cwd: effCwd, getSession: () => handle.session }),
      createUpdatePlanTool({ getSession: () => handle.session }),
      createWorkerTool({ getSession: () => handle.session, cwd: effCwd }),
      createWaitTool({ scheduleWakeup: (m, n) => scheduleWakeup(m, n, handle) }),
      createRunStatusTool({ getSession: () => handle.session }),
      searchTool,
      tavilySearchTool,
      factreachTool,
      readPageTool,
      inspectFileTool,
      siteMemoryTool,
      createResearchTool({ cwd: effCwd, getSession: () => handle.session }),
      createSessionRecallTool({ cwd: effCwd }),
      browserTool,
      createToolkitLoader({
        getActive: () => Array.from(activeToolNames),
        setActive: (names) => {
          for (const n of names) activeToolNames.add(n);
          try {
            handle.session.setActiveToolsByName(Array.from(activeToolNames));
          } catch {}
        },
      }),
    ];
    // ═══ 统一精简 loader（所有会话共用）═══
    // 替换 SDK 默认模板（persona 169 + 工具列表 389 + Guidelines 701 + Pi 文档 1,219 ≈ 2,577）
    // 为 PERSONA_SLIM（见文件上方说明）。系统指令只进 system 层 ——
    // 曾误把设定拼进 user 消息 → 模型把系统约定当用户任务，引发反刍/自问自答。
    const slimLoader = new DefaultResourceLoader({
      cwd: effCwd,
      agentDir: getAgentDir(),
      systemPrompt: PERSONA_SLIM,
      // 注入 AGENTS.md（任务路由 / 工具边界 / 提问纪律 / 单一事实源）—— 这几条是防事故的，
      // 不是防啰嗦的。盘上那份已精简到 ~840 字符（只砍与工具描述重复的部分）。
      noContextFiles: false,
      // 技能清单不常驻（省 5,519）：SKILL.md 仍在盘上，按 persona 指针 ls + read 可达。
      // 注意 noSkills ≠ 关闭技能通道 —— 它表示「只加载显式指定的」，正文仍可 read / 触发。
      noSkills: true,
      noPromptTemplates: true,
      appendSystemPromptOverride: () => [],
    });
    await slimLoader.reload();

    const result = await createAgentSession({
      cwd: effCwd,
      // 打开已有会话：用会话文件里记的模型（SDK 自动恢复，每会话独立）；新会话用连接默认模型
      model: effSessionFile ? undefined : connModel,
      resourceLoader: slimLoader,
      sessionManager,
      authStorage,
      modelRegistry,
      tools: FULL_TOOLS, // 注册全量（simple 也注册全量，创建后立刻缩小锚定；subagent 由 pi 扩展注册）
      customTools, // 两边都注册；simple 首轮仅 bash/edit 激活，解锁后才暴露
    });
    const handle = {
      session: result.session,
      cwd: effCwd,
      running: false,
      modelFallbackMessage: result.modelFallbackMessage,
      wakeups: new Set(),
      unsubscribe: null,
    };
    setArtifactTarget(handle);
    // 工具面起手：所有模式统一给核心集（13 个，含 load_toolkit）。
    // 历史遗留的「simple 首轮无工具锚定 + band 解锁」已移除 —— 它服务于已失效的 We 起手实验；
    // 窄工具面用 TOOLKIT_CORE 起手即可，其余由 load_toolkit 按需解锁。
    try { handle.session.setActiveToolsByName(TOOLKIT_CORE); } catch {}
    handle.unsubscribe = handle.session.subscribe((event) => {
      // 所有模式统一保持核心集起手（TOOLKIT_CORE），不做「首次调用后全量放开」。
      // 需要更多工具时由模型判断后调 load_toolkit 解锁对应组（tools/toolkit-loader.js）。
      // bash 超时 watchdog：长跑命令挂死（子进程不退出，stdout 不关）自动中止，避免前端永久卡在运行中
      // 只盯 bash：worker/research 单次调用可能跑很久（多轮/节点任务），误杀不值得
      if (event?.type === "tool_execution_start" && event.toolName === "bash") {
        const timer = setTimeout(() => {
          toolWatch.delete(event.toolCallId);
          send({ type: "error", message: `工具「${event.toolName}」执行超过 ${TOOL_TIMEOUT_MS / 1000}s，已自动中止（命令可能挂死）` });
          handle.session.abort().catch(() => {});
        }, TOOL_TIMEOUT_MS);
        toolWatch.set(event.toolCallId, timer);
      } else if (event?.type === "tool_execution_end") {
        const timer = toolWatch.get(event.toolCallId);
        if (timer) {
          clearTimeout(timer);
          toolWatch.delete(event.toolCallId);
        }
      }
      // bash 实时输出：SDK 发全量快照（100ms 节流），转增量推前端（前端按 tool:callId 累加显示，干活过程可见）
      if (event?.type === "tool_execution_update" && event.toolCallId) {
        const text = toolUpdateText(event.partialResult);
        const prev = bashSnapshots.get(event.toolCallId) ?? "";
        const delta = text.startsWith(prev) ? text.slice(prev.length) : text; // 截断重置时发全量
        bashSnapshots.set(event.toolCallId, text);
        if (delta && handle.session.sessionId === activeId) send({ type: "bash_progress", toolCallId: event.toolCallId, delta });
        return; // 原始 tool_execution_update 不转发（前端只用 bash_progress）
      }
      // running 跟踪：后台会话也记（切回时补发 agent_start 恢复前端 busy）
      if (event?.type === "agent_start") handle.running = true;
      else if (event?.type === "agent_end") handle.running = false;
      // 事件只转发 active 句柄：后台会话的事件不污染当前视图
      if (handle.session.sessionId !== activeId) return;
      try {
        // 折叠由前端按 agent 回合（agent_start/agent_end + busy）判定，后端不做正文判定
        send({ event });
      } catch {
        // 个别事件字段不可序列化，跳过（客户端按类型自取所需）
      }
      // Artifact（会话级）：write 工具写出的交付物 → 持久到会话 + 推送前端（与 worker 节点产物、CWD watcher 合并）
      // 只收交付物（isArtifact：句柄 cwd 内 + 扩展名白名单）；.py/.csv 脚本与中间数据不收
      // 归属首次会话：文件已登记过（首次写出在其他会话）→ 不重复登记，避免同一产物出现在多个会话
      if (event?.type === "tool_execution_start" && event.toolName === "write" && event.args?.path) {
        setArtifactTarget(handle); // watcher/write 共用登记目标
        registerArtifact(String(event.args.path), { allowOutsideCwd: true }); // write 产物豁免 cwd（模型可能写到实际工作区）
      }
    });
    handles.set(handle.session.sessionId, handle);
    return handle;
  };

  // 激活 = 切换视图：ready + 历史重放（活句柄用内存态，不重开文件）。
  // 若句柄仍在跑（后台期间未结束），补发合成 agent_start → 前端 busy 恢复为 true
  const activate = async (handle) => {
    activeId = handle.session.sessionId;
    send({
      type: "ready",
      sessionId: handle.session.sessionId,
      sessionFile: handle.session.sessionFile,
      cwd: handle.cwd,
      modelFallbackMessage: handle.modelFallbackMessage,
    });
    // 重放历史：切换/恢复会话后前端需要看到既有消息（后台会话的新消息也在内存态里）
    try {
      // 分支按钮数据源：每条消息对应 sessionManager 里的一条 message entry（按序 zip，不匹配则无 entryId）
      // 重放 zip 对齐：entries 里 toolResult 也是 message 类型，混入会让线性 zip 错位
      // （history 只保留 user/assistant）→ 后面每条消息拿到的 entryId 偏早，分支点提前。
      // 必须两边都只保留 user/assistant 再按序配对。
      const msgEntries = (handle.session.sessionManager.getEntries?.() ?? [])
        .filter((e) => e.type === "message" && (e.message?.role === "user" || e.message?.role === "assistant"));
      let historyMi = 0;
      const history = (handle.session.agent.state.messages ?? [])
        // 重放 user/assistant 文本 + 工具调用为 activity 条目（历史会话也能看到工具执行）
        // toolResult 不单独渲染（与对应 toolCall 折叠，同实时会话的合并逻辑）
        .filter((m) => m.role === "user" || m.role === "assistant")
        .flatMap((m) => {
          const entryId = (msgEntries[historyMi] ?? {}).id;
          historyMi += 1;
          const parts = Array.isArray(m.content) ? m.content : [];
          const text = parts.filter((p) => p?.type === "text").map((p) => p.text).join("");
          const thinking = parts.filter((p) => p?.type === "thinking").map((p) => p.thinking ?? "").join("");
          const base = {
            role: m.role === "user" ? "user" : "assistant",
            text,
            thinking,
            time: Date.now(),
            entryId,
          };
          // assistant 消息里的工具调用 → 独立 activity 条目（status done）
          const tools = (parts.filter((p) => p?.type === "toolCall") ?? []).map((p) => ({
            role: "activity",
            text: p.name ?? "工具调用",
            toolName: p.name,
            args: p.arguments,
            status: "done",
            time: Date.now(),
          }));
          return tools.length ? [base, ...tools] : [base];
        })
        .map((m, i) => ({ id: m.entryId ?? `hist:${i}`, ...m }));
      send({ type: "history", messages: history });
    } catch {
      // 个别消息不可序列化时跳过历史重放
    }
    if (handle.running) send({ event: { type: "agent_start" } });
  };

  // open 串行化：连接建立时的首次 open（续旧会话）可能未完成时 new_session 就到了，
  // 并发执行会互相覆盖 activeId（竞态：旧 open 晚完成把视图切回旧会话）
  let openChain = Promise.resolve();
  const open = (opts) => { const r = openChain.then(() => openHandle(opts)); openChain = r.catch(() => {}); return r; };
  // 会话被移动后：作废旧句柄并从新位置重开（旧句柄继续写已删文件会双写/丢数据）
  const reopenAfterMove = (moved, targetFile) => {
    try { clearWakeups(moved); disposeWorkerSession(moved.session.sessionId); moved.unsubscribe?.(); moved.session.dispose(); } catch {}
    handles.delete(moved.session.sessionId);
    if (activeId === moved.session.sessionId) activeId = null;
    open({ sessionFile: targetFile }).then(activate).catch((err) => send({ type: "error", message: String(err?.message ?? err) }));
  };

  // 连接建立：续最近会话（原行为保留；此后切换/新建都是加句柄，不杀旧会话）
  // 加固：续会话失败（会话文件被移动/删除等）时降级为新建，避免卡在「无活跃会话」——
  // 否则前端看起来已就绪，但任何操作（含 /model、简单模式按钮）都静默失效。
  await open({})
    .then(activate)
    .catch(async (err) => {
      const why = String(err?.message ?? err);
      console.warn("[open] 续最近会话失败，降级为新建会话：", why);
      send({ type: "error", message: `续最近会话失败（${why}），已自动新建会话` });
      try {
        await open({ fresh: true }).then(activate);
      } catch (err2) {
        send({ type: "error", message: `新建会话也失败：${String(err2?.message ?? err2)}` });
      }
    });

  ws.on("message", async (raw) => {
    ensureSubagent(); // 扩展已随会话创建加载，此时订阅取证员心跳
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "prompt": {
        const h = activeHandle(); if (!h) break;
        // user 消息保持纯净：系统指令只走 system prompt（曾拼进 user → 反刍提示词/自问自答）
        const text = msg.text;
        // 不 await：让 abort/steer 在流式期间仍能进来
        h.session
          .prompt(text, { streamingBehavior: "steer" })
          .catch((err) => send({ type: "error", message: String(err?.message ?? err) }));
        break;
      }
      case "steer": {
        const h = activeHandle(); if (!h) break;
        h.session.steer(msg.text).catch((err) => send({ type: "error", message: String(err?.message ?? err) }));
        break;
      }
      case "followUp": {
        const h = activeHandle(); if (!h) break;
        h.session.followUp(msg.text).catch((err) => send({ type: "error", message: String(err?.message ?? err) }));
        break;
      }
      case "abort": {
        const h = activeHandle(); if (!h) break;
        h.session.abort().catch((err) => send({ type: "error", message: String(err?.message ?? err) }));
        break;
      }
      case "new_session":
        // 旧会话不 dispose：后台继续跑（多会话并行）；worker/wakeup 归属各自句柄，无需清理
        if (msg.cwd) registerProject(msg.cwd); // 选文件夹开项目会话 → 登记为项目
        activeId = null; // 先静音：旧会话尾部事件不再转发，避免污染新会话视图
        open({ fresh: true, cwd: msg.cwd }).then(async (h) => {
          if (msg.cwd) {
            // 项目新会话立即写盘：否则 get_sidebar 在 ready 后看不到它，侧栏项目下永远是 0
            // ponytail: 调私有 _rewriteFile（与 branch 同款），SDK 升级后若自动写盘可删。
            // 必须同步置 flushed=true：否则首个 assistant 回复走 wx 创建分支会撞已存在文件（EEXIST）
            try {
              const sm = h.session.sessionManager;
              sm._rewriteFile();
              sm.flushed = true;
            } catch {}
          }
          await activate(h);
        }).catch((err) => send({ type: "error", message: String(err?.message ?? err) }));
        break;
      case "create_project": {
        // 侧边栏新建项目：登记（可自定义名）；前端收到后自己 refreshSidebar
        const cwd = String(msg.cwd || "").trim();
        if (!cwd) {
          send({ type: "error", message: "项目路径不能为空" });
          break;
        }
        registerProject(cwd, String(msg.name || "").trim() || undefined);
        send({ type: "project_created" });
        break;
      }
      case "delete_project": {
        // 项目删除：从注册表移除；其下会话移回「最近聊天」（不删磁盘文件），避免历史会话从侧边栏消失
        try {
          const cwd = path.resolve(String(msg.cwd || ""));
          const defaultCwd = path.resolve(CWD);
          const projects = loadProjects();
          if (!projects.some((p) => path.resolve(p.cwd) === cwd)) throw new Error("项目不存在");
          for (const s of await SessionManager.list(cwd)) {
            try {
              const { targetFile, sessionId } = moveSessionFile(s.path, defaultCwd);
              const moved = [...handles.values()].find((h) => h.session.sessionId === sessionId);
              if (moved) reopenAfterMove(moved, targetFile);
            } catch (err) {
              console.warn(`[delete_project] 会话未移动，跳过 ${s.path}: ${err?.message ?? err}`);
            }
          }
          saveProjects(projects.filter((p) => path.resolve(p.cwd) !== cwd));
          send({ type: "project_deleted", cwd });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "switch_session": {
        // 目标会话已在活句柄里（后台跑着）→ 直接激活，绝不重开同一文件（同文件双写会互相覆盖）
        activeId = null;
        const liveHandle = [...handles.values()].find((h) => h.session.sessionFile === String(msg.sessionFile || ""));
        if (liveHandle) {
          activate(liveHandle).catch((err) => send({ type: "error", message: String(err?.message ?? err) }));
          break;
        }
        const targetFile = String(msg.sessionFile || "");
        open({ sessionFile: targetFile }).then(activate).catch((err) => send({ type: "error", message: String(err?.message ?? err) }));
        break;
      }
      case "rename_session": {
        // 会话改名：显示名覆盖（持久化，前端收到 session_renamed 后重拉 sidebar）
        try {
          const id = String(msg.sessionId || "").trim();
          if (!id) throw new Error("会话 id 不能为空");
          const name = String(msg.name ?? "").trim();
          const names = loadSessionNames();
          if (name) names[id] = name;
          else delete names[id];
          writeFileSync(SESSION_NAMES_FILE, JSON.stringify(names, null, 2));
          send({ type: "session_renamed", sessionId: id, name });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "list_sessions": {
        // 会话列表（侧边栏数据源，可按项目 cwd 过滤）
        try {
          const list = await SessionManager.list(String(msg.cwd || CWD));
          send({ type: "sessions", sessions: list.map(toSessionInfo) });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "get_sidebar": {
        // 侧边栏全量：项目（注册表驱动）+ 最近聊天（默认 CWD 的未归属会话）
        try {
          const defaultCwd = path.resolve(CWD);
          const projects = [];
          for (const p of loadProjects()) {
            if (path.resolve(p.cwd) === defaultCwd) continue;
            const list = await SessionManager.list(p.cwd);
            const items = list.map(toSessionInfo);
            projects.push({
              cwd: p.cwd,
              name: p.name || p.cwd.split(/[\\/]/).pop() || p.cwd,
              modified: items.reduce((mx, s) => (s.modified > mx ? s.modified : mx), ""),
              sessionCount: items.length,
              sessions: items,
            });
          }
          projects.sort((a, b) => b.modified.localeCompare(a.modified));
          const recent = (await SessionManager.list(CWD)).map(toSessionInfo);
          send({ type: "sidebar", sidebar: { projects, recent } });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "move_session": {
        // 拖拽改归属：改 JSONL header.cwd → 移文件到目标项目目录（agent 工作目录跟着 header 走）
        try {
          const sessionFile = String(msg.sessionFile || "");
          const targetCwd = String(msg.cwd || "");
          const target = path.resolve(targetCwd);
          // 目标：已注册项目，或默认 CWD（拖回「最近聊天」= 取消归属）
          const ok = target === path.resolve(CWD) || loadProjects().some((p) => path.resolve(p.cwd) === target);
          if (!ok) throw new Error("目标不是已注册项目");
          const { targetFile, sessionId } = moveSessionFile(sessionFile, target);
          send({ type: "session_moved", sessionFile, cwd: targetCwd, targetFile });
          // 移动的是某活句柄的会话：从新位置重开（旧句柄作废），否则后续追加写到已删文件
          const moved = [...handles.values()].find((h) => h.session.sessionId === sessionId);
          if (moved) reopenAfterMove(moved, targetFile);
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "delete_session": {
        // 删除某活句柄的会话：先作废句柄（dispose），再删文件，避免句柄继续写已删文件
        const victim = [...handles.values()].find((h) => h.session.sessionFile === String(msg.sessionFile || ""));
        if (victim) {
          try { clearWakeups(victim); disposeWorkerSession(victim.session.sessionId); victim.unsubscribe?.(); victim.session.dispose(); } catch {}
          handles.delete(victim.session.sessionId);
          if (activeId === victim.session.sessionId) activeId = null;
        }
        try {
          unlinkSync(String(msg.sessionFile || ""));
          send({ type: "session_deleted", sessionFile: msg.sessionFile });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "get_skills": {
        // Skill 列表：pi ResourceLoader 原生（name/description/filePath/disableModelInvocation/sourceInfo）
        try {
          const list = await skillCatalog(activeHandle()?.cwd ?? CWD);
          const skills = list.map((s) => ({
            name: s.name,
            description: s.description,
            filePath: s.filePath,
            baseDir: s.baseDir,
            source: s.source,
            disableModelInvocation: !!s.disableModelInvocation,
            sourceInfo: s.sourceInfo ?? {},
          }));
          send({ type: "skills", skills });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "set_skill_disabled": {
        // 启用/禁用 = 改 SKILL.md frontmatter 的 disable-model-invocation（搬旧 setDisableModelInvocation）
        try {
          const name = String(msg.name || "");
          const disabled = !!msg.disabled;
          const skillsResult2 = await skillCatalog(activeHandle()?.cwd ?? CWD);
          const skill = skillsResult2.find((s) => s.name === name);
          if (!skill?.filePath) {
            send({ type: "error", message: `未找到 skill: ${name}` });
            break;
          }
          const raw = readFileSync(skill.filePath, "utf8");
          writeFileSync(skill.filePath, setDisableModelInvocation(raw, disabled));
          send({ type: "skill_toggled", name, disabled });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "read_artifact": {
        // 文件预览（artifactPreview：document/image/audio）：cwd 内文件 + 本会话登记过的文件都放行
        // （会话文件面板现在会显示 cwd 外的写入，如 .pi 技能/跨 workspace 路径——预览必须跟着放行）
        try {
          const raw = String(msg.path ?? "");
          const base = activeHandle()?.cwd ?? CWD;
          const entries = activeHandle()?.session?.sessionManager?.getEntries?.() || [];
          // 本会话登记过的所有文件路径（与 get_artifacts 同口径），预览只对它们+cwd 开放，防任意路径探读
          const registered = new Set();
          for (const e of entries) {
            if (e.type === "custom" && (e.customType === "session_file" || e.customType === "session_artifact") && e.data?.path) {
              registered.add(String(e.data.path));
            }
            if (e.type === "custom" && e.customType === "node_output" && Array.isArray(e.data?.artifacts)) {
              for (const a of e.data.artifacts) registered.add(String(a));
            }
            if (e.type === "message" && Array.isArray(e.message?.content)) {
              for (const p of e.message.content) {
                if (p?.type === "toolCall" && p.name === "write" && p.arguments?.path) registered.add(String(p.arguments.path));
              }
            }
          }
          // 路径可能是绝对路径（worker write 原样记录）或相对路径，解析后统一校验
          const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(base, raw);
          const inCwd = abs === path.resolve(base) || abs.startsWith(path.resolve(base) + path.sep);
          const isRegistered = [...registered].some((p) => {
            const ap = path.isAbsolute(p) ? path.resolve(p) : path.resolve(base, p);
            return ap === abs;
          });
          if (!inCwd && !isRegistered) {
            send({ type: "error", message: "路径越界" });
            break;
          }
          const full = abs;
          const ext = path.extname(full).toLowerCase().slice(1);
          const isImg = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
          const isAudio = ["mp3", "wav", "m4a", "ogg"].includes(ext);
          const buf = readFileSync(full);
          send({
            type: "artifact_content",
            path: String(msg.path ?? ""), // 原样回传，前端按请求路径匹配 pending
            kind: isImg ? "image" : isAudio ? "audio" : "text",
            data: isImg || isAudio ? buf.toString("base64") : buf.toString("utf8"),
            ext,
          });
        } catch (err) {
          send({ type: "error", message: `读取产物失败：${String(err?.message ?? err)}` });
        }
        break;
      }
      case "get_graph": {
        // 画布数据：最新 node_graph + 该 run 的 node_output（前端 refreshGraph 的响应）
        try {
          const entries = activeHandle()?.session?.sessionManager?.getEntries?.() || [];
          const graphs = entries.filter((e) => e.type === "custom" && e.customType === "node_graph").map((e) => e.data);
          const outputs = entries.filter((e) => e.type === "custom" && e.customType === "node_output").map((e) => e.data);
          const latest = graphs[graphs.length - 1] ?? null;
          const runScoped = latest?.runId
            ? outputs.filter((o) => (o?.runId ?? null) === latest.runId)
            : [];
          // 容错：旧输出无 runId（或匹配为空）时，按 nodeId 取最近一条——UI 显示该图节点最新产出
          const source = runScoped.length > 0 ? runScoped : outputs;
          const byNode = new Map();
          for (const o of source) byNode.set(o?.nodeId, o);
          send({ type: "graph", graph: latest, outputs: [...byNode.values()] });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "list_runs": {
        // workflow 目录：runId/标题/各节点进度。主 agent 续接时的精确断点依据（不塞进程上下文的持久清单）
        try {
          const entries = activeHandle()?.session?.sessionManager?.getEntries?.() || [];
          const graphs = entries.filter((e) => e.type === "custom" && e.customType === "node_graph").map((e) => e.data);
          const outputs = entries.filter((e) => e.type === "custom" && e.customType === "node_output").map((e) => e.data);
          const runs = graphs.map((g) => {
            const nodeIds = (g?.nodes ?? []).map((n) => n.id);
            const runOutputs = g?.runId ? outputs.filter((o) => (o?.runId ?? null) === g.runId) : outputs.slice(0, nodeIds.length);
            const done = new Set(runOutputs.map((o) => o?.nodeId).filter(Boolean));
            const schedule = (g?.nodes ?? []).map((n) => ({ id: n.id, name: n.name, type: n.type, deps: n.deps || [], output: n.output, status: done.has(n.id) ? "done" : "pending" }));
            return {
              runId: g.runId ?? null,
              title: g.title ?? g?.nodes?.[0]?.name ?? "任务",
              created: g.created ?? null,
              successCriteria: g.successCriteria ?? [],
              nodes: schedule,
              next: schedule.find((n) => n.status === "pending")?.id ?? null,
            };
          });
          send({ type: "runs", runs });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "get_models": {
        // 模型目录（API/模型配置面板数据源）：可用模型 + 各 provider 是否已配认证
        try {
          const models = modelRegistry.getAvailable().map((m) => ({
            provider: m.provider,
            id: m.id,
            name: m.name,
            reasoning: !!m.reasoning,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
            hasAuth: authStorage.hasAuth(m.provider),
          }));
          // 按 provider 分组，返回 provider 列表 + 模型列表
          const byProvider = new Map();
          for (const m of models) {
            if (!byProvider.has(m.provider)) byProvider.set(m.provider, { provider: m.provider, hasAuth: m.hasAuth, models: [] });
            const p = byProvider.get(m.provider);
            p.hasAuth = p.hasAuth || m.hasAuth;
            p.models.push({ id: m.id, name: m.name, reasoning: m.reasoning, contextWindow: m.contextWindow, maxTokens: m.maxTokens });
          }
          send({ type: "models", providers: [...byProvider.values()] });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "set_model": {
        // /model <关键词>：子串匹配 provider 或模型 id，命中第一个（336 个模型打字记不住全名，模糊匹配够用）
        try {
          const query = String(msg.query || "").trim().toLowerCase();
          if (!query) {
            send({ type: "error", message: "用法：/model <关键词>（匹配 provider 或模型名子串）" });
            break;
          }
          const hit = modelRegistry.getAvailable().find((m) => m.id.toLowerCase().includes(query) || m.provider.toLowerCase().includes(query));
          if (!hit) {
            send({ type: "error", message: `未找到匹配「${msg.query}」的模型（可用模型见 API 面板）` });
            break;
          }
          connModel = hit; // 本连接 new_session 沿用（setModel 内部写 model_change 条目 + 持久化默认模型）
          await activeHandle()?.session.setModel(hit);
          send({ type: "model_changed", provider: hit.provider, id: hit.id });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "compact": {
        // /compact [说明]：手动触发会话压缩（SDK 原生，compaction_start/end 事件流自动推前端）
        try {
          await activeHandle()?.session.compact(String(msg.note ?? "").trim() || undefined);
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "set_queue": {
        // /queue on|off：多条输入排队（steering+followUp 都开 all 才真排队）
        const h = activeHandle(); if (!h) break;
        const enabled = msg.enabled !== false;
        h.session.setSteeringMode(enabled ? "all" : "one-at-a-time");
        h.session.setFollowUpMode(enabled ? "all" : "one-at-a-time");
        break;
      }
      case "branch": {
        // 从某条消息分支：复制根→该消息的路径为独立会话文件，并切过去（原会话不动）
        try {
          const entryId = String(msg.entryId || "");
          if (!entryId) {
            send({ type: "error", message: "需要分支点的消息 id" });
            break;
          }
          const h = activeHandle();
          if (!h) break;
          const file = h.session.sessionManager.createBranchedSession(entryId);
          if (!file) {
            send({ type: "error", message: "分支失败：会话未持久化" });
            break;
          }
          // SDK 契约：分支文件含 assistant 消息才立即写盘（否则 defer 到首次回复）。
          // 分支点及之前全是 user 消息时文件未落盘 → open 读不到；ponytail: 调私有 _rewriteFile 强制写盘，
          // 升级 SDK 时若 createBranchedSession 已自动写盘，此行可删（existsSync 短路）
          const sm0 = h.session.sessionManager;
          if (!existsSync(file)) {
            sm0._rewriteFile();
            sm0.flushed = true; // 同 new_session：强制写盘后必须标记已落盘，否则首条 assistant 回复 EEXIST
          }
          activeId = null; // 分支 = 新句柄 + 激活；原会话继续后台跑
          // 分支继承原会话模型（SDK 随会话文件自带，无需再切）
          await open({ sessionFile: file }).then(activate);
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "set_api_key": {
        // 设置 provider 的 API key（AuthStorage 持久化，跨会话生效）
        try {
          const provider = String(msg.provider || "");
          const apiKey = String(msg.apiKey || "");
          if (!provider || !apiKey) {
            send({ type: "error", message: "需要 provider 和 apiKey" });
            break;
          }
          authStorage.set(provider, { type: "apiKey", apiKey });
          modelRegistry.refresh?.();
          send({ type: "api_key_set", provider });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "get_artifacts": {
        // 会话文件 + 交付物子集：写过的文件都可见（不被隐藏目录/扩展名白名单藏起来）
        try {
          const h = activeHandle();
          const entries = h?.session?.sessionManager?.getEntries?.() || [];
          const base = h?.cwd ?? CWD;
          const sessionFiles = new Set();
          const artifacts = new Set();
          // 旧条目 node_output 无 nodeType 时，从 node_graph 按 runId:nodeId 反查节点类型（判定保持不降级）
          const typeByNode = new Map();
          for (const g of entries.filter((e) => e.type === "custom" && e.customType === "node_graph").map((e) => e.data)) {
            for (const n of g?.nodes ?? []) typeByNode.set(`${g.runId}:${n.id}`, n.type);
          }
          // 归属过滤移除：产物按会话各自 entries 显示，不跨会话锁（幽灵 origin 曾锁死旧会话产物）
          const ownsArtifact = () => true;
          for (const e of entries) {
            // 全部登记过的会话文件（含非白名单/隐藏路径，如 .pi/skills 与显式 register_artifact）
            if (e.type === "custom" && (e.customType === "session_file" || e.customType === "session_artifact") && e.data?.path) {
              sessionFiles.add(String(e.data.path));
            }
            // 兜底重滤：旧会话可能存过未过滤的条目（判定函数升级前），统一按当前规则过滤
            if (e.type === "custom" && e.customType === "session_artifact" && e.data?.path && isArtifact(String(e.data.path), { cwd: base, allowOutsideCwd: true }) && ownsArtifact(String(e.data.path))) {
              artifacts.add(String(e.data.path));
            }
            if (e.type === "custom" && e.customType === "node_output" && Array.isArray(e.data?.artifacts)) {
              for (const a of e.data.artifacts) {
                sessionFiles.add(String(a));
                const nodeType = e.data?.nodeType ?? typeByNode.get(`${e.data?.runId}:${e.data?.nodeId}`);
                if (isArtifact(String(a), { cwd: base, nodeType }) && ownsArtifact(String(a))) artifacts.add(String(a));
              }
            }
            // 兜底：主会话 write 工具写出的文件（早期会话未登记 session_artifact，从 toolCall 参数反查）
            if (e.type === "message" && Array.isArray(e.message?.content)) {
              for (const p of e.message.content) {
                if (p?.type === "toolCall" && p.name === "write" && p.arguments?.path) {
                  const wp = String(p.arguments.path);
                  sessionFiles.add(wp);
                  if (isArtifact(wp, { cwd: base, allowOutsideCwd: true }) && ownsArtifact(wp)) artifacts.add(wp);
                }
              }
            }
          }
          send({ type: "artifacts", artifacts: [...artifacts], sessionFiles: [...sessionFiles] });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "set_custom_provider": {
        // 自定义 OpenAI 兼容端点（入口弹窗）：写 ~/.pi/agent/models.json，主模型切到它（未显式 MAIN_MODEL 时）
        try {
          const provider = String(msg.provider || "custom");
          const baseUrl = String(msg.baseUrl || "");
          const apiKey = String(msg.apiKey || "");
          const modelId = String(msg.modelId || "");
          if (!baseUrl || !apiKey || !modelId) {
            send({ type: "error", message: "需要请求地址、API Key 和模型 ID" });
            break;
          }
          const modelsPath = path.join(os.homedir(), ".pi", "agent", "models.json");
          const existing = existsSync(modelsPath) ? JSON.parse(readFileSync(modelsPath, "utf8")) : { providers: {} };
          existing.providers = existing.providers ?? {};
          existing.providers[provider] = {
            baseUrl,
            api: "openai-completions",
            apiKey,
            models: [{ id: modelId, name: modelId }],
          };
          writeFileSync(modelsPath, JSON.stringify(existing, null, 2));
          authStorage.set(provider, { type: "apiKey", apiKey }); // 双写：hasAuth 判定用
          modelRegistry.refresh?.();
          if (!process.env.MAIN_MODEL) {
            const m = modelRegistry.find(provider, modelId);
            if (m) mainModel = m;
          }
          send({ type: "api_key_set", provider });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "list_templates": {
        // 模板库：列出 templates/ 下的已保存节点图（名称/节点数/创建时间）
        try {
          if (!existsSync(TEMPLATES_DIR)) mkdirSync(TEMPLATES_DIR, { recursive: true });
          const items = readdirSync(TEMPLATES_DIR)
            .filter((f) => f.endsWith(".json"))
            .map((f) => {
              try {
                const d = JSON.parse(readFileSync(path.join(TEMPLATES_DIR, f), "utf8"));
                return { file: f, title: d.title ?? f.replace(/\.json$/, ""), nodeCount: d.nodes?.length ?? 0, saved: d.saved ?? null };
              } catch {
                return { file: f, title: f.replace(/\.json$/, ""), nodeCount: 0, saved: null };
              }
            });
          send({ type: "templates", templates: items });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "save_template": {
        // 把当前 session 最新的 node_graph 存为模板（去 runId，保存时打时间戳）
        try {
          const title = String(msg.title || "未命名");
          const entries = activeHandle()?.session?.sessionManager?.getEntries?.() || [];
          const latest = [...entries].reverse().find((e) => e.type === "custom" && e.customType === "node_graph");
          if (!latest?.data?.nodes) {
            send({ type: "error", message: "当前会话还没有节点图可存" });
            break;
          }
          const { runId, created, ...clean } = latest.data; // 去掉运行态字段
          if (!existsSync(TEMPLATES_DIR)) mkdirSync(TEMPLATES_DIR, { recursive: true });
          const fileName = `${String(title).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "template"}_${Date.now()}.json`;
          writeFileSync(path.join(TEMPLATES_DIR, fileName), JSON.stringify({ ...clean, title, saved: Date.now() }, null, 2));
          send({ type: "template_saved", file: fileName });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
      case "load_template": {
        // 从模板库载入节点图 → followUp 喂给主 agent 执行
        try {
          const file = String(msg.file || "");
          const full = path.join(TEMPLATES_DIR, file);
          if (!existsSync(full)) {
            send({ type: "error", message: "模板不存在" });
            break;
          }
          const t = JSON.parse(readFileSync(full, "utf8"));
          const inst = JSON.stringify({ ...t, runId: randomUUID(), title: t.title ?? "模板任务", created: Date.now() });
          await activeHandle()?.session?.followUp("[模板执行] 请按以下节点图 JSON 执行任务：\n" + inst).catch((e) => send({ type: "error", message: String(e?.message ?? e) }));
          send({ type: "template_loaded", file });
        } catch (err) {
          send({ type: "error", message: String(err?.message ?? err) });
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    // 连接关闭：全部句柄作废（含后台会话），各自清 worker/wakeup
    for (const h of handles.values()) {
      try { clearWakeups(h); } catch {}
      try { disposeWorkerSession(h.session.sessionId); } catch {}
      try { h.unsubscribe?.(); } catch {}
      try { h.session.dispose(); } catch {}
    }
    handles.clear();
  });

  // 节点实时心跳：worker 工具广播 → 该客户端；切会话时旧连接已 close，无所谓
  const unsubProgress = nodeProgressEmitter.on((evt) => send({ type: "node_progress", ...evt }));
  // 研究进度：research 工具轮次/心跳广播 → 该客户端（与 node_progress 同构）
  const unsubResearch = researchProgressEmitter.on((evt) => send({ type: "research_progress", ...evt }));
  // 取证员心跳：subagent 扩展子进程 text_delta → 该客户端（key = tool:<toolCallId>:<index>）
  // 惰性订阅：扩展在 createAgentSession 时才加载（__piV2SubagentEmitter 此时才存在），每个消息进来 ensure 一次
  let subagentHandler = null;
  const ensureSubagent = () => {
    const em = globalThis.__piV2SubagentEmitter;
    if (em && !subagentHandler) {
      subagentHandler = (evt) => send({ type: "subagent_progress", ...evt });
      em.on("progress", subagentHandler);
    }
  };
  ensureSubagent();
  const unsubSubagent = () => {
    if (subagentHandler) {
      globalThis.__piV2SubagentEmitter?.off?.("progress", subagentHandler);
      subagentHandler = null;
    }
  };
  // 搜索结构事件：sources → 前端展开区（favicon + 网页列表）
  const unsubSearchRes = searchResultsEmitter.on((evt) => send({ type: "search_results", ...evt }));
  ws.on("close", () => { unsubProgress(); unsubResearch(); unsubSubagent(); unsubSearchRes(); });
});

httpServer.listen(PORT, () => {
  cleanupTempSessions();
  startArtifactWatcher(); // server 级资源，不依赖连接
  console.log(`pi-agent-v2 backend on ws://localhost:${PORT} (cwd: ${CWD})`);
});
