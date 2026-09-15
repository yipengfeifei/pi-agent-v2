import {
  DefaultResourceLoader, SessionManager,
  createAgentSession, getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { createPlanTool } from "./tools/plan.js";
import { createUpdatePlanTool } from "./tools/update-plan.js";
import { createWorkerTool } from "./tools/worker.js";
import { createWaitTool } from "./tools/wait.js";
import { searchTool } from "./tools/search.js";
import { tavilySearchTool } from "./tools/tavily-search.js";
import { factreachTool } from "./tools/factreach.js";
import { readPageTool } from "./tools/read-page.js";
import { inspectFileTool } from "./tools/inspect-file.js";
import { browserTool } from "./tools/browser.js";
import { siteMemoryTool } from "./tools/site-memory.js";
import { createResearchTool } from "./tools/research.js";
import { createRunStatusTool } from "./tools/run-status.js";
import { createSessionRecallTool } from "./tools/session-recall.js";
import { createToolkitLoader, TOOLKIT_CORE, TOOLKITS } from "./tools/toolkit-loader.js";
import { modelRuntime } from "./model-runtime.js";

const CWD = "/Users/yipengfei/Desktop/pi Agent V2";
const FULL_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "plan", "update_plan", "worker", "wait_for", "subagent", "run_status", "register_artifact", "search", "tavily_search", "read_page", "inspect_file", "factreach", "site_memory", "research", "browser", "recall", "load_toolkit"];

const model = modelRuntime.getModel("opencode-go", "deepseek-v4.1-flash");
// 与 server.js 的 PERSONA_SLIM 保持一致（server.js 一 import 就起服务，这里只能手抄一份）
const PERSONA_SLIM =
  "You are an agent operating inside pi. You handle whatever the user asks: read/edit files, run commands, search the web, drive a real browser, operate local apps. Be concise; show file paths.\n"
  + "Tooling: the list below is not exhaustive — `load_toolkit` unlocks more specialized tools (its description lists the groups). Skills live in two places: `./.pi/skills/` (project) and `~/.pi/agent/skills/` (global) — for domain tasks `ls` both, then `read` the matching SKILL.md.\n"
  + "Editing: on existing files use `edit`, not `write`; `write` only for new files or full rewrites.\n"
  + "Pi docs: <node_modules/@earendil-works/pi-coding-agent>/{README.md,docs,examples} — only when asked about pi itself.";
// 与 server.js 一致：统一精简 loader（noContextFiles + noSkills）
const slimLoader = new DefaultResourceLoader({
  cwd: CWD,
  agentDir: getAgentDir(),
  systemPrompt: PERSONA_SLIM,
  noContextFiles: false,
  noSkills: true,
  noPromptTemplates: true,
  appendSystemPromptOverride: () => [],
});
await slimLoader.reload();

let handle = null;
const activeToolNames = new Set(TOOLKIT_CORE);
const customTools = [
  createPlanTool({ cwd: CWD, getSession: () => handle.session }),
  createUpdatePlanTool({ getSession: () => handle.session }),
  createWorkerTool({ getSession: () => handle.session, cwd: CWD }),
  createWaitTool({ scheduleWakeup: () => {} }),
  createRunStatusTool({ getSession: () => handle.session }),
  searchTool, tavilySearchTool, factreachTool, readPageTool, inspectFileTool,
  siteMemoryTool,
  createResearchTool({ cwd: CWD, getSession: () => handle.session }),
  createSessionRecallTool({ cwd: CWD }),
  browserTool,
];
let toolkitTool = null;
const loaderTool = createToolkitLoader({
  getActive: () => Array.from(activeToolNames),
  setActive: (names) => {
    for (const n of names) activeToolNames.add(n);
    try { handle.session.setActiveToolsByName(Array.from(activeToolNames)); } catch (e) { console.log("setActive ERR " + e.message); }
  },
});
toolkitTool = loaderTool;
customTools.push(loaderTool);

const { session } = await createAgentSession({
  cwd: CWD, model, sessionManager: SessionManager.create(CWD),
  resourceLoader: slimLoader,
  modelRuntime, 
  tools: FULL_TOOLS, customTools,
});
handle = { session, cwd: CWD };

function snap(label) {
  const sp = String(session.state?.systemPrompt ?? "");
  const ts = session.state?.tools ?? [];
  let schemaChars = 0;
  const names = [];
  for (const t of ts) {
    names.push(t.name);
    schemaChars += JSON.stringify(t).length;
  }
  const i = sp.indexOf("The following skills provide");
  console.log(`\n──── ${label} ────`);
  console.log(`  活跃工具数        ${ts.length}`);
  console.log(`  工具 schema 合计  ${schemaChars} 字符`);
  console.log(`  system prompt     ${sp.length} 字符（其中 skills 段 ${i > 0 ? sp.length - i : 0}）`);
  console.log(`  合计固定开销      ${schemaChars + sp.length}`);
  console.log(`  工具清单: ${names.join(" ")}`);
  return { schemaChars, spLen: sp.length, n: ts.length };
}

// ① 全量（改造前的行为，作对照）
session.setActiveToolsByName(FULL_TOOLS);
const before = snap("① 全量（改造前对照）");

// ② 窄起手（改造后 normal 模式的实际状态）
session.setActiveToolsByName(TOOLKIT_CORE);
const core = snap("② 核心集起手（改造后）");

// ③ 调用 load_toolkit 解锁 web 组
const r = await toolkitTool.execute("call-1", { group: "web" });
console.log("\n  load_toolkit(web) 返回: " + r.content[0].text);
const afterWeb = snap("③ 解锁 web 组后");

// ④ 再解锁 orchestrate（验证可叠加、不丢已解锁）
const r2 = await toolkitTool.execute("call-2", { group: "orchestrate" });
console.log("\n  load_toolkit(orchestrate) 返回: " + r2.content[0].text);
const afterOrch = snap("④ 再解锁 orchestrate 后");

// ⑤ 非法组名
const r3 = await toolkitTool.execute("call-3", { group: "nope" });
console.log("\n  非法组名返回: " + r3.content[0].text + "  isError=" + !!r3.details?.isError);

console.log("\n════════ 汇总 ════════");
console.log(`  改造前（全量）      ${before.schemaChars + before.spLen}  （工具 ${before.n} 个）`);
console.log(`  改造后（核心集）    ${core.schemaChars + core.spLen}  （工具 ${core.n} 个）  → 省 ${before.schemaChars + before.spLen - (core.schemaChars + core.spLen)}`);
console.log(`  加载 1 组后         ${afterWeb.schemaChars + afterWeb.spLen}  （工具 ${afterWeb.n} 个）`);
console.log(`  加载 2 组后         ${afterOrch.schemaChars + afterOrch.spLen}  （工具 ${afterOrch.n} 个）`);
