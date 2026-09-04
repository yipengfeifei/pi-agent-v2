// worker 工具：执行节点图中的单个节点
// 入参：graph（节点图 JSON 文本）+ nodeId；上游物料从主会话 node_output 事件读取
import { defineTool, SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { nodeTypeSkillId, loadSkillText } from "./node-types.js";
import { runNode } from "../worker-session.js";

// 节点实时心跳广播：worker 工具推 text_delta → server.js 订阅并转发前端 WS
// 单客户端假设（与 server 一致），切会话时前端重投即可
export const nodeProgressEmitter = (() => {
  const subs = new Set();
  return {
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    emit(evt) { for (const fn of subs) { try { fn(evt); } catch {} } },
  };
})();

const NODE_TYPES_HINT = [
  "Fetch/Gather", "Standardize", "Classify/Route", "Extract/Validate", "Generate/Draft",
  "Transform/Produce", "Analyze/Judge", "Strategize/Plan", "Writeback/Action",
  "Review/Gate", "Artifact/Render", "Monitor/Alert",
].join(", ");

export function createWorkerTool({ getSession, cwd }) {
  return defineTool({
    name: "worker",
    label: "节点执行",
    description:
      `执行节点图中指定的单个节点（由 plan 工具生成的图）。` +
      `参数：graph=节点图 JSON 文本，nodeId=要执行的节点 id。` +
      `节点类型必须是 12 类之一：${NODE_TYPES_HINT}。` +
      `执行前校验上游依赖（node_output 是否存在），未满足会拒绝执行并提示。` +
      `返回该节点的执行结果摘要。`,
    parameters: Type.Object({
      graph: Type.String({ description: "plan 生成的节点图 JSON 文本" }),
      nodeId: Type.String({ description: "要执行的节点 id，如 n1" }),
      materials: Type.Optional(Type.String({ description: "用户提供的物料 JSON（plan 的 requiredMaterials 对应物），并入节点上下文" })),
    }),
    execute: async (_toolCallId, params) => {
      let graph;
      try {
        graph = JSON.parse(params.graph);
      } catch {
        return { content: [{ type: "text", text: "ERROR: graph 不是合法 JSON" }], details: {} };
      }
      const node = (graph.nodes || []).find((n) => n.id === params.nodeId);
      if (!node) {
        return { content: [{ type: "text", text: `ERROR: 图中找不到节点 ${params.nodeId}。可用节点：${(graph.nodes || []).map((n) => n.id).join(", ")}` }], details: {} };
      }

      const session = getSession();
      if (!session) return { content: [{ type: "text", text: "ERROR: 主会话不可用" }], details: {} };

      // 1. 校验依赖：上游节点的 output 必须已有 node_output 记录
      // 用主 session 的 SessionManager 实例读（内存可见，不依赖磁盘 flush）
      // 作用域 = (runId, nodeId)：同一张图的节点才互相可见，跨图 nodeId(n1) 不串
      // runId 容错：模型调 worker 时常把 plan 图的 runId 弄丢（node_graph 是 custom entry 不进上下文），
      // 缺省时从主会话最新 node_graph 补，保证输出带正确 runId 作用域
      let runId = graph.runId ?? null;
      if (!runId) {
        const graphs = session.sessionManager
          .getEntries()
          .filter((e) => e.type === "custom" && e.customType === "node_graph")
          .map((e) => e.data);
        runId = graphs[graphs.length - 1]?.runId ?? null;
      }
      const upstream = (graph.nodes || []).filter((n) => (node.deps || []).includes(n.id));
      const outputs = session.sessionManager
        .getEntries()
        .filter((e) => e.type === "custom" && e.customType === "node_output");
      const produced = new Map(
        outputs
          .filter((o) => (o.data?.runId ?? null) === runId)
          .map((o) => [o.data?.nodeId, o.data?.output ?? ""])
      );
      // 依赖校验：本节点 input 声明了上游 output，但上游没有 node_output 记录 → 拒绝
      const missing = upstream.filter((n) => (node.input || []).includes(n.output) && !produced.has(n.id));
      if (missing.length > 0) {
        return {
          content: [{ type: "text", text: `依赖未满足：节点 ${missing.map((n) => `${n.id}(${n.output})`).join(", ")} 尚未产出，先执行它们。当前已产出：${[...produced.keys()].join(", ") || "无"}` }],
          details: {},
        };
      }

      // 2. 组装物料：按 input 声明取上游产出
      const materials = {};
      for (const name of node.input || []) {
        const src = upstream.find((n) => n.output === name);
        if (src && produced.has(src.id)) materials[name] = produced.get(src.id);
      }
      // 用户提供的物料（plan requiredMaterials 对应物）并入，优先级高于上游产出
      if (params.materials) {
        try {
          const userProvided = JSON.parse(params.materials);
          for (const [k, v] of Object.entries(userProvided)) {
            if (!(k in materials)) materials[k] = v;
          }
        } catch {
          materials["user_materials"] = String(params.materials);
        }
      }
      const materialsBlock = `## 交接物料（本节点 input 声明）\n${Object.keys(materials).length ? JSON.stringify(materials, null, 2) : "（无上游物料，纯独立节点）"}`;

      // 3. 组装 skill 注入（12 类 toolkit + 节点自带的 profile skillIds）
      const skillIds = [nodeTypeSkillId(node.type), ...(node.skillIds || [])].filter(Boolean);
      const skillBlock = skillIds
        .map((id) => `### Skill: ${id}\n${loadSkillText(id) ?? "（未找到 skill 文件）"}`)
        .join("\n\n");
      // 终端节点（无下游消费者）= 最终交付：面向用户写 md/html/图片；非终端 = 机器可消费的中间数据
      const isTerminal = !(graph.nodes || []).some((n) => (n.deps || []).includes(node.id));
      const systemBlock = [
        `## 当前节点任务（${node.type}）`,
        `目标：${node.name || ""}${node.prompt ? `\n指令：${node.prompt}` : ""}`,
        isTerminal
          ? `产出要求：这是最终交付节点，产出面向最终用户：文档写 Markdown（.md）、网页写 .html、图片按需；不要用 .json 等中间数据格式。`
          : `产出要求：输出名为 "${node.output}"，内容应可直接被下游节点消费（json 等中间格式仅限本节点与下游之间）。`,
        skillBlock ? `\n## 节点执行规范（必须遵守）\n${skillBlock}` : "",
      ].filter(Boolean).join("\n");

      // 4. 干净上下文执行。onProgress 实时心跳 → 广播前端（展开区显示模型正在写的文字）
      const { text: resultText, artifacts } = await runNode({
        cwd,
        key: session.sessionId, // 按父会话隔离 worker 常驻会话（多会话并行不串）
        systemBlock,
        materialsBlock,
        nodeType: node.type, // Artifact 判定：只收产出型节点写出的交付物
        onProgress: (delta) => {
          // 进主会话持久（断点/重放可见）→ 用 appendCustomEntry 会刷盘较慢，广播给前端即可；持久化在 end 时由主 agent 上下文摘要承担
          nodeProgressEmitter.emit({ runId, nodeId: node.id, delta, at: Date.now() });
        },
      });

      // 5. 产出写回主会话（custom entry，不参与主 agent 上下文），带 runId 作用域 + 产物文件
      try {
        session.sessionManager.appendCustomEntry("node_output", { runId, nodeId: node.id, output: resultText, artifacts, nodeType: node.type });
      } catch (err) {
        return { content: [{ type: "text", text: `ERROR: 写回产出失败：${err.message}` }], details: {} };
      }

      // 6. 返回摘要（进主 agent 上下文）
      const summary = resultText.length > 1500 ? `${resultText.slice(0, 1500)}\n…（已截断，完整产出存会话事件）` : resultText;
      return {
        content: [{ type: "text", text: `节点 ${node.id}(${node.name}) 执行完成，产出已写入会话。\n\n${summary}` }],
        details: { nodeId: node.id },
      };
    },
  });
}
