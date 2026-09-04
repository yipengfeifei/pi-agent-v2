---
name: node-classify-route-toolkit
description: "node-classify-route-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Node Toolkit: Classify/Route

## 触发条件

- 当前节点底层能力是 Classify/Route、分类、打标、路由、优先级分发、人工升级判断。
- 分类结果会决定下游节点、动作、风险等级或人工审核。

## 可用能力选择逻辑

- 类别稳定、规则明确时，用 rule engine 或 routing table。
- 类别语义复杂时，用分类模型能力，并输出依据。
- 要匹配历史案例、profile、workflow 时，用 embedding similarity 或 taxonomy/ontology matcher 思路。
- 涉及风险、权限、合规时，用 risk classifier + threshold。
- 多个路由都可能时，输出 top-k + confidence。
- 置信度低或标签冲突时，路由到澄清、Review/Gate 或人工升级。

## 输出要求

- 输出 label、route、confidence、reason、alternative_routes、manual_review_required。
- 如果分类会触发动作，必须保守，不确定时不要直接放行动作。

## 禁止

- 不要无置信度分类。
- 不要把“看起来像”当确定路由。
- 不要让分类节点做后续业务任务。
- 不要在 taxonomy 不清楚时硬分类。
