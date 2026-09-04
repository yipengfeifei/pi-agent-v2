---
name: execution-complexity-judgment
description: "execution-complexity-judgment 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Execution Skill: Complexity Judgment

This skill teaches a model how to decide whether a user request is atomic or needs the embedded execution workflow. It is a reasoning rubric, not a catalog of business scenarios.

## Judgment order

1. State the user-visible outcome, not every verb in the request.
2. Run the atomicity test: can one Worker, within one capability boundary, produce one verifiable outcome without handing material to another action or making a new decision from a result?
3. Identify the actual execution topology: `atomic`, `chain`, `fan_out`, `merge`, `branch`, `loop_or_recovery`, or `mixed`.
4. Record only real coordination signals: independent outcomes, observable state transitions, material handoffs, capability or permission boundaries, independent evidence, control flow, and unresolved uncertainty.
5. Separate discoverable implementation facts from facts that only the user can supply. Discovery is a node; it is not automatically a user question.
6. Use a counterfactual: if the workflow layer were removed, could one session still know what to do next, retain the right material, respond to result-dependent branches, and prove the final state?
7. Estimate the current capability boundary from evidence: list direct capabilities, the longest safe continuous action chain, reliable evidence already available, the first boundary signal, and the smallest support needed. Use `unknown` when the task gives no evidence; do not turn this estimate into a fixed node-count rule.

## Counting discipline

- Do not count words, punctuation, application names, or task length.
- Do not count internal calculations as separate nodes unless they have an independent handoff or acceptance check.
- Repeated objects, filtering, and pipelines are evidence of a possible topology, not routing rules by themselves.
- An application boundary matters only when a real capability, state, permission, or material handoff crosses it.
- A side effect matters only when the external state must change and be verified.
- A missing API schema or tool name is normally discoverable. A missing private identity, account choice, or fact that changes the intended result is user-blocking.
- Different verbs or action type labels do not require separate nodes when one Worker can call the tools sequentially and close them with one verification. Split only at the first real capability boundary.

## Output contract

Return the judgment before the plan. Include:

- `atomicityTest`
- `topology`
- `coordinationSignals` with evidence and routing impact
- `unknownsByType`: `discoverable`, `defaultable`, `userBlocking`
- `capabilityAssessment`: `directCapabilities`, `continuousActionLimit`, `reliableEvidence`, `boundarySignals`, `smallestSupport`
- the compatibility dimensions and the final `executionMode`

If the mode is `workflow`, give the smallest structural reason and the minimum node boundaries. If the mode is `direct`, state why one Worker can close the task and verify it.
