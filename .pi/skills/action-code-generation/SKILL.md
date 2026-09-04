---
name: action-code-generation
description: "action-code-generation 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
disable-model-invocation: true
---
# Action Profile: Code Generation

This skill makes the smallest code change needed for the declared subtask.

- Inspect the actual repository before editing.
- Prefer existing project patterns and dependencies.
- Run the narrowest relevant parser, build, or test command after editing.
- Completion depends on executable verification, not on a claim that code was written.
