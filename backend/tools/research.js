// research 工具：专家研究引擎（多轮自动循环）
// 触发：研究型任务（需要方法论/专家判断，如选品、市场进入、投研）——由主 agent 自主判断调用
// 执行：工具内部自动连续跑最多 MAX_ROUNDS 轮（worker 隔离上下文，带 search/site_memory/http_request 工具）
// 轮次：1 广搜开题拆假设 → 2 定向补搜+分层整理+冲突检测 → 3 反证检查+收敛
// 卡住（方案阻塞型信息缺失）→ 提前返回让主 agent 问用户；用户回答后调 research(user_input=...) 续跑该轮
// 状态：每轮落 custom entry research_round（可审计 + 断点续接）
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runNode } from "../worker-session.js";

const MAX_ROUNDS = 5;

// 研究进度广播（与 worker 的 nodeProgressEmitter 同构）：每轮开始/完成 + 实时 delta
// 前端用 toolCallId 定位活动条目，delta 进展开区实时信息流
export const researchProgressEmitter = (() => {
  const subs = new Set();
  return {
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    emit(evt) { for (const fn of subs) { try { fn(evt); } catch {} } },
  };
})();

const ROUND_PHASES = { 1: "开题分层", 2: "定向补搜+收敛" };
const roundPhase = (n) => ROUND_PHASES[n] ?? "聚焦轮";

// 收敛 → 沉淀专家 skill：把 method_layer + expert_summary 拼成 SKILL.md 写入 cwd/.pi/skills/
// 只存慢变的方法/基线/坑，不存时效性结论（对象层不沉淀，由每次任务现取）
export function writeExpertSkill({ cwd, state }) {
  const es = state.expert_summary ?? {};
  const rawName = String(es.name ?? "").trim() || "expert-" + String(state.goal ?? "task").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().slice(0, 40);
  const name = rawName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!name || name.length > 64) return null;
  const description = String(es.description ?? "").trim()
    || `${String(es.scope ?? state.goal ?? "").slice(0, 100)} 的专家研究经验。涉及同类任务时加载。`;
  const scope = String(es.scope ?? "").trim() || "（未声明，见判断框架）";
  const ml = (state.method_layer ?? [])
    .map((m, i) => `- **${m.claim}**\n  机制: ${m.mechanism ?? ""}；适用范围: ${m.applicability ?? ""}；验证状态: ${m.verification ?? "untested"}`)
    .join("\n");
  const bl = (es.baseline ?? []).map((b) => `- ${b.k}: ${b.v}`).join("\n") || "（暂无）";
  const pf = (es.pitfalls ?? []).map((p) => `- ${p}`).join("\n") || "（暂无）";
  const md = `---
name: ${name}
description: ${description}
---

# 专家档案：${name}

## 适用边界
${scope}

## 判断框架（方法论）
${ml || "（暂无）"}

## 已知基线
${bl}

## 反证坑
${pf}

## 更新时间
${new Date().toISOString().slice(0, 10)}
`;
  const dir = path.join(cwd, ".pi", "skills");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.md`);
  writeFileSync(file, md, "utf8");
  return `${name}.md`;
}

// 研究协议（每轮都注入）：这是"研究引擎"的认知协议本身，不是一次性搜索总结
const PROTOCOL = `你是跨领域资深研究员（Expert Researcher）。当前任务是研究型任务：需要先搞清"这类问题该怎么判断、需要什么证据"，再给出结论——而不是凭常识直接回答。

## 核心纪律（每轮都必须遵守）
1. 证据分层：一手来源（平台官方数据、政府/海关统计、企业财报、原始数据库）优先于二手转述（教程、自媒体、博客）。二手内容只用于发现变量和候选假设，不直接充当证据。
2. 对象层 vs 方法层分离：
   - 对象层 = 具体结论（"这个品/这件事现在能不能做"）
   - 方法层 = 判断逻辑（"判断它该看哪些指标、为什么有效"）
   两者分开记录，禁止混在一起加权平均。
