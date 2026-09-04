// 一次性：裸 API（一句提示词 + 游戏策划任务）→ 完整响应直接落成会话文件（进对话列表）
import { readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";

const key = "sk-wTEiZQwpqUsQtolYoSw3y68IFeQiNbPRTYcRDqqfEI0yTuHmqK4nzaVhudiqNkFg";
const task = "我最近一直在尝试做一款游戏。这款游戏呢，我一开始是想做成从细胞到奇点那样子的游戏。但是做着做着我觉得发现我缺少很多3D的资源，我没有办法做到像从细胞到奇点那样的视觉丰富度、可玩性。所以呢，我想了一个替代方案，就是因为我做的东西不是从细胞到奇点这种演化路径，我做的是各种学科、各种文明的演化路径。所以呢，我觉得我可以在做一个游戏，然后这个游戏端口呢，可以有一些角色进行互动。比如说我是一个领主，然后这个领地里面有一些5个人，然后这5个人分别是药剂师，然后铁匠之类的。然后呢，我是带领这些领地里的人民。从石器时代的文明程度一路发展，然后一直扩大自己的领地，提高居民的幸福度为主线。然后呢，我去以此为推动力，让玩家在这个科技和文明两条支线里面不停的去加点解锁内容。因为加点解锁内容之后呢，就可以去解决在游戏端口各种领地里面的人民，他们口里抱怨的事情就可以被解决。现在我需要你去进行一些了解，了解完之后呢。给我完整的策划方案，以及你觉得我需要去做哪一些事情。";

const body = {
  model: "deepseek-v4-pro",
  messages: [
    { role: "system", content: "You are a helpful software engineering assistant." },
    { role: "user", content: task },
  ],
  stream: false,
};

const resp = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + key },
  body: JSON.stringify(body),
});
if (!resp.ok) {
  console.log("HTTP", resp.status, (await resp.text()).slice(0, 300));
  process.exit(1);
}
const j = await resp.json();
const msg = j.choices?.[0]?.message || {};
const thinking = String(msg.reasoning_content ?? "");
const text = String(msg.content ?? "");

const head = thinking.trim().split(/\s+/).slice(0, 4).join(" ");
console.log("思维链开头:", head.slice(0, 60));
console.log("开头判断:", head.includes("我们需要") ? "✅ 我们需要" : "⚠️ " + head.slice(0, 30));
console.log("thinking 长度:", thinking.length, "| 回复长度:", text.length);

// 构造会话 JSONL（格式对齐 pi SessionManager）
const ulid = () => "01" + crypto.randomBytes(14).toString("hex").replace(/[^a-z0-9]/gi, "").slice(0, 24);
const now = new Date();
const ts = now.toISOString().replace(/T/, "T").replace(/\.\d+Z$/, "Z").replace(/:/g, ":");
const ms = now.getTime();
const sessionId = ulid();
const modelId = ulid();
const tlId = ulid();
const userMsgId = ulid();
const asstMsgId = ulid();

const lines = [
  { type: "session", version: 3, id: sessionId, timestamp: ts, cwd: "/Users/yipengfei/Desktop" },
  { type: "model_change", id: modelId, parentId: null, timestamp: ts, provider: "opencode-go", modelId: "deepseek-v4-pro" },
  { type: "thinking_level_change", id: tlId, parentId: modelId, timestamp: ts, thinkingLevel: "high" },
  { type: "message", id: userMsgId, parentId: tlId, timestamp: ts, message: { role: "user", content: [{ type: "text", text: task }], timestamp: ms } },
  { type: "message", id: asstMsgId, parentId: userMsgId, timestamp: ts, message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking, thinkingSignature: "reasoning_content" },
        { type: "text", text },
      ],
      api: "openai-completions", provider: "opencode-go", model: "deepseek-v4-pro",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "end_turn", timestamp: ms,
    } },
].map((l) => JSON.stringify(l)).join("\n") + "\n";

const dir = "/Users/yipengfei/.pi/agent/sessions/--Users-yipengfei-Desktop--";
const file = `${dir}/${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}Z_${sessionId}.jsonl`;
writeFileSync(file, lines, "utf8");
console.log("会话已写入:", file);
console.log("大小:", lines.length, "bytes");
