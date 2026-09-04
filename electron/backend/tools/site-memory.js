// 站点经验库：模型抓取数据网站（1688/GA/Sensor Tower 等）后沉淀提取经验（JS 脚本/选择器/注意事项），
// 下次直接复用，跳过"摸 DOM→猜选择器→试错"循环。
// 存储：backend/data/site-knowledge.json，键 = 站点域名。单用户只固化常用几个站，JSON 文件足够。
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const STORE = join(DATA_DIR, "site-knowledge.json");

function load() {
  try {
    return JSON.parse(readFileSync(STORE, "utf8"));
  } catch {
    return {};
  }
}
function save(kb) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE, JSON.stringify(kb, null, 2));
}

export const siteMemoryTool = defineTool({
  name: "site_memory",
  label: "站点经验库",
  description:
    "数据网站抓取经验库（按站点域名 + 页面类型存储提取脚本与注意事项）。\n" +
    "用法：\n" +
    "- list：抓取数据网站前可先查看已固化经验目录（只列站点/页面类型/更新时间，不含脚本），知道哪些站摸过、什么时候摸的。\n" +
    "- get：抓取过程中不顺畅时（选择器对不上/试错 2 次以上/提取数据有误）再取该站已固化脚本直接复用；不要一开始就全量注入。\n" +
    "- set：抓取成功且数据正确后，先评估本次抓取是否值得固化——只有经历了试错/踩坑（选择器修正≥2次、反爬/编码/结构坑、摸索出关键选择器或接口）且这次摸索能让下次同类抓取明显更流畅时才保存；一次成功、无需摸索的过程不要存。保存内容聚焦操作流畅度：关键选择器、页面内接口、数据口径、踩过的坑与规避方式，实现路径写完整（用什么命令/怎么打开/具体步骤），不要只写结论；发现更优方案用 set 覆盖同键，多种可行方案并存（如 URL 直拼 + UI 操作两条路径都保存）。\n" +
    "经验评估原则：发现已有经验『不可用』时，先排查是不是自己的实现方式有误（用错了环境/工具，如在页面 js 里 require 而环境没有），不要轻易否定经验；确认是站点改版/方案真失效后再更新。\n" +
    "反爬处理：遇到验证码/登录墙/持续失败（同一操作重试 2 次仍失败）时，停止尝试并输出提示让用户去 ego-browser 窗口人工完成验证/登录，等用户回复继续后再用同一 task space 接着抓，不要硬闯或反复重试。",
  parameters: Type.Object({
    action: Type.String({ description: "list=查看经验目录；get=按需取某站完整脚本；set=固化/覆盖成功方案" }),
    site: Type.Optional(Type.String({ description: "站点域名，如 1688.com（list 时可不填）" })),
    pageType: Type.Optional(Type.String({ description: "页面类型，如 search/forecast（list 时可不填）" })),
    script: Type.Optional(Type.String({ description: "set 时必填：验证跑通的提取 JS（ego-browser 的 js() 内使用的完整脚本）" })),
    notes: Type.Optional(Type.String({ description: "set 时可选：注意事项（登录要求/验证码/关键选择器/数据口径/反爬要点）" })),
  }),
  execute: async (_toolCallId, params) => {
    if (params.action === "list") {
      const kb = load();
      const lines = [];
      for (const [site, pages] of Object.entries(kb)) {
        for (const [pageType, entry] of Object.entries(pages)) {
          const note = entry.notes ? entry.notes.slice(0, 60) : "";
          lines.push(`- ${site}/${pageType}（${entry.updatedAt}）${note ? `：${note}` : ""}`);
        }
      }
      return {
        content: [{ type: "text", text: lines.length ? `站点经验目录：\n${lines.join("\n")}\n\n抓取不顺畅时用 get 取对应站点的完整脚本。` : "暂无任何站点经验。" }],
        details: { sites: Object.keys(kb) },
      };
    }
    const { site, pageType } = params;
    if (!site || !pageType) {
      return { content: [{ type: "text", text: "get/set 时 site 和 pageType 必填。" }], details: { isError: true } };
    }
    if (params.action === "set") {
      const script = String(params.script ?? "").trim();
      if (!script) {
        return { content: [{ type: "text", text: "set 时 script 必填（提取 JS 脚本）。" }], details: { isError: true } };
      }
      const kb = load();
      if (!kb[site]) kb[site] = {};
      kb[site][pageType] = {
        script,
        notes: String(params.notes ?? ""),
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      save(kb);
      return { content: [{ type: "text", text: `已保存 ${site}/${pageType} 经验。` }], details: { saved: true } };
    }
    // get
    const kb = load();
    const entry = kb[site]?.[pageType];
    if (!entry) {
      return { content: [{ type: "text", text: `${site}/${pageType} 暂无经验，请自行探索页面结构，成功后用 set 固化。` }], details: { found: false } };
    }
    return {
      content: [{ type: "text", text: `${site}/${pageType} 已有经验（更新于 ${entry.updatedAt}）：\n\n提取脚本（可直接用于 ego-browser 的 js()）：\n\`\`\`js\n${entry.script}\n\`\`\`\n${entry.notes ? `注意事项：${entry.notes}` : ""}` }],
      details: { found: true, script: entry.script, notes: entry.notes },
    };
  },
});
