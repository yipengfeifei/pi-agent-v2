// read_page 工具：URL → 定向字段（补漏工具，不替代 search）
// 设计（2026-08-27 讨论）：只有 search 快照拿不到目标数据点才调；输出定向、不全文 dump；
// 通道：Jina Reader（r.jina.ai，无 key 匿名 ~20RPM；优先 JINA_API_KEY：环境变量 > skill .env）
// JS 渲染页面加 browser=true（X-Engine: browser）
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

let cachedKey;
function getJinaKey() {
  if (cachedKey !== undefined) return cachedKey;
  cachedKey = process.env.JINA_API_KEY ?? "";
  if (!cachedKey) {
    const envPath = join(homedir(), ".pi/agent/skills/read-page/.env");
    try {
      if (existsSync(envPath)) {
        for (const line of readFileSync(envPath, "utf8").split("\n")) {
          const m = line.trim().match(/^JINA_API_KEY\s*=\s*(.+)$/);
          if (m) { cachedKey = m[1].trim().replace(/^["']|["']$/g, ""); break; }
        }
      }
    } catch { /* 无 key 就当匿名 */ }
  }
  return cachedKey;
}

const JUNK_RE = /subscribe|newsletter|cookie|accept all|skip to main|related (posts|articles)|back to blog/i;

export const readPageTool = defineTool({
  name: "read_page",
  label: "读取网页（定向提取字段）",
  description:
    "Jina 抓任意网页为 Markdown（JS 渲染可过），补 search 快照之外、页面内的具体数据点。参数取值见参数说明。",
  parameters: Type.Object({
    url: Type.String({ description: "要读取的网页完整 URL（含协议）" }),
    extract: Type.Optional(Type.String({ description: "要定向提取的目标字段（如：价格、月销、卖家数）" })),
    browser: Type.Optional(Type.Boolean({ description: "是否走 JS 渲染（动态渲染页面用，默认 false）" })),
    max_chars: Type.Optional(Type.Number({ description: "返回内容上限（默认 6000）" })),
  }),
  async execute(_toolCallId, params) {
    const url = String(params.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return { content: [{ type: "text", text: "url 必须是完整 http(s) 链接。" }], isError: true, details: {} };
    }
    const maxChars = Math.min(Math.max(Number(params.max_chars) || 6000, 1000), 20000);
    const headers = { "x-return-format": "markdown" };
    const key = getJinaKey();
    if (key) headers.authorization = `Bearer ${key}`;
    if (params.browser) headers["x-engine"] = "browser";
    try {
      const resp = await fetch(`https://r.jina.ai/${url}`, { headers, signal: AbortSignal.timeout(60000) });
      if (!resp.ok) {
        return { content: [{ type: "text", text: `读取失败：HTTP ${resp.status}。可重试；页面需登录/JS 时加 browser=true；仍不行用 ego-browser。` }], isError: true, details: {} };
      }
      const md = await resp.text();
      // 定向：只留正文段，去广告/订阅行噪音，控制在 maxChars
      const cleaned = md
        .split("\n")
        .filter((l) => !JUNK_RE.test(l))
        .join("\n")
        .trim();
      const header = cleaned.split("\n").slice(0, 6).join("\n"); // Title/URL/时间等
      const focus = params.extract ? `\n\n【目标字段】${params.extract}` : "";
      const body = cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}\n…（已截断，仅保留前 ${maxChars} 字符）` : cleaned;
      return {
        content: [{ type: "text", text: `${header}${focus}\n\n${body}` }],
        details: { url, via: "jina-reader", browser: !!params.browser, chars: body.length },
      };
    } catch (err) {
      return { content: [{ type: "text", text: `读取失败：${String(err?.message || err).slice(0, 400)}。可重试或改用 ego-browser 直接访问。` }], isError: true, details: {} };
    }
  },
});
