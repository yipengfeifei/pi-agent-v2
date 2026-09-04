---
name: node-fetch-gather-toolkit
description: "node-fetch-gather-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---
# Node Toolkit: Fetch/Gather

## 最高优先级

- 开工前先识别当前任务或上游物料里是否存在高时效、高影响字段，例如 policy、price、regulation、permit、visa、availability、insurance、commercial_quote、safety_threshold、版本兼容、金融数字等。若存在，先围绕 latest/current/effective date/change/update/new rule/fee change 或对应语言的“最新/生效日期/变更/新规/费用调整”做最小必要检索，再输出当前有效值。
- 如果 source_date 早于 plan_date，且字段属于政策、价格、法规、许可、开放状态、保险或商业报价，不得把旧值写成当前事实；旧值只能进入 stale_values、历史口径或 evidence_gaps。

## 触发条件

- 当前节点底层能力是 Fetch/Gather、资料搜集、外部信息获取、来源检索或事实搬运。
- 任务需要最新事实、公开资料、指定 URL/PDF/网页、政策、价格、版本、公司/金融/学术/代码来源。

## 可用能力选择逻辑

- 需要最新事实时，使用当前 Pi 原生搜索通道做实时 web search。
- 需要广覆盖探索时，使用 AnySearch 或普通搜索能力。
- 需要结构化搜索结果、摘要、来源元数据时，使用 Tavily Search 等结构化搜索能力。
- 问题偏学术时，优先查 Scholar、arXiv、PubMed 或论文原文。
- 问题偏公司、金融、上市公司时，优先查 SEC、财报、公告、投资者关系页和权威数据库。
- 问题偏代码、库、issue 时，优先查 GitHub、官方文档、release notes。
- 用户给了具体 URL、PDF、文档或文件时，先抓取指定来源，再判断是否需要补充搜索。
- 医疗、法律、金融、政策等高风险领域，优先权威源和原文，保留发布日期、版本和适用范围。

## 研究收束

- 先把任务收束成一个待判定命题：什么事实会改变后续决定，什么证据足以支持、否定或保持 unknown。
- 优先读取最直接的权威来源。对单一产品能力、套餐、规则或网页事实，通常只需要两到四个直接相关来源；必要时补一个反证或限制来源。
- 一旦来源已经能回答当前命题，立即输出证据包并停止。不要因为工具仍可用而扩展到相邻产品、实现方式、案例或泛泛背景。
- 只有当前证据相互矛盾、缺少关键适用条件，或任务明确要求广覆盖比较时，才继续检索。需要多条独立研究线或长时间资料整理时，交给 Workflow，而不是让单次 Gather 无限延长。

## 输出要求

- 每条关键事实都要有来源、日期/版本、as_of/valid_for、source_status 和置信度。
- 至少区分 verified、unverified、missing、conflict。
- 给关键字段标注 `volatility`：high / medium / low。政策、价格、法规、签证/许可、开放状态、保险、商业报价、版本兼容、金融数字、安全阈值通常是 high 或 medium。
- 对高时效字段输出 current_candidate 与 stale_values；输出 evidence_gaps，不要把搜索不到写成阻塞。

## 禁止

- 不要只搜一条结果就下结论。
- 不要把 SEO 文章当主要证据。
- 不要搜索很多但不判断来源可靠性。
- 不要把 Tavily Search、AnySearch、Web Search 当成本地 skill 文件；它们是 Pi 原生工具通道。
