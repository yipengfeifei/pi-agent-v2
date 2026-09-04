// 可行性验证：agent.state.messages 替换能否实现"节点干净上下文"
// 实验逻辑：先让模型记住一个秘密 → 替换上下文 → 再问秘密 → 答不出=隔离成功
import { AuthStorage, ModelRegistry, SessionManager, createAgentSession } from "@earendil-works/pi-coding-agent";

const auth = AuthStorage.create();
const mr = ModelRegistry.create(auth);
const { session } = await createAgentSession({
  cwd: process.cwd(),
  sessionManager: SessionManager.inMemory(),
  authStorage: auth,
  modelRegistry: mr,
  tools: ["read", "bash"],
});

let text = "";
session.subscribe((e) => {
  if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
    text += e.assistantMessageEvent.delta;
  }
});

// 第一轮：注入秘密
await session.prompt("秘密数字是 42。只回复两个字：记住了。");
const round1 = text;
console.log("R1:", round1.replace(/\n/g, " "));

// 第二轮：替换上下文（模拟节点干净环境：只有自己的物料）
text = "";
session.agent.state.messages = [
  { role: "user", content: [{ type: "text", text: "秘密数字是多少？直接回复数字。" }] },
];
await session.prompt("请回答上面这条消息。");
const round2 = text;
console.log("R2:", round2.replace(/\n/g, " "));

// 判定：R2 若包含 42 → 隔离失败（上下文没被替换）；否则隔离成功
const leak = /42/.test(round2);
console.log(leak ? "FAIL: 上下文泄漏（R2 提到了 42）" : "PASS: 上下文隔离成功（R2 不知道 42）");
session.dispose();
process.exit(leak ? 1 : 0);
