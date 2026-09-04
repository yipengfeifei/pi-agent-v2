---
name: node-writeback-action-toolkit
description: "node-writeback-action-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Node Toolkit: Writeback/Action

## 触发条件

- 当前节点底层能力是 Writeback/Action、写回 payload、系统操作、API 调用、数据库写入、webhook、文件写入、自动化执行。
- 节点目标包含改变外部状态或准备可执行动作。

## 可用能力选择逻辑

- 动作可逆、低风险时，可以直接执行并回报证据。
- 动作高风险时，先 dry-run，再交 Review/Gate 或请求用户确认。
- 写入外部系统时，必须构造明确 payload。
- 有权限边界时，先 permission checker。
- 涉及用户数据、删除、付款、发布、不可逆操作时，必须确认。
- 执行动作后，返回执行结果、ID、状态、失败原因。

## 输出要求

- 输出 action_payload、dry_run_result、permission_status、execution_result、rollback_hint。
- 如果未执行，只能说 prepared，不要说 completed。

## 禁止

- 不要模糊写回。
- 不要无确认执行高风险动作。
- 不要只说“已完成”但没有操作证据。
- 不要把计划当动作完成。