3. 多源交叉：关键结论至少 2-3 个独立来源；"独立" = 不是互相转述同一条源。十个视频转述同一篇文章只算 1 个独立信源。
4. 矛盾检测：来源冲突必须指出并并列呈现，禁止自行调和取平均。冲突本身可能是答案的一部分。
5. 时效与适用范围：每条证据必须标注地域、时间窗、失效日期（数据类信息默认 3 个月内有效，政策类标注生效/失效日期）。
6. 反证优先：主动找"如果假设成立本该看到什么"，而不是只累积支持证据。
7. 缺证据就明说：证据不足时宁可给"还不能做"+ 缺口清单，不要硬凑结论。
8. 搜索纪律：用 search 工具检索，一次一个意图；知识/信息类查询优先英文（英文语料质量更高）；搜不到就换表述或换 domain 重试一次；禁止凭知识编造来源或 URL。
9. 止损：search 工具连续失败 2 次视为搜索服务不可用——立即停止重试，在 gaps 中注明"搜索服务不可用，缺口待补"，继续完成结构化输出；不要无限重试。
10. 搜索次数限额（必须遵守，防止超时）：第 1 轮最多 2 次搜索；第 2 轮最多 3 次；第 3 轮最多 2 次。搜索超限即停止，缺口如实写入 gaps。
11. 免费替代优先：写证据规格和缺口时**不预设任何付费工具**（禁止写"需 FastMoss/EchoTik/Tabcut 付费后台"这类引导）。每条数据需求先想免费公开替代——平台官方公开页面、公开榜单、搜索/话题热度、供应侧（1688 搜索结果本身就能给价格带/卖家数/销量）、第三方免费工具页。只有当你确认某数据确实不存在免费公开替代时，才可标注"仅付费渠道"，并同时给出"没有它决策怎么做"的替代信号。
12. 决策截止：真实世界信息搜集有时尽，必须在模糊和概率中工作。区分"决策必需"与"有了更好"的证据——达到轮次/搜索预算后，即使仍有"有了更好"的缺口，也必须给出 best-effort 结论（do/dont/not_yet + 置信度 + 剩余不确定性），禁止以"证据不足"无限拖延。not_yet 只允许在存在"决策必需"缺口时使用，且必须给出这些缺口的最小补齐路径。
13. 价值分层（最重要的效率纪律）：不是所有假设都值得同等深挖。拆出假设后，按**决策权重**分层——essential（该变量直接翻转 do/dont 结论，如：供给密度、毛利结构、需求真实量级）vs secondary（影响程度但不翻转结论，如：达人佣金分布细节、政策细节）。资源只投入 essential；secondary 一句话带过或标注"不深挖"。判断标准：该变量改变结论的概率 × 改变幅度。禁止平均用力。

## 输出格式（严格 JSON，只输出 JSON，不要任何其他文字）
{
  "status": "in_progress | converged | need_user_input",
  "question": "（仅 need_user_input 时填写，方案阻塞型缺失，最多 1 个问题）",
  "round": <当前轮次>,
  "goal": "<研究问题>",
  "hypotheses": [{"id":"h1","claim":"<可证伪的假设>","test":"<用什么数据/方法能证伪它>","weight":"essential|secondary","status":"unverified|supported|rejected|conflicted"}],
  "evidence": [{"for":"h1","statement":"<证据陈述>","source":"<来源名称>","url":"<来源URL，禁止编造>","tier":"primary|secondary","region":"<适用地域>","time_window":"<适用时间窗>","expires":"<失效日期或'未知'>","note":"<评估：相关性/时效/局限>"}],
  "method_layer": [{"claim":"<方法层声明：判断该看什么/怎么判断>","mechanism":"<背后可检验的因果机制，无则写'经验直觉'>","applicability":"<适用平台/品类/地区/时间>","independent_sources":<独立信源数>,"verification":"untested|supported|contradicted"}],
  "conflicts": [{"a":"<来源A>","b":"<来源B>","issue":"<冲突内容>","implication":"<对决策的含义>"}],
  "gaps": ["<缺失的证据/信息>"],
  "falsification": [{"hypothesis":"h1","expected_signal":"<如果假设成立本该出现的信号>","observed":"<实际观察>","interpretation":"<说明结论错/数据滞后/样本错>"}],
  "subagent_tasks": [{"agent":"investigator","task":"<取证任务，自包含>","method_notes":"<方法层约束>"}],
  "confidence": {"level":"low|medium|high","rationale":"<为什么是这个置信度>"},
  "conclusion": {"decision":"do|dont|not_yet","conditions":"<成立条件>","next_step":"<再做什么能降哪个不确定性>"},
  "expert_summary": {"name":"expert-<领域>-<市场>（小写连字符，如 expert-tiktok-us-xuanpin）","description":"<50-100字：什么时候该用这个专家经验，含领域/市场/任务类型关键词>","scope":"<适用边界 1-2 行：品类/市场/约束>","baseline":[{"k":"<已确认的指标名>","v":"<已确认的数值+来源+时间>"}],"pitfalls":["<已被反证击穿的错误做法，每条一个>"],"updated":"<日期>"}
}
结论规则：证据门槛未达成（关键假设无一手证据支撑/未做反证检查）时 decision 必须为 not_yet，不得 do/dont。expert_summary 用于沉淀可复用的专家 skill：只存慢变的方法/基线/坑，不存时效性结论（具体品/价格现在能不能做）。`;

// —— 轮次任务（每轮注入）——
const ROUND_TASKS = {
  1: `## 本轮任务（第 1 轮：开题 + 价值分层）
