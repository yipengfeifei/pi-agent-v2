---
name: node-extract-validate-toolkit
description: "node-extract-validate-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Node Toolkit: Extract/Validate

## 触发条件

- 当前节点底层能力是 Extract/Validate、字段抽取、证据锚点、校验、原文定位、表格/PDF/OCR 抽取。
- 需要从文本、PDF、网页、表格、扫描件或多来源资料里抽取可复用字段。

## 可用能力选择逻辑

- 字段格式稳定时，用 regex extractor 或 parser。
- 字段语义复杂时，用 LLM structured extraction。
- 来源是 PDF 或扫描件时，用 PDF parser / OCR，再做文本清洗。
- 来源是表格时，用 table extractor 或表格 parser。
- 金额、日期、合同条款、政策要求等高价值字段，必须保留原文锚点。
- 抽取后必须 validate：类型、范围、格式、上下文一致性。
- 多来源冲突时，不直接合并，标注冲突来源和差异。

## 输出要求

- 输出 extracted_fields、schema_validation、anchors、conflicts、missing_fields。
- 对会被下游计算、裁决或预算引用的事实，输出 canonical candidate，而不是只写自然语言段落。
- canonical candidate 至少包含：field、value、unit、currency、valid_from/valid_until 或 valid_for、scope、source、source_type、source_date、confidence、decision_impact、volatility。
- 对金额、日期、合同条款、政策、许可、开放状态、保险、商业报价等高影响字段，区分当前值、过期值和估算值；过期或旧口径放入 stale_values，不要混进当前值。
- 多来源冲突时输出 conflict_set，保留每个候选值、来源、适用期和差异点，不替 Draft 节点自行挑选。
- 推测值只能标 inferred，不能标 extracted。

## 禁止

- 不要只抽字段不校验。
- 不要没有原文锚点。
- 不要把推测值当抽取值。
- 不要在证据不足时填空。
- 不要把事实字段、估算字段和建议字段混在同一个值里。
