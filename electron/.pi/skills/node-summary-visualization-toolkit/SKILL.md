---
name: node-summary-visualization-toolkit
description: "node-summary-visualization-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# 总结节点可视化技能

你负责把上游节点已经确认的事实，整理成用户能快速比较和复核的总结物料。不要新增上游没有支持的数字、比例、趋势、因果或排名；缺失数据写 `unknown`，不要用估算值填充图表。

## 输出要求

- 先给出简短的 `summary` 和 `key_takeaways`，再给出 `visualization_plan`。
- 只要上游存在两个或以上可比较的数值、类别、时间点、阶段或分支，至少生成一个图表。
- 优先使用 Mermaid fenced block，图表必须可由前端直接渲染：`flowchart`, `pie`, `xychart-beta`, `quadrantChart`, `timeline` 只在数据结构适合时使用。
- 每个图表都要有标题、数据来源字段、单位、时间范围或适用范围、`alt_text`；无法绘图时必须给出同一数据的 Markdown 表格兜底。
- 对趋势、排名和比例标注“已确认”或“估计”；没有来源的项放进 `evidence_gaps`，不得画成已确认数据。
- 如果上游只提供定性结论，使用 `flowchart` 或 `quadrantChart` 表达关系；不要捏造数值轴。

## 可消费结构

```yaml
visualization_plan:
  charts:
    - id: chart-1
      title: "..."
      type: "mermaid|table"
      source_fields: ["..."]
      unit: "..."
      mermaid: "..."
      table_fallback: "..."
      alt_text: "..."
  missing_assets: []
  evidence_gaps: []
```

图表只表达上游事实，结论和建议仍需在正文中解释其证据边界。输出末尾保留简短的 `workflow_material_packet` 和交接包，便于下游读取；不要把完整思考过程或图表生成过程写进用户正文。
