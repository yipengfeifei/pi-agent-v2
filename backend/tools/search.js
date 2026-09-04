// search 工具：统一搜索入口——模型不再手写 bash 调 anysearch CLI + grep 管道
// 内部直连 anysearch JSON-RPC；清洗/切句/索引/来源表为固定后处理，不依赖模型当场发明
// 语言策略在 description 里引导模型：知识/信息类查询主动译成英文再搜（英文语料质量数量远高于中文）
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ENDPOINT = "https://api.anysearch.com/mcp";
const DOMAINS = ["general","resource","social_media","finance","academic","legal","health","business","security","ip","code","energy","environment","agriculture","travel","film","gaming"];

// 搜索结果广播：sources（标题/URL）→ 前端展开区渲染（favicon + 网页列表），与 researchProgressEmitter 同构
export const searchResultsEmitter = (() => {
  const subs = new Set();
  return {
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    emit(evt) { for (const fn of subs) { try { fn(evt); } catch {} } },
  };
})();

// —— API key：环境变量 > anysearch skill .env（V2 独立项目，但 key 是用户全局资产）；无 key 匿名可用（限流更低）——
let cachedKey;
function getApiKey() {
  if (cachedKey !== undefined) return cachedKey;
  cachedKey = process.env.ANYSEARCH_API_KEY ?? "";
  if (!cachedKey) {
    const envPath = join(homedir(), ".pi/agent/skills/anysearch/.env");
    try {
      if (existsSync(envPath)) {
        for (const line of readFileSync(envPath, "utf8").split("\n")) {
          const m = line.trim().match(/^ANYSEARCH_API_KEY\s*=\s*(.+)$/);
          if (m) { cachedKey = m[1].trim().replace(/^["']|["']$/g, ""); break; }
        }
      }
    } catch { /* 读不到就当匿名 */ }
  }
  return cachedKey;
}

// 简单域启发式：只覆盖高频场景（价格/代码），其余 general；模型可显式传 domain 覆盖
// ponytail: 更多垂直域靠显式参数，启发式不铺开
function guessDomain(q) {
  const s = q.toLowerCase();
  if (/价格|股价|股票|融资|估值|财报|pricing|price|stock|ticker|revenue|arr\b|ipo|earnings/.test(s)) return "finance";
  if (/函数|报错|语法|依赖|代码|api\b|library|framework|npm|python|javascript|typescript|syntax|debug|bug\b|error/.test(s)) return "code";
  return "general";
}

// —— 后处理：纯函数，可离模型测试 ——
const JUNK_RE = /subscribe|newsletter|back to blog|skip to main content|continue reading|related (posts|articles)|cookie|advertis|sponsored|follow us|share this|accept all/i;
const STOPWORDS_ZH = new Set("的 了 是 在 和 与 及 或 有 对 就 都 而 被 把 让 这 那 我 你 他 她 它 们 个 一 不 也 很 吗 呢 吧 啊 于 之 为 用 到 从 上 下 中 并 且 但 能 会 要 想 说 看 问 做 请 给".split(" "));
const STOPWORDS_EN = new Set("a an the of to in on for and or with is are was were be been at by from as it its this that these those i you he she we they".split(" "));

// 查询关键词：中文取去停用词后的整串（软匹配，命中不了就走全保留兜底），英文取 ≥3 字符实词；无关键词返回 null（不过滤）
function queryKeywords(q) {
  const s = q.trim();
  if (/[\u4e00-\u9fff]/.test(s)) {
    const kws = [...s].filter((c) => !STOPWORDS_ZH.has(c) && !/[\s\p{P}]/u.test(c)).join("");
    return kws.length >= 2 ? [kws] : null;
  }
  const words = [...new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS_EN.has(w)))];
  return words.length ? words : null;
}

// 切句：[。！？!?；;.] + 空白 + 大写/数字/CJK 开头；清洗广告行/短句/去重
function splitSentences(text) {
  return [...new Set(
    text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // markdown 链接只留文字
      .replace(/\*\*/g, "")
      .split(/(?<=[。！？!?；;.])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 20 && s.length <= 400 && !JUNK_RE.test(s))
  )];
}

// 软相关度过滤：≥1 关键词命中才保留；全不命中则全保留（宁可宽不可空）
function filterRelevant(sentences, kws) {
  if (!kws) return sentences;
  const hit = sentences.filter((s) => kws.some((k) => s.toLowerCase().includes(k)));
  return hit.length ? hit : sentences;
}

// 解析 anysearch markdown：### N. 标题 / - **URL**: / 正文段
function parseResults(md) {
  const blocks = [];
  for (const sec of md.split(/^### \d+\.\s*/m).slice(1)) {
    const lines = sec.split("\n");
    const title = (lines[0] ?? "").trim();
    const url = lines.find((l) => /^-\s*\*\*URL\*\*/.test(l))?.match(/:\s*(\S+)/)?.[1];
    const body = lines.slice(1).filter((l) => !/^-\s*\*\*URL\*\*/.test(l)).join("\n").trim();
    if (title && url) blocks.push({ title, url, body });
  }
  return blocks;
}

export const searchTool = defineTool({
  name: "search",
  label: "网络搜索",
  description:
    "统一搜索工具（替代手写 bash 调 anysearch CLI + grep 管道）。搜索事实/数据/资料/资讯/口碑时用本工具，禁止再用 bash 拼 grep 管道提取。\n" +
    "语言策略：知识/信息类查询（技术教程、评测对比、资料文档、新闻）用英文搜，英文语料的质量与数量远高于中文——先把查询翻译成英文再搜；仅当目标明确是中文内容（中文新闻、本地服务、中文社区口碑、中文文档）时才保留中文。\n" +
    "查询要求：一次一个意图，具体名词 + 年份/限定词（如 'Cursor vs Windsurf 2026 pricing comparison'）。\n" +
    "domain：已知垂直域可显式传（finance/code/academic/legal/health/social_media 等），不确定传 auto。\n" +
    "引用纪律：正文引用来源时写成 markdown 链接，如 [MindStudio](https://mindstudio.ai/blog/cursor-vs-windsurf)；文末来源表每行也写成 [标题](完整URL)。URL 必须来自搜索结果的来源表，禁止编造；输出中没有的信息禁止凭知识补充。\n" +
    "结果评估：拿到搜索结果后先评估再使用——1) 相关性：来源标题/域名是否真对题 2) 时效性：数据类信息（价格/榜单/新闻）要用最新的 3) 权威性：区分一手来源与二手转述，厂商自报数据标注打折 4) 多源交叉：关键结论至少 2-3 个独立来源佐证，单一来源视为未验证 5) 矛盾检测：来源间说法冲突时必须指出，不要自行调和。",
  parameters: Type.Object({
    query: Type.String({ description: "搜索查询（按语言策略决定英文或中文）" }),
    domain: Type.Optional(Type.String({ description: "垂直域：auto/general/finance/code/academic/legal/health/social_media 等，默认 auto（自动启发式判断）" })),
    intent: Type.Optional(Type.String({ description: "后处理形态：auto/text/data/code，当前统一走清洗+切句+索引管道" })),
    max_results: Type.Optional(Type.Number({ description: "返回来源数 1-10，默认 5" })),
  }),
  execute: async (_toolCallId, params) => {
    const query = String(params.query ?? "").trim();
    if (!query) {
      return { content: [{ type: "text", text: "query 不能为空。" }], details: { isError: true } };
    }
    const maxResults = Math.min(Math.max(Number(params.max_results) || 5, 1), 10);
    const domain = params.domain && params.domain !== "auto" && DOMAINS.includes(params.domain) ? params.domain : guessDomain(query);
    const args = { query, max_results: maxResults };
    if (domain !== "general") args.domain = domain;

    let md = "";
    try {
      const resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", ...(getApiKey() ? { authorization: `Bearer ${getApiKey()}` } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: args } }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) return { content: [{ type: "text", text: `搜索服务返回 HTTP ${resp.status}。建议稍后重试；急用时可改用 ego-browser 直接访问目标站点。` }], details: { isError: true } };
      const data = await resp.json();
      if (data.error) return { content: [{ type: "text", text: `搜索失败：${data.error.message ?? JSON.stringify(data.error)}` }], details: { isError: true } };
      md = data.result?.content?.find((c) => c.type === "text")?.text ?? "";
    } catch (err) {
      console.error(`[search] 请求失败：${String(err?.message ?? err)}`);
      return { content: [{ type: "text", text: `搜索请求失败：${String(err?.message ?? err)}。可稍后重试，或改用 ego-browser 直接访问目标站点。` }], details: { isError: true } };
    }

    const blocks = parseResults(md);
    if (!blocks.length) {
      return {
        content: [{ type: "text", text: `没有搜到结果（query: ${query}, domain: ${domain}）。建议：1) 换更具体的查询表述（实体+年份+限定词） 2) 知识/信息类查询尝试译成英文 3) 换垂直域（domain: finance/code/...）重试 4) 内容不在索引时用 ego-browser 直接访问目标站点。` }],
        details: { isError: true },
      };
    }

    const kws = queryKeywords(query);
    const out = [`## Search results (${blocks.length} sources)`];
    let chunks = 0;
    blocks.forEach((b, i) => {
      // ponytail: 每源 8 句上限，防单源长文淹没其他来源
      const sentences = filterRelevant(splitSentences(b.body), kws).slice(0, 8);
      sentences.forEach((s, j) => { out.push(`[${i + 1}-${j + 1}] ${s}`); chunks++; });
      if (sentences.length) out.push("");
    });
    if (chunks) out.pop(); // 去尾空行
    out.push("## Sources");
    blocks.forEach((b, i) => out.push(`[${i + 1}] ${b.title} — ${b.url}`));

    // 输出体量上限，防超长结果刷爆上下文
    const text = out.join("\n");
    // 结果广播：前端展开区直接渲染网页列表（favicon + 标题 · 域名）
    const sources = blocks.map((b) => ({ title: b.title, url: b.url }));
    searchResultsEmitter.emit({ toolCallId: _toolCallId, query, sources });
    return {
      content: [{ type: "text", text: text.length > 12000 ? `${text.slice(0, 12000)}\n…（结果过长已截断）` : text }],
      details: { sources, domain, chunks },
    };
  },
});

// 自检：node tools/search.js（离模型验证后处理纯函数）
const SELF = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (SELF) {
  import("node:assert").then(({ default: assert }) => {
    const md = "## Search Results (2 results)\n\n### 1. Cursor Pricing 2026\n- **URL**: https://cursor.com/pricing\nPro plan costs $20 per month. Free tier exists for anyone to try the product. [Skip to main content](https://x)\n\n### 2. Windsurf Review\n- **URL**: https://dev.to/x\nWindsurf beat Cursor in 2026 according to this test.\n";
    const blocks = parseResults(md);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].title, "Cursor Pricing 2026");
    assert.equal(blocks[0].url, "https://cursor.com/pricing");
    const cleaned = splitSentences(blocks[0].body);
    assert.equal(cleaned.some((s) => s.includes("[Skip to main content]")), false); // 链接剥离
    assert.ok(cleaned.some((s) => s.includes("Free tier exists")));

    const sents = splitSentences("First sentence here. Second sentence with enough length to pass. Subscribe to our newsletter!");
    assert.ok(sents.includes("Second sentence with enough length to pass."));
    assert.equal(sents.some((s) => /subscribe/i.test(s)), false); // 广告行清洗

    const kwsEn = queryKeywords("Cursor vs Windsurf 2026 pricing comparison");
    assert.ok(kwsEn.includes("pricing") && kwsEn.includes("cursor") && !kwsEn.includes("vs"));
    assert.equal(queryKeywords("的 了"), null); // 纯停用词 → 不过滤

    const filt = filterRelevant(["Cursor pricing is up.", "Unrelated text here."], ["cursor"]);
    assert.deepEqual(filt, ["Cursor pricing is up."]);
    assert.deepEqual(filterRelevant(["Nothing matches at all."], ["cursor"]), ["Nothing matches at all."]); // 软兜底

    console.log("search.js 自检通过（parse/split/keywords/filter）");
  });
}
