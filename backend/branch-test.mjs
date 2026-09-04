// 分支链路自测（sessionManager 层，不调 LLM）：
// create → 追加消息 → createBranchedSession 复制根→分支点路径为独立文件 → 可再分支（递归）
// 覆盖风险点：createBranchedSession 签名 / 新文件内容 / entryId 复用
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = join(tmpdir(), `pi-v2-branch-test-${Date.now()}`);
const sessDir = join(dir, "sessions");
const sm = SessionManager.create(dir, sessDir);
const ids = [];
// 真实对话形状：user → assistant → user → user（hasAssistant=true，分支文件自动落盘）
ids.push(sm.appendMessage({ role: "user", content: [{ type: "text", text: "第一问" }] }));
ids.push(sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "回答一" }] }));
ids.push(sm.appendMessage({ role: "user", content: [{ type: "text", text: "第二问" }] }));
ids.push(sm.appendMessage({ role: "user", content: [{ type: "text", text: "第三问" }] }));
const [m1, m2, m3, m4] = ids;

// 1) 从第三条消息（m3）分支 → 新文件只含 m1+m2+m3（getEntries 不含 header）
const file = sm.createBranchedSession(m3);
if (!file || !existsSync(file)) throw new Error("分支文件未生成");
const branch = SessionManager.open(file);
const entries = branch.getEntries();
if (entries.length !== 3) throw new Error(`分支应含 3 条（1/2/3），实得 ${entries.length}`);
if (entries[2].id !== m3) throw new Error(`分支尾部应为 m3（${m3}），实得 ${entries[2].id}`);
if (entries.some((e) => e.id === m4)) throw new Error("分支不应含被舍弃的 m4");

// 2) 分支会话继续写 → 从 m3 下延伸，不影响原会话
const m5 = branch.appendMessage({ role: "user", content: [{ type: "text", text: "分支线继续" }] });
const parent = branch.getEntry(m5)?.parentId;
if (parent !== m3) throw new Error(`新消息应挂在 m3 下，实得父 ${parent}`);

// 3) 分支点之后可再分支（V2 画布上连续分支）
const file2 = branch.createBranchedSession(m2);
const branch2 = SessionManager.open(file2);
if (branch2.getEntries().length !== 2) throw new Error("二级分支应含 2 条");

// 4) user-only 分支（分支点前无 assistant）：SDK defer 写盘，需手动 _rewriteFile 强制落盘（server.js 同款修复）
const sm2 = SessionManager.create(dir, sessDir);
sm2.appendMessage({ role: "user", content: [{ type: "text", text: "仅一条 user" }] });
const file3 = sm2.createBranchedSession(sm2.getEntries()[0].id);
if (!file3 || existsSync(file3)) throw new Error("user-only 分支应 defer 不落盘");
sm2._rewriteFile();
if (!existsSync(file3)) throw new Error("强制写盘后分支文件应存在");
const branchB = SessionManager.open(file3);
if (branchB.getEntries().length !== 1) throw new Error("user-only 分支应含 1 条");

console.log("PASS: 分支生成/内容裁剪/继续写挂点/递归分支/user-only 落盘");
