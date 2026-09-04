// 运行时工具：http_request + execution_app_snapshot（收编自旧 execution-tool-runtime）
// 浏览器能力走 ego-browser（skill + CLI，重叠工具砍掉），文件类用 pi 原生
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { snapshotMacApplication } from "../scripts/macos-accessibility-control.mjs";

export const httpRequestTool = defineTool({
  name: "http_request",
  label: "HTTP 请求",
  description: "发起 HTTP 请求（GET/POST/PUT/DELETE 等），返回状态码与响应体（JSON 自动解析）。用于调用 API、抓取网页原文、验证服务。",
  parameters: Type.Object({
    url: Type.String({ description: "完整 URL" }),
    method: Type.Optional(Type.String({ description: "GET/POST/PUT/DELETE，默认 GET" })),
    headers: Type.Optional(Type.Object({}, { additionalProperties: Type.String(), description: "请求头" })),
    body: Type.Optional(Type.Union([Type.String(), Type.Object({}, { additionalProperties: Type.Any() })]), { description: "请求体（对象自动转 JSON）" }),
  }),
  execute: async (_toolCallId, params) => {
    const method = String(params.method || "GET").toUpperCase();
    const response = await fetch(String(params.url), {
      method,
      headers: params.headers ?? (params.body === undefined ? undefined : { "content-type": "application/json" }),
      body: params.body === undefined || method === "GET" || method === "HEAD"
        ? undefined
        : typeof params.body === "string" ? params.body : JSON.stringify(params.body),
    });
    const raw = await response.text();
    let body = raw;
    try { body = JSON.parse(raw); } catch { /* 保留原文 */ }
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: response.ok, status: response.status, url: params.url, body }, null, 2).slice(0, 20000) }],
      details: { ok: response.ok, status: response.status },
    };
  },
});

export const appSnapshotTool = defineTool({
  name: "execution_app_snapshot",
  label: "桌面应用快照",
  description: "读取 macOS 应用当前可见界面结构和文本（无障碍 API），用于环境发现或验证软件操作结果。",
  parameters: Type.Object({
    appName: Type.String({ description: "应用名（菜单栏显示的名字，如 Safari、Finder）" }),
    maxDepth: Type.Optional(Type.Number({ description: "UI 树深度上限，默认 5" })),
  }),
  execute: async (_toolCallId, params) => {
    try {
      const snapshot = await snapshotMacApplication({ appName: params.appName, maxDepth: params.maxDepth });
      return {
        content: [{ type: "text", text: JSON.stringify(snapshot, null, 2).slice(0, 20000) }],
        details: {},
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `快照失败：${String(err?.message ?? err)}` }],
        details: { isError: true },
      };
    }
  },
});
