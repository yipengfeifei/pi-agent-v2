---
name: node-analyze-judge-toolkit
description: "node-analyze-judge-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Node Toolkit: Analyze/Judge

## 触发条件

- 当前节点底层能力是 Analyze/Judge、分析、判断、诊断、建议、风险评估、方案比较。
- 目标是形成有依据、有边界、有行动价值的结论。

## 可用能力选择逻辑

- 要做选择时，用 scoring model 或 comparison matrix。
- 要找原因时，用 root cause analysis。
- 要判断风险时，用 risk rubric。
- 要比较方案时，用 comparison matrix。
- 要判断事实真假时，先接 Fetch/Gather + Validate，不直接凭记忆断言。
- 要给建议时，必须说明依据、权衡、风险和反证条件。
- 高不确定性时，输出结论、置信度、需要补充的信息。

## 输出要求

- 输出 judgements、evidence、confidence、assumptions、counterexamples、recommendations。
- 区分 fact、inference、assumption、recommendation。
- confidence 必须随来源质量、时效性、冲突情况和决策影响调整；高影响但未刷新或存在冲突的事实，不给高置信判断。
- 对会改变结论的事实缺口，输出 what_would_change_my_mind 或 verification_needed，交给 Fetch/Gather、Review/Gate 或用户补充处理。

## 禁止

- 不要只给观点不给依据。
- 不要把偏好包装成事实。
- 不要忽略反例。
- 不要在信息不足时装确定。
- 不要把上游 canonical 冲突当作已经解决。
