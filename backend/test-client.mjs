// 冒烟测试：连 WS → prompt → 断言收到流式文本 → agent_end → 退出 0/1
// 用法：node test-client.mjs [提示词]
import WebSocket from "ws";

const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:4700"; // 127.0.0.1：本机 localhost 有 IPv6 解析问题
const TEXT = process.argv[2] ?? "只回复两个字：收到";
const TIMEOUT_MS = Number(process.argv[3] ?? 120_000);

const ws = new WebSocket(WS_URL);
const timer = setTimeout(() => {
  console.error("\nFAIL: " + TIMEOUT_MS / 1000 + "s 超时未等到 agent_end");
  process.exit(1);
}, TIMEOUT_MS);

let gotDelta = false;
let gotToolCall = false;

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "prompt", text: TEXT }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  const event = msg.event;
  if (!event) return;
  if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
    gotDelta = true;
    process.stdout.write(event.assistantMessageEvent.delta);
  }
  if (event.type === "tool_execution_start") {
    gotToolCall = true;
    console.log(`\n[tool] ${event.toolName}`);
  }
  if (event.type === "agent_end") {
    clearTimeout(timer);
    console.log(`\n${gotDelta ? "PASS" : "FAIL: 未收到文本增量"}${gotToolCall ? "（含工具调用）" : ""}`);
    process.exit(gotDelta ? 0 : 1);
  }
});

ws.on("error", (err) => {
  clearTimeout(timer);
  console.error("FAIL:", err.message);
  process.exit(1);
});
