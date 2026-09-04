---
name: action-form-fill
description: "action-form-fill 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
disable-model-invocation: true
---
# Action Profile: Form Fill

This skill performs one narrow operation: map known task inputs into a declared form schema.

- Use only declared field ids and types.
- Keep missing values as `missing`; do not invent them.
- Report the submitted record id or the exact validation error.
- Completion is determined by schema validation and the target system response.
