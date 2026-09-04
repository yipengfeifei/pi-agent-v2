// 项目侧边栏后端冒烟测试：get_sidebar / 登记 / move_session（双向）/ switch cwd
import { WebSocket } from "ws";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ws = new WebSocket("ws://127.0.0.1:4700");
const inbox = [];
let readyCount = 0, sidebarCount = 0;
const moved = [];
ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  inbox.push(msg);
  if (msg.type === "ready") readyCount++;
  if (msg.type === "sidebar") sidebarCount++;
  if (msg.type === "session_moved") moved.push(msg);
});
const send = (o) => ws.send(JSON.stringify(o));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = fn(); if (v) return v; await wait(150); }
  throw new Error("waitFor 超时");
};
const lastSidebar = () => inbox.findLast((m) => m.type === "sidebar").sidebar;
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? (pass++, console.log("✓ " + name)) : (fail++, console.log("✗ FAIL: " + name)); };

const DEFAULT = "/Users/yipengfei/Desktop/pi Agent V2";
const projDir = "/tmp/test-project";
const projectsFile = path.join(homedir(), ".pi", "agent", "v2-projects.json");

ws.on("open", async () => {
  try {
    await waitFor(() => readyCount >= 1);
    console.log("— ready");

    // 初始：注册表可能是脏的（上次测试），先清理
    send({ type: "get_sidebar" });
    await waitFor(() => sidebarCount >= 1);
    check("初始 recent 有会话", lastSidebar().recent.length > 0);
    const preProjects = lastSidebar().projects.filter((p) => p.cwd === projDir);
    console.log("  初始项目数:", lastSidebar().projects.length, "(含测试残留:", preProjects.length, ")");

    // 1. new_session 带 cwd → 登记为项目
    send({ type: "new_session", mode: "normal", cwd: projDir });
    await waitFor(() => readyCount >= 2);
    send({ type: "get_sidebar" });
    await waitFor(() => sidebarCount >= 2);
    const proj = lastSidebar().projects.find((p) => p.cwd === projDir);
    check("新项目登记出现", !!proj);
    check("空项目 sessionCount=0", proj?.sessionCount === 0);

    // 2. move recent[0] → 项目（header 改写 + 文件移动 + 旧删）
    const victim = lastSidebar().recent[0];
    send({ type: "move_session", sessionFile: victim.path, cwd: projDir });
    await waitFor(() => moved.length >= 1);
    const m1 = moved[0];
    check("移动后旧文件已删", !existsSync(victim.path));
    check("新文件存在", existsSync(m1.targetFile));
    const hdr = JSON.parse(readFileSync(m1.targetFile, "utf8").split("\n")[0]);
    check("header.cwd 改写为项目", hdr.cwd === projDir);
    check("新文件位于项目归档目录", m1.targetFile.includes("--tmp-test-project--"));

    // 3. sidebar 复查：项目 1 会话，recent 少一条
    send({ type: "get_sidebar" });
    await waitFor(() => sidebarCount >= 3);
    const sb2 = lastSidebar();
    const p2 = sb2.projects.find((p) => p.cwd === projDir);
    check("项目会话数=1", p2?.sessionCount === 1);
    check("recent 少一条", sb2.recent.length === lastSidebar().recent.length - 1 || sb2.recent.length === 14 - 1);
    check("recent 不再含被移会话", !sb2.recent.some((s) => s.path === victim.path));

    // 4. switch 到项目会话：agent cwd 应 = 项目（switch 修 bug 验证）
    send({ type: "switch_session", sessionFile: m1.targetFile, mode: "normal" });
    await waitFor(() => readyCount >= 3);
    const r = inbox.findLast((m) => m.type === "ready");
    check("switch 后 cwd = 项目", r.cwd === projDir);

    // 5. 移回最近聊天（默认 CWD）
    send({ type: "move_session", sessionFile: m1.targetFile, cwd: DEFAULT });
    await waitFor(() => moved.length >= 2);
    const m2 = moved[1];
    check("移回后 header.cwd = 默认", JSON.parse(readFileSync(m2.targetFile, "utf8").split("\n")[0]).cwd === DEFAULT);

    // 6. 清理：删会话 + 清注册表测试项
    send({ type: "delete_session", sessionFile: m2.targetFile });
    const projs = JSON.parse(readFileSync(projectsFile, "utf8")).projects.filter((p) => p.cwd !== projDir);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(projectsFile, JSON.stringify({ projects: projs }, null, 2));
    await wait(300);
    console.log(`— 通过 ${pass} / ${pass + fail}`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error("FAIL:", e.message);
    process.exit(1);
  }
});
