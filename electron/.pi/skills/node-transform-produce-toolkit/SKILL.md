---
name: node-transform-produce-toolkit
description: "node-transform-produce-toolkit 节点的执行规范（触发条件/能力选择/输出要求/禁止）。"
---

# Node Toolkit: Transform/Produce

## 适用范围

- 当前节点底层能力是 Transform/Produce、专业加工、资产生产、材料转换或中间产物生成。
- 你的职责是把原始材料或上游物料加工成后续节点要消费的中间材料，而不是写说明、做最终排版或生成最终成品。
- 典型产物包括文件、素材包、数据集、索引、manifest、图表素材、媒体资产、交互素材、模型/工具输出包、转码结果、批量加工结果。

## 输入判断

- 明确 `input_artifacts`：本节点消费哪些上游材料、文件、字段、参数或资产文件夹。
- 明确 `operation`：本节点实际执行的加工动作。
- 明确 `skill_or_tool`：使用哪个 skill、工具、库、命令或运行能力；如果当前环境没有可用工具，不能假装已生成文件。
- 明确 `parameters`：格式、尺寸、时长、采样率、分辨率、schema、版本、输出目录、命名规则等与加工有关的参数。
- 如果输入包含上游前置判断物料，例如 `audience_platform_fit`、`structure_strategy`、`risk_policy`、`asset_direction`、`parameter_rationale`、`voice_style_profile`、`prosody_plan`、`beat_marks`，必须说明这些字段如何改变加工参数或输出结构。

## 输出要求

- 必须输出可被下游读取的 `output_artifacts` 或明确标记 missing。
- 文件型或资产包产物必须写 `manifest_path`；推荐把产物放在当前工作目录下稳定命名的子目录中。
- `manifest` 至少包含：
  - `input_artifacts`
  - `operation`
  - `skill_or_tool`
  - `parameters`
  - `output_artifacts`
  - `asset_folder`
  - `quality_metrics`
  - `missing_assets`
  - `evidence_gaps`
  - `handoff_to_render`
- `quality_metrics` 要匹配资产类型，例如文件是否存在、格式、大小、条目数、行列数、尺寸、时长、帧率、版本、可解析/可播放/可导入状态。
- 时间轴、标注包、参数包、素材包类产物必须让下游能直接读取：写清 schema、时间单位、片段 id、素材路径、参数映射和消费节点。

## 禁止

- 不要只描述“应该如何加工”而没有输出路径、manifest 或 missing 标记。
- 不要把文本草稿生成伪装成 Transform/Produce；那属于 Generate/Draft。
- 不要把最终 HTML/PDF/报告/页面渲染伪装成 Transform/Produce；那属于 Artifact/Render。
- 不要新增事实判断或来源结论；需要事实时消费 Fetch/Gather 或上游证据包。
- 不要忽略上游前置判断物料；如果不采用，必须在 `evidence_gaps` 或 `quality_metrics` 里说明原因。
- 工具不可用、素材缺失、权限不足或生成失败时，不要编造文件路径；写入 `missing_assets` 和 `evidence_gaps`。

## 交接格式

- 在 `workflow_material_packet.material_output` 中明确写：
  - `input_artifacts`
  - `operation`
  - `skill_or_tool`
  - `parameters`
  - `output_artifacts`
  - `manifest_path`
  - `asset_folder`
  - `quality_metrics`
  - `missing_assets`
  - `handoff_to_render`
