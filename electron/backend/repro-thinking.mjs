// 复现：打开 10-56-27 分支会话（simple+pro+high）prompt，看新消息有没有 thinking
import { AuthStorage, DefaultResourceLoader, ModelRegistry, SessionManager, createAgentSession, getAgentDir } from "@earendil-works/pi-coding-agent";

const auth = AuthStorage.create();
const reg = ModelRegistry.create(auth);
const CWD = "/Users/yipengfei/Desktop/pi Agent V2/electron/dist/mac/FLY.app/Contents/Resources/app";
const simplePrompt = 'You are a helpful software engineer assistant.\nUser messages may be in Chinese. Always reason and plan in English.\nNever begin any reasoning block with "let me" or "I will". Begin every reasoning block with "We need to" or "We should" and keep planning in first-person plural (we).';
const loader = new DefaultResourceLoader({ cwd: CWD, agentDir: getAgentDir(), systemPrompt: simplePrompt, noContextFiles: true, noSkills: true, noPromptTemplates: true, appendSystemPromptOverride: () => [] });
await loader.reload();

const file = "/Users/yipengfei/.pi/agent/sessions/--Users-yipengfei-Desktop-pi Agent V2-electron-dist-mac-FLY.app-Contents-Resources-app--/2026-08-17T10-56-27-708Z_01a00f5d-9a3b-7d2d-9523-b7f5813cb046.jsonl";
const { session } = await createAgentSession({
  model: undefined, authStorage: auth, modelRegistry: reg,
  sessionManager: SessionManager.open(file), resourceLoader: loader,
  tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "plan", "worker", "wait_for", "subagent", "run_status", "search", "site_memory", "research", "browser"],
});
console.log("模型:", session.model?.provider, session.model?.id, "| thinkingLevel:", session.thinkingLevel);
console.log("历史消息:", session.messages?.length);
await session.prompt("看一下这个项目现在进展到哪了，用一句话总结。", { streamingBehavior: "steer" });
const last = [...(session.messages ?? [])].reverse().find((m) => m.role === "assistant");
const parts = Array.isArray(last?.content) ? last.content : [];
const t = parts.filter((p) => p?.type === "thinking").map((p) => p.thinking).join("");
const tx = parts.filter((p) => p?.type === "text").map((p) => p.text).join("");
console.log("新轮 parts:", parts.map((p) => p.type).join(","));
console.log("thinking:", t.slice(0, 150) || "(无 thinking)");
console.log("text:", tx.slice(0, 80) || "-");
await session.dispose?.();
process.exit(0);
