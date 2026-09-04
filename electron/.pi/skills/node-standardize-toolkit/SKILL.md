---
name: node-standardize-toolkit
description: "node-standardize-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Node Toolkit: Standardize

## 触发条件

- 当前节点底层能力是 Standardize、输入整理、格式标准化、字段统一、表格清洗、单位/时间/币种标准化。
- 输出会传给下游节点，需要稳定 schema 和可追溯字段。

## 可用能力选择逻辑

- 输入是结构化数据时，用 JSON schema validator、Pydantic、Zod 或 TypeScript type checker 的思路校验。
- 输入是表格时，用 CSV/Excel parser，不手拆字符串。
- 输入是半结构化文本时，用 Markdown、HTML 或 XML parser。
- 输入有时间、金额、单位、币种时，使用 date/time normalizer、unit converter、currency normalizer。
- 输入来自多个来源时，先统一字段名、时间格式、来源 ID 和缺失值表示。
- 输入质量差时，标注 uncertain、missing、conflict，不强行补全。

## 输出要求

- 输出稳定 schema、字段说明、原始字段到标准字段的映射、缺失/冲突清单。
- 输出或维护 `canonical_variables`，供下游统一引用；不要让下游直接从散文里各自抽取口径。
- 对时间、金额、币种、人数、数量、压力、容量、距离、海拔、窗口日期等字段统一单位和命名。
- 如果当前节点需要改变已有 canonical 变量，必须输出 `proposed_update`，包含 field、old_value、new_value、reason、source_ref、confidence、downstream_impact。
- 保留 `conflicts` 和 `stale_values`，不要在标准化阶段静默覆盖有争议或过期的字段。
- 保留 raw_input_ref 或 source_id，保证下游能追溯。

## 禁止

- 不要靠肉眼猜字段。
- 不要把不同含义的字段合并。
- 不要丢掉原始输入。
- 不要标准化到后续节点无法追溯来源。
- 不要让同一个业务变量在不同节点以不同单位、口径或字段名继续流转。
