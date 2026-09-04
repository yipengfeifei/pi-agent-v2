// update_plan 工具：Codex 式轻量任务清单（pending/in_progress/completed）
// 复杂/多步/长任务 = 边干边更新这份清单；与重型 DAG（plan/worker/node_graph）完全隔离
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const STATUSES = ["pending", "in_progress", "completed"];
const MARK = { pending: "○", in_progress: "▶", completed: "✔" };

export function createUpdatePlanTool({ getSession }) {
  return defineTool({
    name: "update_plan",
    label: "轻量任务清单",
    description:
      "维护一份任务步骤清单，实时展示给用户（pending/in_progress/completed）。" +
      "复杂/多步/长任务开工前先调用建立清单；每完成一步立即调用更新状态；" +
      "理解变化（拆分/合并/重排步骤）时调用并附 explanation 说明变更原因。" +
      "同一时刻最多一个 in_progress；简单任务不要调用（一次能做完的不注水）。",
    parameters: Type.Object({
      plan: Type.Array(Type.Object({
        step: Type.String({ description: "步骤描述，一句话" }),
        status: Type.Union([
          Type.Literal("pending"),
          Type.Literal("in_progress"),
          Type.Literal("completed"),
        ], { description: "步骤状态" }),
      }), { description: "任务步骤列表" }),
      explanation: Type.Optional(Type.String({ description: "本次计划变更说明（可选）" })),
    }),
    execute: async (_toolCallId, params) => {
      const plan = Array.isArray(params.plan) ? params.plan : [];
      const err = validatePlan(plan);
      if (err) return { content: [{ type: "text", text: `ERROR: ${err}` }], details: {} };
      // 落 custom entry（不进模型上下文）：plan 工具 re-plan 时整体注入继承，与 node_graph 同机制
      getSession()?.sessionManager.appendCustomEntry("plan", {
        explanation: params.explanation ?? null,
        plan,
      });
      const lines = plan.map((p, i) => `${i + 1}. [${MARK[p.status] ?? p.status}] ${p.step}`);
      const header = params.explanation ? `计划已更新：${params.explanation}` : "计划已更新：";
      return {
        content: [{ type: "text", text: [header, ...lines].join("\n") }],
        details: { plan },
      };
    },
  });
}

export function validatePlan(plan) {
  if (!Array.isArray(plan)) return "plan 必须是数组";
  if (plan.some((p) => typeof p.step !== "string" || !p.step.trim())) return "每个 step 必须是非空字符串";
  if (plan.some((p) => !STATUSES.includes(p.status))) return `status 必须是 ${STATUSES.join("/")} 之一`;
  if (plan.filter((p) => p.status === "in_progress").length > 1) return "同一时刻最多一个 in_progress";
  return null;
}
