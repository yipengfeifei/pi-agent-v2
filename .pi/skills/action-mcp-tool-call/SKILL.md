---
name: action-mcp-tool-call
description: "action-mcp-tool-call 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Action Profile: MCP Tool Call

This skill selects and calls one declared tool for the current subtask.

- Prefer the tool whose schema directly matches the requested outcome.
- Validate required arguments before calling.
- Preserve the raw structured response and error code.
- A successful tool response is the completion signal; do not infer success from intent.
