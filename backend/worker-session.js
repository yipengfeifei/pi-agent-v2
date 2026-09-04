// worker 常驻会话：in-memory + 上下文替换实现"节点干净上下文"
// 隔离机制（已实测验证）：每节点执行前替换 agent.state.messages，
// 模型只见本次注入的物料/skill/prompt，不累积、不见主会话历史
import { AuthStorage, ModelRegistry, SessionManager, createAgentSession } from "@earendil-works/pi-coding-agent";
import { httpRequestTool, appSnapshotTool } from "./tools/runtime-tools.js";
import { searchTool } from "./tools/search.js";
import { browserTool } from "./tools/browser.js";
import { siteMemoryTool } from "./tools/site-memory.js";
import { isArtifact } from "./artifacts.js";

// 每父会话一个 worker 常驻会话：多会话并行时各跑各的节点，互不共享状态/队列
// ponytail: 锁粒度从全局降到父会话级——同一父会话同一时刻只跑一个节点，不同父会话并行
const workerSessions = new Map(); // key(父 sessionId) -> worker session
const queues = new Map(); // key -> 串行队列（防同父会话节点互相踩上下文）

// 弱模型优先级（便宜 + 支持工具调用）；环境变量 WORKER_MODEL="provider/id" 可覆盖
const WORKER_MODEL_PREFERENCE = [
  "opencode-go/deepseek-v4-flash",
  "openai/gpt-5.4-nano",
  "openai/gpt-5-nano",
  "openai/gpt-4.1-nano",
];

async function pickWorkerModel(mr) {
  const explicit = process.env.WORKER_MODEL;
  if (explicit) {
    const [provider, id] = explicit.split("/");
    const m = mr.find(provider, id);
    if (m) return m;
  }
  const avail = await mr.getAvailable();
  for (const key of WORKER_MODEL_PREFERENCE) {
    const [provider, id] = key.split("/");
    const found = avail.find((m) => m.provider === provider && m.id === id);
    if (found) return mr.find(found.provider, found.id);
  }
  return null; // 回退默认模型
}

export async function getWorkerSession({ cwd, key }) {
  const k = key ?? cwd;
  if (workerSessions.has(k)) return workerSessions.get(k);
  const auth = AuthStorage.create();
  const mr = ModelRegistry.create(auth);
  const model = await pickWorkerModel(mr);
  const { session } = await createAgentSession({
    cwd,
    model,
    sessionManager: SessionManager.inMemory(),
    authStorage: auth,
    modelRegistry: mr,
    tools: ["read", "bash", "write", "grep", "find", "ls", "http_request", "execution_app_snapshot", "search", "site_memory", "browser"],
    customTools: [httpRequestTool, appSnapshotTool, searchTool, siteMemoryTool, browserTool],
  });
  workerSessions.set(k, session);
  return session;
}

// 一次性隔离会话：subagent 并发用（每个任务独立会话，不撞互斥锁）
export async function createIsolatedSession({ cwd, systemBlock, materialsBlock }) {
  const auth = AuthStorage.create();
  const mr = ModelRegistry.create(auth);
  const model = await pickWorkerModel(mr);
  const { session } = await createAgentSession({
    cwd,
    model,
    sessionManager: SessionManager.inMemory(),
    authStorage: auth,
    modelRegistry: mr,
    tools: ["read", "bash", "write", "grep", "find", "ls", "http_request", "execution_app_snapshot", "search", "site_memory", "browser"],
    customTools: [httpRequestTool, appSnapshotTool, searchTool, siteMemoryTool, browserTool],
  });
  try {
    session.agent.state.messages = [
      { role: "user", content: [{ type: "text", text: systemBlock }] },
      { role: "user", content: [{ type: "text", text: materialsBlock }] },
    ];
    let text = "";
    const unsub = session.subscribe((e) => {
      if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
        text += e.assistantMessageEvent.delta;
      }
    });
    try {
      await session.prompt("请执行上述任务。完成后给出最终结果；如果材料不足或无法完成，明确说明原因。");
    } finally {
      unsub();
    }
    return text.trim();
  } finally {
    session.dispose();
  }
}

export async function runNode({ cwd, systemBlock, materialsBlock, onProgress, nodeType, key }) {
  const k = key ?? cwd;
  const task = (queues.get(k) ?? Promise.resolve()).then(async () => {
    const session = await getWorkerSession({ cwd, key: k });
    // 干净上下文 = 替换，不是追加
    session.agent.state.messages = [
      { role: "user", content: [{ type: "text", text: systemBlock }] },
      { role: "user", content: [{ type: "text", text: materialsBlock }] },
    ];
    let text = "";
    // 产物文件收集：节点执行期间用 write 工具写的文件路径（Artifact 条数据源）
    const artifacts = new Set();
    const unsub = session.subscribe((e) => {
      // 产物只收交付物（isArtifact：CWD 内 + 扩展名白名单 + 产出型节点），中间数据/脚本不收
      if (e.type === "tool_execution_start" && e.toolName === "write" && e.args?.path) {
        const p = String(e.args.path);
        if (isArtifact(p, { cwd, nodeType })) artifacts.add(p);
      }
      if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
        const delta = e.assistantMessageEvent.delta;
        text += delta;
        // 实时心跳：把模型正在写的文字一段段推给调用方（前端节点展开区显示）
        onProgress?.(delta);
      }
    });
    try {
      await session.prompt("请执行上述任务。完成后给出最终结果；如果材料不足或无法完成，明确说明原因。");
    } finally {
      unsub();
    }
    return { text: text.trim(), artifacts: [...artifacts] };
  });
  queues.set(k, task.catch(() => {})); // 队列吞错，避免一条失败锁死后续
  return task;
}

export async function disposeWorkerSession(key) {
  const s = key ? workerSessions.get(key) : null;
  if (!s) return;
  try {
    s.dispose();
  } catch { /* 会话已失效 */ }
  workerSessions.delete(key);
  queues.delete(key);
}
