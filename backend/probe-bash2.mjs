import WebSocket from "ws";
const ws = new WebSocket("ws://127.0.0.1:4700");
let started = false, chunks = 0;
const t0 = Date.now();
ws.on("open", () => ws.send(JSON.stringify({ type: "new_session", mode: "normal" })));
ws.on("message", (d) => {
  const m = JSON.parse(d);
  if (m.type === "ready" && !started) {
    started = true;
    console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] ready ${m.sessionId.slice(0,8)}, sending slow-echo bash`);
    ws.send(JSON.stringify({ type: "prompt", text: "运行 bash：python3 -c \"import time; [print('进度', i, flush=True) or time.sleep(0.3) for i in range(5)]\"" }));
  } else if (m.type === "bash_progress") {
    chunks++;
    console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] bash_progress #${chunks}: ${JSON.stringify(m.delta.slice(0, 40))}`);
  } else if (m.event?.type === "tool_execution_start" && m.event.toolName === "bash") {
    console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] bash tool started`);
  } else if (m.event?.type === "tool_execution_end") {
    console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] tool_end ${m.event.toolName} (bash_progress: ${chunks})`);
    ws.close(); process.exit(0);
  } else if (m.event?.type === "message_update") {
    if (Math.random() < 0.1) console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] msg_update`);
  }
});
setTimeout(() => { console.log("TIMEOUT — chunks:", chunks); process.exit(2); }, 45000);
