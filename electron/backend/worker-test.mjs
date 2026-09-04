// worker 工具单测：直接调 execute，验证依赖校验 + 物料传递 + 干净上下文执行
// 流程：主会话写 n1 产出 → 执行 n2（input=raw_data）→ 断言结果用了 n1 物料
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthStorage, ModelRegistry, SessionManager, createAgentSession } from "@earendil-works/pi-coding-agent";
import { createWorkerTool } from "./tools/worker.js";

const CWD = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const auth = AuthStorage.create();
const mr = ModelRegistry.create(auth);

// 临时目录放主会话，避免污染真实会话目录
const tmpDir = path.join(CWD, ".tmp-worker-test");
const { session } = await createAgentSession({
  cwd: CWD,
  sessionManager: SessionManager.create(tmpDir),
  authStorage: auth,
  modelRegistry: mr,
});

let current = session;
const worker = createWorkerTool({ getSession: () => current, cwd: CWD });

const RUN_A = "run-a";
const graph = {
  runId: RUN_A,
  nodes: [
    { id: "n1", type: "Generate/Draft", name: "造数据", deps: [], input: [], output: "raw_data", prompt: "生成原始数据" },
    { id: "n2", type: "Analyze/Judge", name: "分析", deps: ["n1"], input: ["raw_data"], output: "conclusion", prompt: "根据 raw_data 给出结论" },
  ],
};

// 1. 模拟 n1 已产出（带 runId）
session.sessionManager.appendCustomEntry("node_output", { runId: RUN_A, nodeId: "n1", output: "2026 年新能源车渗透率 56.9%，同比 +8pp。" });

// 2. 跨图隔离（修串图 bug）：另一个 run 的 n1 产出，不能当作本 run 的依赖
//    单独跑 graph=X（其 n1 从未产出），但 run-b 里已有同名 n1 → 应判定依赖不满足
const RUN_B = "run-b";
session.sessionManager.appendCustomEntry("node_output", { runId: RUN_B, nodeId: "n1", output: "另一张图的 n1 产出，不该被消费" });
const graphX = { runId: "run-x", nodes: [{ id: "n1", type: "Generate/Draft", name: "造数据", deps: [], input: [], output: "raw_data", prompt: "x" }, { id: "n2", type: "Analyze/Judge", name: "分析", deps: ["n1"], input: ["raw_data"], output: "conclusion", prompt: "y" }] };
// 图里 n2 故意声明依赖另一个未产出的 output，从而歧义最小化——直接让 n2 依赖的 input 对应输出名"raw_data"，而 run-x 无 n1 产出
const isolated = await worker.execute("t0", { graph: JSON.stringify({ ...graphX, nodes: [{ ...graphX.nodes[0], output: "raw_data" }, graphX.nodes[1]] }), nodeId: "n2" });
const isoText = isolated.content[0].text;
console.log(isoText.includes("依赖未满足") ? "PASS: 跨图隔离（run-b 的 n1 不算 run-x 依赖）" : `FAIL: 跨图隔离失效，误认依赖满足: ${isoText}`);

// 3. 先测依赖拒绝：n2 依赖的 n3 在图中但从未产出 → 应拒绝（n3 必须在 graph.nodes 里才会被校验）
const n3 = { id: "n3", type: "Fetch/Gather", name: "缺失", deps: [], input: [], output: "missing_data", prompt: "x" };
const badNode = { ...graph.nodes[1], deps: ["n1", "n3"], input: ["raw_data", "missing_data"] };
const rejectGraph = { runId: RUN_A, nodes: [graph.nodes[0], badNode, n3] };
const reject = await worker.execute("t1", { graph: JSON.stringify(rejectGraph), nodeId: "n2" });
const rejectText = reject.content[0].text;
console.log(rejectText.includes("依赖未满足") ? "PASS: 依赖拒绝" : `FAIL: 依赖拒绝未触发: ${rejectText}`);

// 3. 执行 n2（依赖满足）：应读到 n1 的 raw_data 并基于它分析
const result = await worker.execute("t2", { graph: JSON.stringify(graph), nodeId: "n2" });
const resultText = result.content[0].text;
console.log("n2 结果:", resultText.slice(0, 200).replace(/\n/g, " "));
// 断言结果基于 n1 物料（应该提到渗透率/56.9% 相关）
const usedMaterial = /56\.9|渗透率/.test(resultText);
console.log(usedMaterial ? "PASS: 物料传递 + 干净上下文执行" : "FAIL: 结果未使用 n1 物料");

session.dispose();
process.exit(usedMaterial && rejectText.includes("依赖未满足") ? 0 : 1);
