---
name: node-monitor-alert-toolkit
description: "node-monitor-alert-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Node Toolkit: Monitor/Alert

## 触发条件

- 当前节点底层能力是 Monitor/Alert、监控、告警、阈值触发、异常检测、分级响应。
- 任务需要持续检查、定时检查、事件监听或升级机制。

## 可用能力选择逻辑

- 固定时间检查时，用 scheduler。
- 持续系统状态时，用 metric/log monitor。
- 指标有明确阈值时，用 threshold evaluator。
- 异常模式不稳定时，用 anomaly detector。
- 告警必须分级：info、warning、critical。
- critical 必须有升级路径。
- 每次告警都包含发生了什么、证据、影响、建议动作。

## 输出要求

- 输出 event、severity、trigger_reason、evidence、impact、recommended_action、escalation_required、dedupe_key。
- 缺少阈值或数据源时，标记配置缺口，不假装已监控。

## 禁止

- 不要只监控不告警。
- 不要所有告警同一级别。
- 不要没有去重和静默期。
- 不要只报错不说明下一步。
