// plan 工具：两阶段（Stage 1 意图收集 → Stage 2 拆图）
// 多轮收集由主 agent 驱动：plan 返回 needsClarification → 主 agent 问用户 → 再调 plan(带已收集信息)
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runNode } from "../worker-session.js";

const STAGE_PROMPT = `你是任务理解与规划器。分阶段处理：先理解用户意图（Stage 1），再决定是否生成节点图（Stage 2）。

## Stage 1：意图判断（每轮都做，输出三种形态之一）
1. 纯交流（用户只是聊天/问问题，不需要干活）→ {"interactionMode":"conversation","reply":"一句自然回复"}
2. 需要澄清（存在**方案阻塞型**信息缺失）→ {"needsClarification":true,"question":"唯一最小问题"}
3. 可以规划（方案阻塞型信息已够）→ 进入 Stage 2

## 信息四分类（提问边界，必须严格区分）
遇到信息缺口时，先分类再决定是否问用户：

**1. 方案阻塞型（必须问用户，缺它无法设计 workflow 结构）**
- 例：用户要"方案"还是"执行结果"？交付形态（文档/演示/代码）？最终用户/受众是谁？验收标准由谁定？
- 这类缺失时返回 needsClarification，每轮最多 1 个问题

**2. 可推断型（不问，用合理默认 + 标注假设）**
- 不影响 workflow 结构的细节：风格偏好、色彩、措辞口味、小参数
- 例：婚礼风格偏好不影响"供应商调研→方案→执行"的骨架，默认并标注
- 默认与假设统一放可选字段 assumptions：必须是 key:value 对象（如 {"platforms":"欧美平台","priceRange":"未指定"}）；禁止写成 {"一段话"} 这类只含裸字符串的对象

**3. 可 gather 型（不问用户，运行中由 Fetch/Gather 节点搜索/环境发现）**
- 外部事实：市场数据、价格、场地、政策、竞品——搜索/调研能拿到
- 例："北京有哪些户外婚礼场地"→ 不是问用户，是 n 号 Fetch/Gather 节点的任务

**4. 物料索取型（不阻塞拆图，但运行前必须向用户索要具体文件/材料）**
- workflow 要处理的具体输入物：待审核的发票、待翻译的文档、待分析的报表
- 拆图照常（物料不改变图结构），但图必须带 requiredMaterials 字段：
  [{"name":"发票文件","desc":"需要审核的发票 PDF 或图片"}]
- 主 agent 拆图后、运行前向用户索要；用户提供后 worker 执行相关节点时并入

## 意图推断链（复杂项目必做）
- 显式目标：用户说了什么
- 隐藏目标：用户真正要达成的结果（如"策划婚礼"的隐藏目标是"办好婚礼"）
- 衡量指标 successCriteria：怎么算成功，3~5 条可验证指标（如亲友满意、成本可控、流程不出岔子）

## 逐步收缩
- 每轮只问 1 个**方案阻塞型**问题；类 2 忽略、类 3 转节点、类 4 进 requiredMaterials
- 用户已明确同意推进且无类 1 缺口时，必须停止询问进入 Stage 2

## Stage 2：生成节点图（仅当可以规划）
- 简单任务（单次会话能直接完成）→ {"direct":true}
- 复杂任务 → {"nodes":[...],"successCriteria":[...]}
  - successCriteria：Stage 1 推断出的衡量指标（最终产物验收标准）
  - requiredMaterials（如有类 4）：[{name,desc}]，运行前向用户索要
  - 每节点带 serves 字段：该节点主要服务哪些衡量指标
  - 节点格式：{"id":"n1","type":"<12类之一>","name":"简短名","deps":[],"input":[],"output":"产出名","prompt":"自包含指令","serves":["指标关键词"]}
  - type 必须是 12 类之一：Fetch/Gather, Standardize, Classify/Route, Extract/Validate, Generate/Draft, Transform/Produce, Analyze/Judge, Strategize/Plan, Writeback/Action, Review/Gate, Artifact/Render, Monitor/Alert
  - deps：上游节点 id；input：需要的上游产出名；output：本节点产出名
  - 节点 2~8 个；prompt 只写"做什么 + 产出什么"，不写具体内容
  - Fetch/Gather 节点的 prompt 必须包含以下固定引导（节点执行在隔离上下文，提示词不会污染主会话）：
    "抓取数据网站（如电商/数据平台/榜单）前，先调用 site_memory list 查看已固化经验目录；抓取不顺畅（选择器对不上/试错 2 次以上）时 site_memory get 取该站完整脚本复用；抓取成功且踩了坑（选择器/编码/反爬/结构）后 site_memory set 固化（只存让下次更流畅的经验）；遇验证码/登录墙停下提示用户人工验证。\n" +
    "    Fetch/Gather 节点 prompt 还须包含搜索结果评估引导：拿到检索结果后先评估再使用——相关性（是否真对题）、时效性（数据类要最新）、权威性（一手 vs 二手转述，厂商自报打折）、多源交叉（关键结论至少 2-3 个独立来源）、矛盾检测（来源冲突必须指出，不自行调和）",

只输出 JSON，不要其他文字。`;

