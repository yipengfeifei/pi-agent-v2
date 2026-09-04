// 新命令 WS 冒烟：set_model / compact / set_queue / branch（branch 走真实 LLM：prompt 出历史 → 分支 → 验证新会话）
// 前置：server.js 已启动（node server.js）
import WebSocket from "ws";

const WS = "ws://127.0.0.1:4700";
const ws = new WebSocket(WS);
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let readyCount = 0;
let branched = false;
let lastHistory = null;
let lastError = null;
let sessionFile = null;
let agentEnded = false;

ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  if (msg.type === "ready") { readyCount++; sessionFile = msg.sessionFile ?? sessionFile; }
  if (msg.type === "history") lastHistory = msg;
  if (msg.type === "error") lastError = msg.message;
  if (msg.event?.type === "agent_end") agentEnded = true;
});

ws.on("open", async () => {
  await wait(500);
  // 1) set_queue（无返回，验证不报错即可）
  ws.send(JSON.stringify({ type: "set_queue", enabled: true }));
  await wait(300);
  if (lastError) fail(`set_queue 报错：${lastError}`);
  // 2) set_model 模糊匹配
  ws.send(JSON.stringify({ type: "set_model", query: "deepseek" }));
  await wait(300);
  if (lastError) fail(`set_model 报错：${lastError}`);
  // 0) 新会话（清空历史，避免旧测试数据污染断言）
  ws.send(JSON.stringify({ type: "new_session" }));
  await wait(1000);
  // 3) 产生唯一一条真实消息 → 完成后 switch_session 重放（prompt 本身不重发 history）
  ws.send(JSON.stringify({ type: "prompt", text: "只说两个字：分支点" }));
  for (let i = 0; i < 120 && !agentEnded; i++) await wait(1000);
  if (!agentEnded) fail("prompt 未完成（agent_end 未到）");
  if (!sessionFile) fail("未收到 ready.sessionFile");
  ws.send(JSON.stringify({ type: "switch_session", sessionFile }));
  lastHistory = null; // 等 switch 重放的新 history（连接时的旧快照已用过）
  for (let i = 0; i < 20 && !lastHistory; i++) await wait(500);
  const hist = lastHistory;
  if (!hist) fail("switch 后未等到 history");
  const userMsg = [...(hist.messages ?? [])].reverse().find((m) => m.role === "user" && m.text.includes("分支点"));
  if (!userMsg) fail("history 中未找到「分支点」消息");
  if (!userMsg.entryId) fail("user 消息无 entryId（分支按钮数据源缺失）");
  // 4) branch：应再收到一次 ready（切到分支会话）
  ws.send(JSON.stringify({ type: "branch", entryId: userMsg.entryId }));
  for (let i = 0; i < 40 && !branched; i++) { await wait(500); if (readyCount >= 2) branched = true; }
  if (!branched) fail("branch 后未切到分支会话（ready 未到）");
  if (lastError) fail(`branch 报错：${lastError}`);
  const branchHist = lastHistory;
  const branchUsers = (branchHist?.messages ?? []).filter((m) => m.role === "user").map((m) => String(m.text).slice(0, 12));
  if (branchUsers.length !== 1 || !branchUsers[0].includes("分支点")) fail(`分支会话历史应为 1 条 user（分支点），实得 ${JSON.stringify(branchUsers)}`);
  console.log("PASS: set_queue / set_model / 历史 entryId / branch 切新会话且历史裁剪正确");
  process.exit(0);
});

setTimeout(() => fail("总超时 150s"), 150_000);
