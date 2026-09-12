// tavily_search 工具：时效/域定向/综合答案型搜索（Tavily API，读 ~/.tavily/config.json key）
// 与 search（anysearch 通用）互补：time_range 近期资讯、include_domains 白名单定向、include_answer 综合结论。
// execute 走内置 tvly 脚本（~/.pi/agent/bin/tvly，免装官方 CLI）。
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const TVLY = join(homedir(), ".pi/agent/bin/tvly");

export const tavilySearchTool = defineTool({
  name: "tavily_search",
  label: "Tavily 搜索（时效/域定向/综合答案）",
  description:
    "时效检索 + 域定向 + 可选综合结论（各参数取值见参数说明）。返回来源 JSON：标题 / URL / 摘要。",
  parameters: Type.Object({
    query: Type.String({ description: "搜索查询（英文优先）" }),
    time_range: Type.Optional(Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")], { description: "时效窗口：只返回该时间段内的结果" })),
    topic: Type.Optional(Type.Union([Type.Literal("general"), Type.Literal("news"), Type.Literal("finance")], { description: "主题：news=新闻、finance=金融" })),
    include_domains: Type.Optional(Type.String({ description: "白名单域名（逗号分隔，如 arxiv.org,sec.gov）" })),
    include_answer: Type.Optional(Type.Boolean({ description: "是否返回 AI 综合结论（answer）+ 来源" })),
    depth: Type.Optional(Type.Union([Type.Literal("basic"), Type.Literal("advanced")], { description: "basic=默认；advanced=更深入、更慢" })),
    max_results: Type.Optional(Type.Number({ description: "返回条数 1-20，默认 5" })),
  }),
  async execute(_toolCallId, params) {
    if (!existsSync(TVLY)) {
      return { content: [{ type: "text", text: "tavily_search 失败：内置 tvly 脚本不存在（预期 ~/.pi/agent/bin/tvly），且无官方 CLI。先恢复脚本或安装 tvly。" }], isError: true, details: {} };
    }
    const args = ["search", params.query, "--json"];
    if (params.time_range) args.push("--time-range", params.time_range);
    if (params.topic) args.push("--topic", params.topic);
    if (params.include_domains) args.push("--include-domains", params.include_domains);
    if (params.include_answer) args.push("--include-answer", "advanced");
    if (params.depth) args.push("--depth", params.depth);
    args.push("--max-results", String(Math.min(Math.max(Number(params.max_results) || 5, 1), 20)));
    try {
      const stdout = execFileSync(TVLY, args, { encoding: "utf-8", timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
      return { content: [{ type: "text", text: stdout.slice(0, 60000) }], details: { argv: args.slice(0, 3), engine: "tavily-api" } };
    } catch (e) {
      return { content: [{ type: "text", text: `tavily_search 执行失败：${String(e?.message || e).slice(0, 500)}` }], isError: true, details: {} };
    }
  },
});
