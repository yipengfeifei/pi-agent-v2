---
name: node-review-gate-toolkit
description: "node-review-gate-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Node Toolkit: Review/Gate

## 触发条件

- 当前节点底层能力是 Review/Gate、质量审查、风险裁决、放行、返工、合规检查。
- 输出会决定是否接受、返工、升级人工或发布。

## 可用能力选择逻辑

- 代码变更时，用 lint、test runner、type checker。
- 内容发布时，用 factuality checker、tone checker、brand checker。
- 高风险决策时，用 risk gate。
- 涉及合规时，用 policy/compliance checker。
- 引用了外部信息时，用 citation checker。
- 审查前先问自己：上游产物里哪些字段是高影响事实，特别是会改变预算、资格、合规、安全、发布时间、路线、报价或风险等级的字段。
- 对 red-flag fields 做 lightweight refresh 或至少检查 as_of/valid_for/source_date 是否足以支撑当前计划；发现旧值、新规、冲突或明显过期时，输出 canonical_overrides 给下游。
- 质量不达标但本节点能校正时，直接输出可被下游采用的 corrected_material、canonical_values、canonical_overrides 或 correction_patch；只有缺少用户私有信息、缺少权限或风险超出本节点能力时，才输出 rework_tasks / escalation_reason。
- 放行时，说明通过了哪些门槛。

## 输出要求

- 先声明 `audit_scope`：本节点裁决哪些上游产物、哪些字段/口径/数字/现实约束是放行门槛。
- 输出 verdict、passed_checks、failed_checks、risk_level、release_conditions。
- 如果发现影响下游可用性的错误，不要只写建议或要求返工；必须直接输出下游可采用的 `corrected_material`、`canonical_values`、`correction_patch` 或 `canonical_overrides`。
- 如发现高影响事实需要修正，输出 `canonical_overrides`：field、upstream_value、corrected_value、reason、source_ref、downstream_instruction。
- Review/Gate 不重写完整最终成品，但必须把错误口径、错误数字、矛盾安排、缺失依据和过期事实修成可被下游采用的局部准物料；后续 Render 只能采用修正后的口径，不能同时消费原错误口径和补丁两套互相冲突的材料。
- 只有缺少用户私有信息、缺少权限或风险超出本节点能力时，才输出 rework_tasks / escalation_reason。

## 禁止

- 不要只做表面检查。
- 不要没有验收标准。
- 不要为了完成任务降低门槛。
- 不要把 Review 变成再次生成。
- 不要只审内部一致性而忽略 current validity。
- 不要只汇总上游内容；必须裁决是否通过，并把不通过或带修正通过的部分转成下游可消费的修正物料。
