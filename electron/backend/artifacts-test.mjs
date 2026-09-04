// Artifact 判定冒烟测试：交付物定义（CWD 内 + 扩展名白名单 + 产出型节点）
import { isArtifact } from "./artifacts.js";
import assert from "node:assert";

const cwd = "/proj";
// 交付物：主会话 md / 图片；json 是中间数据格式，不收
assert.ok(isArtifact("/proj/report.md", { cwd }));
assert.ok(isArtifact("/proj/img/logo.png", { cwd }));
assert.ok(!isArtifact("/proj/plan.json", { cwd }));
// 非交付物：脚本 / 数据 / 越界 / 隐藏 / 依赖目录
assert.ok(!isArtifact("/proj/script.py", { cwd }));
assert.ok(!isArtifact("/proj/data.csv", { cwd }));
assert.ok(!isArtifact("/tmp/x.md", { cwd }));
assert.ok(!isArtifact("/proj/.cache/x.md", { cwd }));
assert.ok(!isArtifact("/proj/node_modules/x.md", { cwd }));
// worker 节点：产出型收；过程型 / 内部计划（Strategize/Plan）不收，即使扩展名在白名单；json 一律不收
assert.ok(isArtifact("/proj/report.md", { cwd, nodeType: "Generate/Draft" }));
assert.ok(!isArtifact("/proj/plan.json", { cwd, nodeType: "Artifact/Render" }));
assert.ok(!isArtifact("/proj/clean.csv", { cwd, nodeType: "Standardize" }));
assert.ok(!isArtifact("/proj/clean.json", { cwd, nodeType: "Standardize" }));
assert.ok(!isArtifact("/proj/internal-plan.md", { cwd, nodeType: "Strategize/Plan" }));

console.log("artifacts-test OK");
