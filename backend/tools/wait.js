// wait_for 工具：任务需要等待外部事件时（邮件回复/审批/工单/人工操作），模型自主调用
// 工具立即返回（不阻塞 agent 循环），server 定时器到点后 followUp 自动唤醒继续
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export function createWaitTool({ scheduleWakeup }) {
  return defineTool({
    name: "wait_for",
    label: "等待后继续",
    description:
      "当前任务需要等待外部事件（邮件回复、审批、工单、下载、人工操作）时调用。" +
      "参数 minutes + note。工具立即返回，设定时间到后系统自动唤醒你继续（note 是到点后要检查/继续的内容）。" +
      "等待期间可以做其他事，也可以结束对话，到点会自动继续。",
    parameters: Type.Object({
      minutes: Type.Number({ description: "等待分钟数（1~1440）" }),
      note: Type.String({ description: "到点后要检查/继续的内容，如：检查 xx 邮箱是否有回复" }),
    }),
    execute: async (_toolCallId, params) => {
      const minutes = Math.max(1, Math.min(1440, Number(params.minutes) || 1));
      scheduleWakeup(minutes, String(params.note || "继续当前任务"));
      return {
        content: [{ type: "text", text: `已设定定时唤醒：${minutes} 分钟后继续（${params.note || "继续当前任务"}）。当前任务暂告一段落。` }],
        details: { minutes, note: params.note },
      };
    },
  });
}
