import WebSocket from "ws";
const ws = new WebSocket("ws://127.0.0.1:4700");
let firstReady = null, chunks = 0, sent = false;
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] ${s}`);
ws.on("open", () => ws.send(JSON.stringify({ type: "new_session", mode: "normal" })));
ws.on("message", (d) => {
  const m = JSON.parse(d);
  if (m.type === "ready") {
    if (!firstReady) { firstReady = m.sessionId; log(`initial ready ${firstReady.slice(0,8)} — waiting fresh…`); }
    else if (m.sessionId !== firstReady) {
      log(`fresh session ready ${m.sessionId.slice(0,8)}, sending slow-echo bash`);
      ws.send(JSON.stringify({ type: "prompt", text: "运行 bash：python3 -c \"import time; [print('进度', i, flush=True) or time.sleep(0.3) for i in range(5)]\"" }));
      sent = true;
    }
  } else if (m.type === "bash_progress") {
    chunks++;
    log(`bash_progress #${chunks}: ${JSON.stringify(m.delta.slice(0, 40))}`);
  } else if (m.event?.type === "tool_execution_end") {
    log(`tool_end ${m.event.toolName} — bash_progress chunks: ${chunks}`);
    ws.close(); process.exit(0);
  } else if (m.event?.type === "agent_end" && sent) {
    log(`agent_end — chunks: ${chunks}`);
    ws.close(); process.exit(0);
  }
});
setTimeout(() => { log(`TIMEOUT — chunks: ${chunks}`); process.exit(2); }, 45000);
