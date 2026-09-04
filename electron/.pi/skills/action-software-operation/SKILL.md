---
name: action-software-operation
description: "action-software-operation 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Action Profile: Software Operation

This skill performs real operations in a browser, desktop application, or MCP-backed service.

- Read the environment and the target application's current state before making a side effect.
- Use only tools and argument schemas present in the supplied capability map or MCP manifest.
- For read-only discovery, use an evidence ladder rather than a fixed list of guessed paths: first consume supplied records/paths and tool schemas, then inspect service or application metadata, then derive the next distinct probe from observed namespaces, resource names, record IDs, paths, or fields. Service reachability alone is not an operation schema. Stop when the action contract has enough evidence or the declared read-only evidence sources are exhausted; do not repeat an identical probe.
- When an action needs a concrete record, selection, field, or file path, make discovery consume the upstream material that produces that concrete sample. A schema, count, or summary is not a substitute for the actual object needed to test an operation.
- After every side effect, use the declared verification tool and preserve evidence such as a record id, URL, status, or refreshed UI text.
- If the UI or tool schema changed, rediscover the current state before retrying.
- For cross-application work, pass only concrete outputs and identifiers to the next node.
- Treat each acceptance criterion as one evidence check. If this node is read-only and the action and verification plans name the same read tool, call it once and use that response for both; do not repeat an identical query.
- Stop tool use as soon as every criterion has evidence. Do not explore alternate tools, re-query the same record, or reconstruct upstream artifacts from prose.
- If a criterion compares two artifacts, only use artifacts explicitly supplied by dependencies; report a missing dependency instead of searching broadly.
- After the real action loop, leave the next phase the concrete facts it needs (IDs, paths, URLs, statuses, returned values, or explicit unknowns). `software_execution_result`, `workflow_material_packet`, or a short prose summary are all acceptable; do not spend a turn converting evidence into a fixed envelope when the facts are already clear.
