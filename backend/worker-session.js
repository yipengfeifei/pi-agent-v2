// worker 常驻会话：in-memory + 上下文替换实现"节点干净上下文"
// 隔离机制（已实测验证）：每节点执行前替换 agent.state.messages，
// 模型只见本次注入的物料/skill/prompt，不累积、不见主会话历史
import { SessionManager, createAgentSession } from "@earendil-works/pi-coding-agent";
import { modelRuntime } from "./model-runtime.js";
import { httpRequestTool, appSnapshotTool } from "./tools/runtime-tools.js";
import { searchTool } from "./tools/search.js";
import { factreachTool } from "./tools/factreach.js";
import { browserTool } from "./tools/browser.js";
import { siteMemoryTool } from "./tools/site-memory.js";
import { isArtifact } from "./artifacts.js";

// 每父会话一个 worker 常驻会话：多会话并行时各跑各的节点，互不共享状态/队列
// ponytail: 锁粒度从全局降到父会话级——同一父会话同一时刻只跑一个节点，不同父会话并行
const workerSessions = new Map(); // key(父 sessionId) -> worker session
const queues = new Map(); // key -> 串行队列（防同父会话节点互相踩上下文）

// 节点执行超时（对齐 research.js 的 ROUND_TIMEOUT_MS）：节点挂死时中止，避免整任务卡住。
// env NODE_TIMEOUT 可用秒数覆盖（写法对齐 server.js 的 TOOL_TIMEOUT）
const NODE_TIMEOUT_MS = (Number(process.env.NODE_TIMEOUT) || 300) * 1000;

// worker 模型选择：默认跟随主会话模型（调用方传入 model）；用户可用环境变量 WORKER_MODEL="provider/id" 显式覆盖；
// 都不指定时交给 SDK 连接默认模型。
// ponytail: 曾用固定候选列表+回退，踩过 gpt-5.x-nano 空输出坑，跟随主会话是最简正确默认。
function pickWorkerModel(model) {
  const explicit = process.env.WORKER_MODEL;
  if (explicit) {
    const [provider, id] = explicit.split("/");
    const m = modelRuntime.getModel(provider, id);
    if (m) return m;
    console.warn(`[worker] WORKER_MODEL=${explicit} 未找到，回退默认`);
  }
  return model ?? null; // null = SDK 连接默认模型
}

export async function getWorkerSession({ cwd, key, model }) {
  const k = key ?? cwd;
  if (workerSessions.has(k)) return workerSessions.get(k);
  const m = pickWorkerModel(model);
  const { session } = await createAgentSession({
    cwd,
    model: m,
    sessionManager: SessionManager.inMemory(),
    modelRuntime,
    tools: ["read", "bash", "write", "grep", "find", "ls", "http_request", "execution_app_snapshot", "search", "factreach", "site_memory", "browser"],
    customTools: [httpRequestTool, appSnapshotTool, searchTool, factreachTool, siteMemoryTool, browserTool],
  });
  workerSessions.set(k, session);
  return session;
}

// 一次性隔离会话：subagent 并发用（每个任务独立会话，不撞互斥锁）
export async function createIsolatedSession({ cwd, systemBlock, materialsBlock, model }) {
  const m = pickWorkerModel(model);
  const { session } = await createAgentSession({
    cwd,
    model: m,
    sessionManager: SessionManager.inMemory(),
    modelRuntime,
    tools: ["read", "bash", "write", "grep", "find", "ls", "http_request", "execution_app_snapshot", "search", "factreach", "site_memory", "browser"],
    customTools: [httpRequestTool, appSnapshotTool, searchTool, factreachTool, siteMemoryTool, browserTool],
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

export async function runNode({ cwd, systemBlock, materialsBlock, onProgress, nodeType, key, model }) {
  const k = key ?? cwd;
  const task = (queues.get(k) ?? Promise.resolve()).then(async () => {
    const session = await getWorkerSession({ cwd, key: k, model });
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
    // 超时保护 + 异常兜底（对齐 research.js:runRound）：失败返回结构化结果，不向上抛异常
    try {
      const promptTask = session.prompt("请执行上述任务。完成后给出最终结果；如果材料不足或无法完成，明确说明原因。");
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`节点执行超时（>${NODE_TIMEOUT_MS / 60000} 分钟），已中止`)), NODE_TIMEOUT_MS)
      );
      await Promise.race([promptTask, timeout]);
    } catch (err) {
      const msg = String(err?.message ?? err);
      console.error(`[worker] 节点执行异常/超时：${msg}`);
      // 已产出的部分文本一并带回便于排查；带 error 标记，让调用方区分「空产出」与「执行失败」
      return { text: text.trim(), artifacts: [...artifacts], error: msg };
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
