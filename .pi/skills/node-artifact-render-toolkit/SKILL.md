---
name: node-artifact-render-toolkit
description: "node-artifact-render-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Node Toolkit: Artifact/Render

## 触发条件

- 当前节点底层能力是 Artifact/Render、最终文件、报告、PPT、PDF、docx、表格、HTML、图表、视觉渲染。
- 用户需要可阅读、可打开、可交付、可归档的最终物料。

## 可用能力选择逻辑

- 用户要正式交付物时，用对应格式 renderer。
- 报告类用 docx/PDF。
- 演示类用 PPT。
- 数据类用 spreadsheet + chart。
- 网页类用 HTML renderer。
- 视觉要求高时，必须截图或渲染检查。
- 有模板时，优先套模板。
- 最终产物必须可打开、可读、布局不破。

## 输出要求

- 输出 artifact_title、artifact_type、file_sections、render_payload、source_usage、missing_assets、qa_result。
- 不新增上游未支持事实、图片、数字或引用。
- 当上游同时给出 canonical/current/canonical_overrides/conflict_set/stale_values/history 等事实治理字段时，正式产物只采用 canonical/current/canonical_overrides 中裁定为当前有效的值；stale_values/history 只能作为历史沿革、废弃口径或风险说明，不得混入当前预算、当前政策、当前配置或当前结论。

## 禁止

- 不要只给文本说“你可以复制”。
- 不要生成无法打开的文件。
- 不要不检查布局。
- 不要忽略目标渠道的格式限制。
