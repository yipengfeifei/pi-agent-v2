---
name: action-content-generation
description: "action-content-generation 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
disable-model-invocation: true
---
# Action Profile: Content Generation

Use this profile for bounded content extraction, transformation, document drafting, and personalized message generation.

- Consume only the supplied source material and constraints.
- Preserve names, dates, amounts, IDs, and owner assignments exactly unless a transformation is explicitly required.
- Mark missing or ambiguous facts instead of guessing.
- Produce a structured output that downstream execution nodes can consume.
- Verify required points and unsupported-claim absence before reporting completion.
- When transforming a collection, enumerate every source record and apply the
  predicate to each record using the actual field names and values. Report
  input count, kept count, excluded count, and excluded IDs (or the concrete
  reason for each exclusion); never approximate a filter from a partial scan.
- Preserve the distinction between a source field, a derived field, and a
  display label. If the requested field is absent, state the observed field
  used and keep the transformation rule explicit in the handoff packet.