1. 先用 search 工具做 1-2 次广搜收集素材（不挑食，混沌输入），从素材中识别该领域的常见说法、变量、候选方法。
2. 把研究问题拆成可证伪的假设清单（每个假设带 test：用什么数据/方法能证伪）。
3. **价值分层（本轮核心）**：给每个假设标 weight=essential（直接翻转 do/dont 的变量，一般 2-4 个）或 secondary（不翻转结论的细节）。只对 essential 假设展开详细证据规格（平台/来源/粒度/时间窗）；secondary 写一行即可，明确"不深挖"。
4. 若存在方案阻塞型信息缺失（如目标市场/时间窗/约束条件未定，且直接影响假设设计）→ status=need_user_input + question（最多 1 个问题）。
5. 输出初版 JSON（hypotheses 带 weight，evidence 可为空数组，gaps 只列 essential 相关的）。`,
  2: `## 本轮任务（第 2 轮：定向补搜 + 分层整理 + 强制收敛）
1. 针对上一轮 gaps 逐个定向补搜（每个缺口一次检索，不重复广搜）。**只深挖 weight=essential 且未验证的假设**；secondary 不再投入资源。
2. 方法层整理：从素材中抽取方法层声明（判断该看什么/怎么判断），逐条评估 mechanism（有没有可检验的因果机制）/applicability（适用范围）/independent_sources（独立信源数，同源转述不计数）/verification。
3. 对象层整理：更新 evidence（必须带 region/time_window/expires/tier）。
4. 独立信源去重 + 冲突检测（conflicts 并列呈现，不调和）。
5. **收敛（本轮结束必须给结论，不得进入下一轮）**：基于已确认的 essential 证据给 best-effort 结论——status=converged，conclusion=do/dont/not_yet + conditions + next_step + confidence。
   - 未定案的 essential 假设（conflicted/unverified）**不许继续深挖**，转成 conclusion.conditions 里的"成立条件"（如"毛利 ≥25% 才做，验证方法：1688 采样 10 款 + 官方费用表"）；
   - 只当某 essential 完全无证据且无任何替代信号、结论会直接反转时，才允许 decision=not_yet，且必须给出最小补齐路径（一条取证任务卡，不再多轮搜索）。
   - 剩余不确定性必须写明（"哪些变量没实测、对结论影响多大"），但结论必须给。
6. **输出 expert_summary（沉淀专家 skill 用，收敛轮必填）**：从本轮方法层/反证/证据中提炼"慢变"经验——name（小写连字符）/description（何时用）/scope（适用边界）/baseline（已确认的指标键值，带来源与时间）/pitfalls（已被击穿的做法）。只存可复用的方法、基线与坑，禁止存时效性结论（具体品/价格当前能不能做属于对象层，不沉淀）。
7. 生成 subagent_tasks：对仍未关闭的 essential gaps（公开搜索无法补齐、需定向取证的），生成取证任务卡（
   {"agent":"investigator","task":"<一句话取证任务：验证哪个假设/补哪个缺口，写清需要什么数据，但不写死工具名——让取证员自行选择可达通道>","method_notes":"<方法层约束>"}）。任务卡必须自包含、优先免费公开通道、付费渠道需附替代信号。`,
  3: `## 本轮任务（第 3+ 轮：聚焦轮——只处理仍未定案的 essential 问题）
