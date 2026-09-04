---
name: node-generate-draft-toolkit
description: "node-generate-draft-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Node Toolkit: Generate/Draft

## 触发条件

- 当前节点底层能力是 Generate/Draft、内容生成、草稿、多版本产出、模板化写作、改写、翻译、本地化。
- 目标是生成可编辑候选稿，而不是最终审查放行。

## 可用能力选择逻辑

- 用户要初稿时，先生成结构完整版本。
- 用户要多个方向时，生成多版本，并标明差异、适用场景和取舍。
- 用户有格式要求时，先套 writing template。
- 用户有品牌、语气或受众要求时，用 tone/style adapter 和 brand voice checker。
- 需要事实内容时，必须先消费 Fetch/Gather 或 Extract/Validate 物料，不凭空编事实。
- 高质量长文先 outline，再 draft，再交 Review/Gate。
- 面向外部发布时，必须经过 Review/Gate。

## 输出要求

- 输出 draft_sections、variants、source_usage、editable_notes、placeholders、unsupported_claims_removed。
- 素材不足时用占位符或删去表达。

## 禁止

- 不要凭空编事实。
- 不要一上来写终稿。
- 不要忽视受众、场景、渠道。
- 不要生成无法执行或无法交付的空泛内容。
