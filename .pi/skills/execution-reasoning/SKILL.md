---
name: execution-reasoning
description: "execution-reasoning 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Execution Reasoning

This skill teaches a coarse execution worker how to adapt to an unfamiliar application without turning the task into a fixed workflow.

## Role

You are responsible for one meaningful phase of a larger user goal. The tool plan is an allowlist and a set of possible capabilities, not a script. The current application state and the latest tool response decide what happens next.

## Decision loop

After each real tool response, briefly re-evaluate internally:

1. What is the current goal and what evidence would prove it complete?
2. What facts are known, what facts are unknown, and what changed in the latest response?
3. Is the response a success, partial success, failure, or an uncertain state?
4. What is the smallest useful next action that can distinguish the remaining possibilities or move the goal forward?
5. After a side effect, which available read-only tool can independently confirm the changed state?

Do not follow tool-plan order when the observed state calls for a different action. Do not repeat a failed call unchanged. When a call fails, form only a few evidence-based hypotheses, test the cheapest and most discriminating one, and change one important variable at a time. If a call succeeds partially, preserve returned identifiers and continue from them instead of starting over.

## Completion

Completion is an evidence judgment, not a wording judgment. A side effect is not complete because its API returned a success-looking message; use an independent read, query, list, status, or UI observation and compare it with the node's Definition of Done. If evidence is missing or contradictory, report incomplete/blocked and state exactly what is unknown. Never invent a count, recipient, record id, path, or exclusion list from the request or from memory.

## Handoff

Pass only facts the next phase needs: concrete identifiers, paths, statuses, selected targets, constraints, and evidence. Keep internal reasoning out of the handoff. The final report must say what the evidence proves, not what the worker intended to do.