上一轮未收敛，本轮只聚焦"未定案"的 essential 假设（如果有，协议要求你列出是哪些；如果没有，立即 status=converged 输出结论，禁止空转）。
1. 只对仍未定案的 essential 假设：① 定向补一次检索（一个缺口一次，不再广搜）② 做反证检查（该假设成立本该出现什么信号）③ 更新该假设 status。
2. 输出**精简 delta JSON**（不要重写已定案的假设/方法层/证据——只输出变化）：
   {"status":"converged|in_progress","round":<轮次>,"goal":"<研究问题>","hypotheses":[仅未定案假设的新状态],"evidence":[仅本轮新增],"falsification":[仅本轮新增],"gaps":["更新后的缺口"],"conclusion":{"decision":"do|dont|not_yet","conditions":"<更新>","next_step":"<更新>"},"confidence":{"level":"low|medium|high","rationale":"<更新>"},"subagent_tasks":[仅新增的取证任务卡],"expert_summary":<有新增经验才输出，否则保持原样>}
3. 信息增益判定：若本轮无新增证据且无状态变化 → 必须 status=converged，把未定案项全部转成 conclusion.conditions 的成立条件，结束研究（禁止为"研究得更完美"空转）。
4. 决策截止：本轮结束必须给结论（do/dont/not_yet + 剩余不确定性）。`,
};

// 平衡大括号提取最外层 JSON（跳过字符串字面量与转义），与 plan.js 同款
function extractBalancedJson(text) {
  const fence = text.match(/```json\s*([\s\S]*?)```/);
  const src = fence ? fence[1] : text;
  let start = -1;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "{") { start = i; break; }
  }
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

// 跑一轮：注入协议 + 轮次任务 + 物料（goal/scope/上一轮状态/user_input）
// 超时保护：每轮最多 ROUND_TIMEOUT_MS，超时返回错误文本（防单轮卡死整次研究）
const ROUND_TIMEOUT_MS = 5 * 60_000;
async function runRound({ cwd, session, round, goal, scope, evidenceSpec, prior, userInput, toolCallId }) {
  researchProgressEmitter.emit({ toolCallId, round, phase: roundPhase(round), status: "running" });
  const systemBlock = `${PROTOCOL}\n\n${ROUND_TASKS[round]}`;
  const materials = {
    goal,
    scope: scope ?? "（未指定，如影响假设设计请在输出中提问）",
    evidence_spec: evidenceSpec ?? "（未指定，按协议自行推导每条假设的证据规格）",
    prior_state: prior ? { round: prior.round, status: prior.status, hypotheses: prior.hypotheses, evidence: prior.evidence, method_layer: prior.method_layer, conflicts: prior.conflicts, gaps: prior.gaps, confidence: prior.confidence } : null,
    user_input: userInput ?? null,
  };
  const started = Date.now();
  const task = runNode({
    cwd,
    key: session.sessionId, // 按父会话隔离 worker 常驻会话（多会话并行不串）
    systemBlock,
    materialsBlock: `## 研究物料\n${JSON.stringify(materials, null, 2)}`,
    onProgress: (delta) => {
      researchProgressEmitter.emit({ toolCallId, round, delta });
      if (process.env.RESEARCH_DEBUG) process.stdout.write(`[research r${round}] ${delta}`);
    },
  });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`第 ${round} 轮执行超时（>${ROUND_TIMEOUT_MS / 60000} 分钟），已中止`)), ROUND_TIMEOUT_MS)
  );
  try {
    const res = await Promise.race([task, timeout]);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[research] 第 ${round} 轮完成，耗时 ${elapsed}s`);
    researchProgressEmitter.emit({ toolCallId, round, phase: roundPhase(round), status: "done", elapsed });
    return typeof res === "string" ? res : res.text;
  } catch (err) {
    console.error(`[research] 第 ${round} 轮异常：${String(err?.message ?? err)}`);
    researchProgressEmitter.emit({ toolCallId, round, status: "error", note: String(err?.message ?? err) });
    return JSON.stringify({ status: "in_progress", round, goal, hypotheses: [], evidence: [], method_layer: [], conflicts: [], gaps: ["本轮执行异常/超时：" + String(err?.message ?? err)], confidence: { level: "low", rationale: "本轮未完成" }, conclusion: { decision: "not_yet", conditions: "本轮执行异常，证据未补齐", next_step: "重试或改用普通对话" } });
  }
}

// 解析轮次输出为 JSON；失败回喂重试一次（与 plan.js 同款容错）
async function runRoundWithRetry({ cwd, session, round, goal, scope, evidenceSpec, prior, userInput, toolCallId }) {
  const attempt = async () => {
    const text = await runRound({ cwd, session, round, goal, scope, evidenceSpec, prior, userInput, toolCallId });
    try {
      const raw = extractBalancedJson(text) ?? text;
      return { ok: true, parsed: JSON.parse(raw), text };
    } catch (err) {
      return { ok: false, text, error: err.message };
    }
  };
  let a = await attempt();
  if (a.ok) return a;
  // 重试：把"上次输出 + 解析错误"回喂，LLM 自修格式
  a = await attempt();
  if (a.ok) return a;
  return { ok: false, text: a.text, error: a.error };
}

// 主 agent 展示文案（进上下文，精炼交接摘要——研究报告全文在 research_round custom entry 可审计）
// 每轮产出摘要（markdown，供前端分区 MarkdownBody 渲染）：round1 假设清单 / round2 结论 / round3+ 更新
// 与 formatResult 不同：只提炼"本轮交接给下一轮"的精华，几行可读
function buildRoundSummary(state) {
  const lines = [];
  if (Array.isArray(state.hypotheses) && state.hypotheses.length) {
    const ess = state.hypotheses.filter((h) => h.weight === "essential" || !h.weight);
    const sec = state.hypotheses.filter((h) => h.weight === "secondary");
    lines.push(`**${state.hypotheses.length} 条假设**（${ess.length} essential / ${sec.length} secondary）`);
    for (const h of ess.slice(0, 6)) {
      lines.push(`- ${h.status === "rejected" ? "❌" : h.status === "supported" ? "✅" : h.status === "conflicted" ? "⚠️" : "○"} [${h.weight ?? "essential"}] ${h.id}: ${String(h.claim ?? "").slice(0, 60)}`);
    }
    if (sec.length) lines.push(`- （${sec.length} 条 secondary 不深挖：${sec.map((s) => s.id).join("/")}）`);
  }
  const c = state.conclusion ?? {};
  if (c.decision) {
    const label = { do: "✅ 做", dont: "❌ 不做", not_yet: "⏳ 还不能做" }[c.decision] ?? c.decision;
    lines.push(`\n**结论：${label}**${c.conditions ? ` — ${String(c.conditions).slice(0, 90)}` : ""}`);
  }
  if (state.confidence?.level) lines.push(`置信度：**${state.confidence.level}**（${String(state.confidence.rationale ?? "").slice(0, 70)}）`);
  const fz = state.falsification ?? [];
  if (fz.length) {
    lines.push(`\n反证检查：`);
    for (const f of fz.slice(0, 3)) lines.push(`- ${f.hypothesis}: ${String(f.interpretation ?? "").slice(0, 60)}`);
  }
  const ev = (state.evidence ?? []).length;
  if (ev) lines.push(`\n证据：${ev} 条`);
  return lines.join("\n") || "（本轮无产出）";
}

function formatResult(state) {
  const c = state.conclusion ?? {};
  const lines = [`## 研究结果（第 ${state.round} 轮，${state.status === "converged" ? "已收敛" : "证据不足"}）`];
  if (state.question) {
    lines.push(`需要用户输入：${state.question}`);
  } else {
    if (c.decision) {
      const label = { do: "✅ 做", dont: "❌ 不做", not_yet: "⏳ 还不能做" }[c.decision] ?? c.decision;
      lines.push(`结论：${label}${c.conditions ? ` — ${c.conditions}` : ""}`);
    }
    lines.push(`置信度：${state.confidence?.level ?? "?"}（${state.confidence?.rationale ?? ""}）`);
    const hyps = (state.hypotheses ?? []).map((h) => `- [${h.status}] ${h.id}: ${(h.claim ?? "").slice(0, 80)}`).join("\n");
    if (hyps) lines.push(`\n假设状态：\n${hyps}`);
    const evCount = (state.evidence ?? []).length;
    lines.push(`\n证据：${evCount} 条（明细在会话 research_round 条目，可审计）`);
    const ml = (state.method_layer ?? []).length;
    lines.push(`方法层：${ml} 条（机制/适用范围/验证状态在 research_round 条目）`);
    const gap = (state.gaps ?? []).map((g) => `- ${g}`).join("\n");
    if (gap) lines.push(`\n缺口：\n${gap}`);
    if (c.next_step) lines.push(`\n下一步：${c.next_step}`);
  }
  const st = (state.subagent_tasks ?? []).map((t, i) => `- 任务${i + 1} [${t.agent}]: ${t.task}（约束: ${t.method_notes}）`).join("\n");
  if (st) lines.push(`\n## 取证任务卡（可派 subagent 执行）\n${st}`);
  if (state.status !== "converged" && !state.question) lines.push(`\n建议：先派取证任务卡补齐证据，再收敛决策。`);
  return lines.join("\n");
}

