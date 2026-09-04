// research 端到端测试：new_session 干净会话 → prompt → 观察 research 调用 + 轮次 + agent_end
// 用法：node test-research.mjs "<提示词>" [超时毫秒]
import WebSocket from "ws";

const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:4701";
const TEXT = process.argv[2] ?? "帮我研究一下：跨境电商选品，TikTok Shop 美区，解压玩具类目值不值得进入？";
const TIMEOUT_MS = Number(process.argv[3] ?? 900_000);

const ws = new WebSocket(WS_URL);
const timer = setTimeout(() => {
  console.error("\nFAIL: 超时未等到 agent_end");
  process.exit(1);
}, TIMEOUT_MS);

let gotDelta = false;
const toolCalls = [];

let readyCount = 0;
ws.on("open", () => {
  // 初始 open（续最近会话）完成后才发 new_session，避免竞态
  ws.send(JSON.stringify({ type: "new_session", mode: "normal", cwd: process.env.TEST_CWD || undefined }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  // 串行 open 后：第 1 次 ready = 连接初始 open（续旧会话），第 2 次 = new_session 完成
  if (msg.type === "ready") {
    readyCount++;
    if (readyCount === 2) {
      ws.send(JSON.stringify({ type: "prompt", text: TEXT }));
    }
    return;
  }
  if (msg.type === "error") console.log("[server error]", msg.message);
  const event = msg.event;
  if (!event) return;
  if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
    gotDelta = true;
    process.stdout.write(event.assistantMessageEvent.delta);
  }
  if (event.type === "tool_execution_start") {
    toolCalls.push(event.toolName);
    console.log(`\n[tool] ${event.toolName}`);
  }
  if (event.type === "agent_end") {
    clearTimeout(timer);
    console.log(`\n\n工具调用序列: ${toolCalls.join(" → ") || "无"}`);
    const usedResearch = toolCalls.includes("research");
    console.log(`\n${gotDelta ? "PASS" : "FAIL: 未收到文本增量"}${usedResearch ? "（调用了 research）" : "（⚠️ 未调用 research）"}`);
    process.exit(gotDelta ? 0 : 1);
  }
});

ws.on("error", (err) => {
  clearTimeout(timer);
  console.error("FAIL:", err.message);
  process.exit(1);
});
