import { createAgentSession, SessionManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import fs from "node:fs";

const dir = path.join(getAgentDir(), "sessions", "--Users-yipengfei-Desktop-pi Agent V2--");
const files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl")).sort();
const f = files[files.length - 1];
console.log("latest session:", f.slice(0, 40));
const sm = SessionManager.open(path.join(dir, f));
const result = await createAgentSession({
  cwd: "/Users/yipengfei/Desktop/pi Agent V2",
  sessionManager: sm,
  model: { provider: "opencode-go", modelId: "deepseek-v4-flash" },
  tools: [],
  customTools: [],
});
const msgs = result.session.agent.state.messages ?? [];
console.log("messages count:", msgs.length);
for (const m of msgs.slice(0, 10)) {
  const parts = Array.isArray(m.content) ? m.content : [];
  const hasTool = parts.some(p => p?.type === "toolCall");
  const text = parts.filter(p => p?.type === "text").map(p => p.text).join("").slice(0, 30);
  console.log(`${m.role}${hasTool ? "*" : ""} | ${text}`);
}
process.exit(0);
