// 观察客户端:打印工具名 + 参数 + 结果摘要
import WebSocket from "ws";
const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:4700";
const TEXT = process.argv[2] ?? "test";
const TIMEOUT_MS = Number(process.argv[3] ?? 180_000);
const ws = new WebSocket(WS_URL);
const timer = setTimeout(() => { console.error("\nFAIL: 超时"); process.exit(1); }, TIMEOUT_MS);

ws.on("open", () => ws.send(JSON.stringify({ type: "prompt", text: TEXT })));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  const e = msg.event;
  if (!e) return;
  if (e.type === "tool_execution_start") {
    console.log(`\n===== [tool] ${e.toolName} =====`);
    if (e.args) console.log("ARGS:", JSON.stringify(e.args).slice(0, 500));
  }
  if (e.type === "tool_execution_end") {
    const t = e.result?.text ?? "";
    console.log(`--- result (${t.length} chars):`, t.slice(0, 300).replace(/\n/g, " "));
  }
  if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
    process.stdout.write(e.assistantMessageEvent.delta);
  }
  if (e.type === "agent_end") {
    clearTimeout(timer);
    console.log("\n===== DONE =====");
    process.exit(0);
  }
});
