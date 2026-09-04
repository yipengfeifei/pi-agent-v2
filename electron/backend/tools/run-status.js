// run_status 工具：主 agent 续接时的节点进度查询
// 背景：node_output 是 custom entry 不进主 agent 上下文，模型"继续"旧任务时看不到产出，
// 会误判"内容丢失"重跑。此工具让模型主动查各 run 的节点状态 + 产出位置。
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export function createRunStatusTool({ getSession }) {
  return defineTool({
    name: "run_status",
    label: "节点进度查询",
    description:
      `查询当前会话各 workflow run 的节点执行进度（哪些节点已完成/产出在哪）。` +
      `用于继续执行旧任务时先确认断点：已完成的节点不要重跑，产出从 node_output 读。` +
      `返回每个 run 的标题、runId、节点状态（done/pending）、产出摘要。`,
    parameters: Type.Object({
      runId: Type.Optional(Type.String({ description: "可选：只看指定 run；缺省返回全部" })),
    }),
    execute: async () => {
      const session = getSession();
      if (!session) return { content: [{ type: "text", text: "ERROR: 主会话不可用" }], details: {} };
      const entries = session.sessionManager?.getEntries?.() || [];
      const graphs = entries.filter((e) => e.type === "custom" && e.customType === "node_graph").map((e) => e.data);
      const outputs = entries.filter((e) => e.type === "custom" && e.customType === "node_output").map((e) => e.data);
      if (graphs.length === 0) {
        return { content: [{ type: "text", text: "当前会话还没有节点图（无 workflow 任务）" }], details: {} };
      }
      const lines = graphs.map((g, gi) => {
        const nodeIds = (g?.nodes ?? []).map((n) => n.id);
        const runOutputs = g?.runId
          ? outputs.filter((o) => (o?.runId ?? null) === g.runId)
          : outputs.slice(0, nodeIds.length);
        const done = new Set(runOutputs.map((o) => o?.nodeId).filter(Boolean));
        const nodes = (g?.nodes ?? []).map((n) => {
          const out = runOutputs.find((o) => o?.nodeId === n.id);
          return `  ${n.id} [${done.has(n.id) ? "done" : "pending"}] ${n.name || n.type}` +
            (out?.artifacts?.length ? ` → 产出文件: ${out.artifacts.join(", ")}` : "") +
            (out?.output && !out?.artifacts?.length ? ` → 产出: ${String(out.output).slice(0, 120)}` : "");
        });
        return `run ${gi + 1}${g?.title ? `（${g.title}）` : ""} runId=${g?.runId ?? "无"}：\n${nodes.join("\n")}`;
      });
      return { content: [{ type: "text", text: lines.join("\n\n") }], details: {} };
    },
  });
}
