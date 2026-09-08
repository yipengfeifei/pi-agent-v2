// 取数工具共用路由菜单：所有取数类工具的 description 顶部都挂同一段（避免漂移）
// 设计：一级菜单常驻（极短），二级使用说明按需（各自 SKILL.md/description）
export const ROUTER_MENU = `【取数工具路由（搜索/取数前先读这张表）】
- 通用搜索（找信息/文章/来源）→ search
- 时效/近期资讯/特定域名定向/需要综合答案 → tavily_search
- 平台深度内容（YouTube字幕/播客转写/抖音/B站/RSS/学术/公众号等 23 渠道）→ factreach
- 页面内具体数据点（评论区/电商销量/商品数/数据站数字）→ read_page
- 本地数据文件（xlsx/csv/pdf 报价表、榜单、导出）→ inspect_file
- 多轮深度研究与收敛 → research
确定用哪个后，再看该工具的 description 与对应 SKILL.md 的使用说明。`;

export const LOC = {
  search: "[search] 通用搜索（anysearch 封装）：查事实/数据/资料/资讯，返回来源列表。",
  tavily: "[tavily_search] Tavily：时效过滤(day/week/month)、include-domains 域定向、include-answer 综合结论。",
  factreach: "[factreach] FactReach：23 渠道体检/视频播客转写/抖音解析/网页读取；渠道路由规则在 SKILL.md。",
  readPage: "[read_page] Jina 抓任意网页为 Markdown（JS 渲染可过）：抓 search 快照外的页面内数据点。",
  inspectFile: "[inspect_file] 本地数据文件转文本：xlsx/csv/pdf/html，定向提取字段。",
};