export function createResearchTool({ getSession, cwd }) {
  return defineTool({
    name: "research",
    label: "专家研究",
    description:
      "专家研究引擎：对需要方法论/专家判断的研究型任务（选品、市场进入、投研、方案论证等），" +
      "内部自动连续跑最多 3 轮研究循环：广搜开题拆假设 → 定向补搜+分层整理+冲突检测 → 反证检查+收敛，" +
      "收敛或需要用户输入时才返回（不会中途回来烦你）。" +
      "产出：可证伪假设、带来源/地域/时间窗/失效日期的证据表、方法层条目、冲突、置信度、做/不做/还不能做的结论，" +
      "并在收敛时沉淀为可复用的专家 skill（.pi/skills/expert-*.md）。" +
      "适用场景：模型不知道'这类问题该怎么判断、需要什么证据'的任务（先成为专家再回答）。" +
      "纯信息查询（查价格/新闻/事实）不要用本工具，直接用 search。" +
      "重要：调用本工具前，先检查 .pi/skills/ 下是否已有匹配当前任务的 expert-* skill——" +
      "有则直接 read 加载使用（快速模式），不要重新研究；没有才调用本工具。" +
      "若返回 need_user_input（如缺目标市场/约束），向用户提问后再次调用本工具并传入 user_input 续跑。" +
      "返回中若含【取证任务卡】，说明公开搜索已无法补齐缺口——应直接派 subagent parallel 执行这些任务卡（agent=investigator），取证结果回来后汇总进最终判断。",
    parameters: Type.Object({
      goal: Type.String({ description: "研究问题（如：美区 TikTok Shop 解压玩具类目值不值得进入）" }),
      scope: Type.Optional(Type.String({ description: "目标市场/时间窗/约束（如：US，近90天，客单价<30美元）" })),
      evidence_spec: Type.Optional(Type.String({ description: "自定义证据规格（可选；缺省按协议自动推导）" })),
      user_input: Type.Optional(Type.String({ description: "上一轮 need_user_input 时用户提供的回答（续跑用）" })),
    }),
    execute: async (_toolCallId, params) => {
      const session = getSession();
      if (!session) return { content: [{ type: "text", text: "ERROR: 主会话不可用" }], details: {} };

      const goal = String(params.goal ?? "").trim();
      if (!goal) return { content: [{ type: "text", text: "goal 不能为空。" }], details: { isError: true } };

      // 读上一轮状态：同会话 research_round 条目（断点续接依据）
      let last = null;
      try {
        const rounds = session.sessionManager
          .getEntries()
          .filter((e) => e.type === "custom" && e.customType === "research_round")
          .map((e) => e.data);
        last = rounds[rounds.length - 1] ?? null;
      } catch {
        last = null;
      }

      // 续接判定：仅当上一轮同 goal 且未收敛时续跑；否则全新开题
      const userInput0 = params.user_input ? String(params.user_input) : null;
      let userInput = userInput0;
      let round = 1;
      let prior = null;
      if (last && last.goal === goal && last.status !== "converged") {
        if (last.status === "need_user_input") {
          if (!userInput) {
            // 用户还没回答：不重跑，把问题原样还给主 agent
            return { content: [{ type: "text", text: formatResult({ ...last, round: last.round }) }], details: { state: last } };
          }
          round = last.round; // 带用户回答重跑该轮
          prior = last;
        } else if (last.round < MAX_ROUNDS) {
          round = last.round + 1;
          prior = last;
        }
      }

      // 内部循环：最多 MAX_ROUNDS 轮，收敛/需用户输入才提前返回（与批准的设计一致：引擎自己跑，卡住才交回）
      let state = null;
      try {
      for (; round <= MAX_ROUNDS; round++) {
        const attempt = await runRoundWithRetry({ cwd, session, round, goal, scope: params.scope, evidenceSpec: params.evidence_spec, prior, userInput, toolCallId: _toolCallId });
        if (!attempt.ok) {
          console.error(`[research] 第 ${round} 轮解析失败（${attempt.error}），原始输出：\n${attempt.text}`);
          return { content: [{ type: "text", text: `研究第 ${round} 轮输出无法解析，请改用普通对话继续。` }], details: {} };
        }
        state = attempt.parsed;
        state.round = round;
        state.goal = goal;
        // 轮次完成事件（带本轮产出摘要，供前端分区 MarkdownBody 渲染）
        researchProgressEmitter.emit({ toolCallId: _toolCallId, round, status: "done", summary: buildRoundSummary(state) });
        // 状态落库（可审计 + 断点续接）
        try {
          session.sessionManager.appendCustomEntry("research_round", { ...state, at: Date.now() });
        } catch (err) {
          console.error(`[research] 状态落库失败：${err.message}`);
        }
        if (state.status === "converged" || state.status === "need_user_input") break;
        prior = state; // 下一轮携带本轮状态
        userInput = null; // 只在首轮注入用户回答，后续轮次不再携带
      }
      } catch (err) {
        console.error(`[research] execute 异常：${String(err?.stack ?? err?.message ?? err)}`);
        return { content: [{ type: "text", text: `研究引擎执行异常：${String(err?.message ?? err)}。可稍后重试或改用普通对话。` }], details: {} };
      }

      // 收敛 → 沉淀专家 skill（可复用领域资产，下次同类任务直接加载，不重新研究）
      let skillNote = "";
      if (state && state.status === "converged" && Array.isArray(state.method_layer) && state.method_layer.length > 0) {
        try {
          const skillFile = writeExpertSkill({ cwd, state });
          skillNote = skillFile ? `\n\n✅ 已沉淀专家 skill：\`${skillFile}\`（下次同类任务直接加载，无需重新研究）` : "";
        } catch (err) {
          console.error(`[research] 写专家 skill 失败：${err.message}`);
        }
      }

      // 研究完成事件：活动行更新为结论速览（前端 research_progress complete 分支消费）
      if (state) {
        const c = state.conclusion ?? {};
        const label = { do: "✅ 做", dont: "❌ 不做", not_yet: "⏳ 还不能做" }[c.decision] ?? c.decision;
        const conclusion = `研究完成 · ${label} · ${state.round ?? "?"} 轮 · 置信度 ${state.confidence?.level ?? "?"}`;
        researchProgressEmitter.emit({ toolCallId: _toolCallId, status: "complete", conclusion });
      }

      return {
        content: [{ type: "text", text: formatResult(state) + skillNote }],
        details: { state },
      };
    },
  });
}

// 自检：node tools/research.js（离模型验证纯函数）
import { pathToFileURL } from "node:url";
const SELF = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (SELF) {
  import("node:assert").then(({ default: assert }) => {
    const js = '{"a":1,"b":{"c":"x}","d":[1,2]}} trailing';
    assert.equal(extractBalancedJson(js), '{"a":1,"b":{"c":"x}","d":[1,2]}}');
    const fenced = 'text ```json\n{"ok":true}\n``` more';
    assert.equal(extractBalancedJson(fenced), '{"ok":true}');
    assert.equal(extractBalancedJson("no brace"), null);
    console.log("research.js 自检通过（extractBalancedJson）");
  });
}
