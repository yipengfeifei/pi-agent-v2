// plan 重试路径回归：坏 JSON → 自动重试一次 → 成功；双重失败 → 兜底
// 运行：cd backend && node test-plan-retry.mjs
import { runPlanWithRetry, annotateGraph } from "./tools/plan.js";

// 真实失败样本（模型输出未加引号的 key → JSON 解析失败），内联避免依赖 /tmp 临时文件
const badSample = `{"interactionMode":"plan","nodes":[{id:"n1",type:"Fetch/Gather",name:"xx",deps:[],input:[],output:"o"}]}`;
const good = { interactionMode: "plan", nodes: [{ id: "n1", name: "a" }, { id: "n2", name: "b" }] };

// 场景 1：第一次坏 → 重试修复 → 成功
let calls = 0;
const runFn = async (block) => {
  calls++;
  if (calls === 1) return badSample;
  return JSON.stringify(good);
};
const attempt = await runPlanWithRetry(runFn, "## 用户目标\ntest");
console.assert(attempt.ok, "场景1: 重试后应成功");
console.assert(calls === 2, `场景1: 应恰好调用 2 次，实际 ${calls}`);
console.assert(attempt.parsed.nodes.length === 2, "场景1: 应拿到修复后的图");

// 场景 2：两次都坏 → 兜底（!ok，不抛异常）
let calls2 = 0;
const failFn = async () => { calls2++; return badSample; };
const attempt2 = await runPlanWithRetry(failFn, "## 用户目标\ntest");
console.assert(!attempt2.ok, "场景2: 双重失败应 !ok");
console.assert(calls2 === 2, `场景2: 应恰好调用 2 次，实际 ${calls2}`);
console.assert(attempt2.result === badSample, "场景2: 兜底应保留原始输出供日志");

// 场景 3：一次成功 → 只调用 1 次
let calls3 = 0;
const okFn = async () => { calls3++; return JSON.stringify({ direct: true }); };
const attempt3 = await runPlanWithRetry(okFn, "## 用户目标\ntest");
console.assert(attempt3.ok && calls3 === 1, "场景3: 成功路径只调用 1 次");

// 场景 4：拆图成功后 annotateGraph 附加 runId + title（跨图区分 + 断点续接的持久依据）
const runIdSample = { direct: false, nodes: [{ id: "n1", name: "首个节点" }] };
const annotated = annotateGraph(runIdSample);
console.assert(typeof annotated.runId === "string" && annotated.runId.length > 0, `场景4: 应有 runId，实际 ${annotated.runId}`);
console.assert(annotated.title === "首个节点", `场景4: title 应为首节点名，实际 ${annotated.title}`);
console.assert(typeof annotated.created === "number", "场景4: 应有 created 时间戳");
// 非拆图结果（direct 或纯交流）不加 runId
const directAnnotated = annotateGraph({ direct: true });
console.assert(directAnnotated.runId === undefined, "场景4: direct 结果不加 runId");

console.log("PASS: 重试路径正常 + runId/title 附件");