// 平衡大括号提取最外层 JSON（跳过字符串字面量与转义），比正则可靠
function extractBalancedJson(text) {
  const fence = text.match(/```json\s*([\s\S]*?)```/);
  const src = fence ? fence[1] : text;
  let start = -1;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "{") { start = i; break; }
  }
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
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
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

// 解析模型输出为 plan JSON；失败返回 { ok:false, result, error }（result 供重试回喂）
async function runPlanOnce(runNode, block) {
  const res = await runNode(block);
  // runNode 返回 { text, artifacts }；plan 用文本，artifacts 忽略
  const result = typeof res === "string" ? res : res.text;
  try {
    const raw = extractBalancedJson(result) ?? result;
    return { ok: true, parsed: JSON.parse(raw), result };
  } catch (err) {
    return { ok: false, result, error: err.message };
  }
}

// 生成图时附加 runId（uuid）+ title（首节点名），供跨图区分与断点续接识别
import { randomUUID } from "node:crypto";

// 失败自动重试一次：把"上次输出 + 具体解析错误"回喂，LLM 自修格式错误的成功率很高
export async function runPlanWithRetry(runFn, block) {
  const attempt = await runPlanOnce(runFn, block);
  if (attempt.ok) return attempt;
  const retryBlock = `${block}\n\n## 上次输出（JSON 解析失败：${attempt.error}）\n${attempt.result}\n\n请修正为严格合法的 JSON，重新输出完整结果。`;
  return runPlanOnce(runFn, retryBlock);
}

// 拆图成功 → 附加 runId/title/created（跨图区分 + 断点续接的持久依据）。纯函数，可离模型测试。
export function annotateGraph(parsed) {
  if (!parsed?.nodes?.length) return parsed;
  return {
    ...parsed,
    runId: randomUUID(),
    title: parsed.nodes[0]?.name ?? "任务",
    created: Date.now(),
  };
}

// 拆图前整体注入已有计划/节点图（不细拆字段；模型自己读）：
// 轻量清单（customType "plan"）→ 继承目标与当前进度；上次 node_graph → 重规划不丢成功标准/不重复失败路径
function priorPlanContext(session) {
  const entries = session?.sessionManager?.getEntries?.() ?? [];
  const plans = entries.filter((e) => e.type === "custom" && e.customType === "plan").map((e) => e.data);
  const graphs = entries.filter((e) => e.type === "custom" && e.customType === "node_graph").map((e) => e.data);
  const parts = [];
  if (plans.length) parts.push(`## 已有任务清单（继承其中目标与当前进度，不要重复已完成步骤）\n${JSON.stringify(plans[plans.length - 1])}`);
  if (graphs.length) parts.push(`## 已有节点图（若需重新规划，必须继承其成功标准；已失败/放弃的路径不得重复）\n${JSON.stringify(graphs[graphs.length - 1])}`);
  return parts.length ? "\n\n" + parts.join("\n\n") : "";
}

export function createPlanTool({ cwd, getSession }) {
  return defineTool({
    name: "plan",
    label: "任务理解与拆解",
    description:
      "两阶段理解任务：先推断用户意图（可能返回需要澄清的问题，你必须问用户并再次调用 plan 带上回答），" +
      "再生成节点图。输出 JSON：{\"interactionMode\":\"conversation\",\"reply\":...} 表示纯交流直接回复；" +
      "{\"needsClarification\":true,\"question\":...} 表示需要问用户一个问题；" +
      "{\"direct\":true} 或 {\"nodes\":[...],\"successCriteria\":[...]} 表示拆图（之后用 worker 逐节点执行）。",
    parameters: Type.Object({
      goal: Type.String({ description: "用户目标" }),
      history: Type.Optional(Type.String({ description: "已收集的信息（前几轮用户的回答/澄清内容），首次调用可不传" })),
    }),
    execute: async (_toolCallId, params) => {
      const session = getSession();
      const historyBlock = params.history ? `\n\n## 已收集信息（来自与用户的对话）\n${params.history}` : "";
      const materialsBlock = `## 用户目标\n${params.goal}${historyBlock}${priorPlanContext(session)}`;
      const attempt = await runPlanWithRetry(
        (block) => runNode({ cwd, systemBlock: STAGE_PROMPT, materialsBlock: block }),
        materialsBlock
      );
      if (!attempt.ok) {
        // 二次失败兜底：简短提示，不向用户泄漏原始输出（完整原文进服务端日志）
        console.error(`[plan] 两次解析均失败（${attempt.error}），原始输出：\n${attempt.result}`);
        return { content: [{ type: "text", text: "无法拆解该任务，请改用普通对话继续。" }], details: {} };
      }
      const parsed = attempt.parsed;
      // 拆图成功 → 图写进主会话 custom 事件（画布数据源 + 断点续接的持久依据）
      if (parsed.nodes) {
        session?.sessionManager.appendCustomEntry("node_graph", annotateGraph(parsed));
      }
      return {
        content: [{ type: "text", text: `plan 结果：\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\`` }],
        details: { plan: parsed },
      };
    },
  });
}
