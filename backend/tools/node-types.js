// 12 类节点 → toolkit skill 静态映射（收编自旧 monitor-server.js NODE_TYPE_SKILLS）
// 节点类型是"提示词分类"：worker 执行节点时按类型注入对应 toolkit skill
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".pi", "skills");

export const NODE_TYPES = {
  "Fetch/Gather": "node-fetch-gather-toolkit",
  Standardize: "node-standardize-toolkit",
  "Classify/Route": "node-classify-route-toolkit",
  "Extract/Validate": "node-extract-validate-toolkit",
  "Generate/Draft": "node-generate-draft-toolkit",
  "Transform/Produce": "node-transform-produce-toolkit",
  "Analyze/Judge": "node-analyze-judge-toolkit",
  "Strategize/Plan": "node-strategize-plan-toolkit",
  "Writeback/Action": "node-writeback-action-toolkit",
  "Review/Gate": "node-review-gate-toolkit",
  "Artifact/Render": "node-artifact-render-toolkit",
  "Monitor/Alert": "node-monitor-alert-toolkit",
};

export function nodeTypeSkillId(nodeType = "") {
  return NODE_TYPES[nodeType] || null;
}

export function loadSkillText(skillId) {
  const file = path.join(SKILLS_DIR, skillId, "SKILL.md");
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
