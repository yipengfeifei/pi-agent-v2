import WebSocket from "ws";
const ws = new WebSocket("ws://127.0.0.1:4700");
let started = false, chunks = 0, firstChunk = "";
const t0 = Date.now();
ws.on("open", () => ws.send(JSON.stringify({ type: "new_session", mode: "normal" })));
ws.on("message", (d) => {
  const m = JSON.parse(d);
  if (m.type === "ready" && !started) {
    started = true;
    console.log("ready, sending slow-echo bash");
    ws.send(JSON.stringify({ type: "prompt", text: "运行 bash：python3 -c \"import time; [print('进度', i, flush=True) or time.sleep(0.3) for i in range(5)]\"" }));
  }
  if (m.type === "bash_progress") {
    chunks++;
    if (chunks === 1) firstChunk = m.delta;
    console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] bash_progress: ${JSON.stringify(m.delta.slice(0, 30))}`);
  }
  if (m.event?.type === "tool_execution_end" && m.event.toolName === "bash") {
    console.log(`tool_execution_end: total bash_progress chunks = ${chunks}`);
    ws.close(); process.exit(0);
  }
  if (m.event?.type === "agent_end") { console.log("agent_end (no bash_progress seen:", chunks, ")"); ws.close(); process.exit(0); }
});
setTimeout(() => { console.log("TIMEOUT"); process.exit(2); }, 25000);
