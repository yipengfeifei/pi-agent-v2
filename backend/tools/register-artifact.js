// register_artifact 工具：显式登记产物（writer 自动登记是 watcher/write 分支覆盖不到时的人工入口）
// 与 server.js 的 registerArtifact(p, opts) 对接；explicit=true 表示人工登记，允许显式指定路径
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export function createRegisterArtifactTool({ registerArtifact, getHandle }) {
  return defineTool({
    name: "register_artifact",
    label: "登记产物",
    description:
      "把会话产物文件登记进 artifact 列表（前端展开区可预览）。write/bash 写出的白名单交付物会自动登记，一般不需要手动调用；" +
      "仅当产物是动态生成/外部拷贝、且确认应出现在当前会话 artifact 区时使用。",
    parameters: Type.Object({
      path: Type.String({ description: "产物文件路径（相对当前 cwd 或绝对路径）" }),
      allow_outside_cwd: Type.Optional(Type.Boolean({ description: "允许登记 cwd 外的文件（默认 false）" })),
    }),
    async execute(_toolCallId, params) {
      const handle = getHandle();
      if (!handle?.session) {
        return { content: [{ type: "text", text: "当前无活动会话，无法登记产物。" }], isError: true, details: {} };
      }
      registerArtifact(String(params.path), {
        allowOutsideCwd: params.allow_outside_cwd === true,
        explicit: true,
      });
      return { content: [{ type: "text", text: `已登记产物：${params.path}` }], details: {} };
    },
  });
}
