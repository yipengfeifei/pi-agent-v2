---
name: node-strategize-plan-toolkit
description: "node-strategize-plan-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Node Toolkit: Strategize/Plan

## 触发条件

- 当前节点底层能力是 Strategize/Plan、策略规划、结构设计、执行框架、路线图、workflow 设计。
- 任务复杂、有阶段、依赖、资源约束、风险或多方案取舍。

## 可用能力选择逻辑

- 任务复杂、有多个阶段时，用 roadmap generator。
- 有依赖关系时，用 dependency graph builder。
- 要设计 workflow 时，用 workflow designer。
- 要长期目标时，用 OKR/KPI 或 milestone planner。
- 资源有限时，用 resource allocator。
- 风险高时，先做 risk mitigation planner。
- 不确定性高时，做 scenario planner，不只给单一路线。

## 输出要求

- 输出目标、阶段、依赖、优先级、资源、风险、里程碑、验收标准和备选方案。
- 对关键策略阶段输出 `operational_dependency` 和 go/no-go gate，区分“方案理论可写”和“现实运营可执行”。
- 对非标准时间线、强外部依赖或高风险执行，给出分支计划：gate 通过时怎么走，失败时怎么降级、延期或替代。
- 每个关键节点都要能被下游直接执行或验证。

## 禁止

- 不要只列待办事项。
- 不要没有优先级。
- 不要没有依赖关系。
- 不要规划到无法执行的抽象层。
- 不要把外部运营条件默认当成已满足。
