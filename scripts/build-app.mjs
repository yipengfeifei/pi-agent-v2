// FLY 打包脚本：前端静态导出 → 复制产物/后端到 electron/ → electron-builder 出 .app
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");
const electronDir = path.join(root, "electron");

const run = (cmd, cwd, env = {}) => {
  console.log(">", cmd);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
};

// 1. 前端静态导出（独立 distDir，不碰 dev 的 .next；WS 端口 4800 编译期内联）
// 环境变量脚本内显式设：裸跑 npm run build:app 也能出正确产物（静态导出 + 4800 内联）
run("npx next build", frontend, {
  NEXT_OUTPUT: "export",
  NEXT_DIST_DIR: ".next-app",
  NEXT_PUBLIC_WS_PORT: "4800",
});
// 2. 产物 + 后端 + 项目 .pi（skills/agents/extensions，worker 与 subagent 依赖）复制进 electron/
// AGENTS.md：normal 模式项目规则（update_plan 触发纪律），默认 loader 从 app 根目录读取
for (const [src, dst] of [
  [path.join(frontend, ".next-app"), path.join(electronDir, "out")],
  [path.join(root, "backend"), path.join(electronDir, "backend")],
  [path.join(root, ".pi"), path.join(electronDir, ".pi")],
  [path.join(root, "AGENTS.md"), path.join(electronDir, "AGENTS.md")],
]) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
}
console.log("> 已复制:", "out/", "backend/", ".pi/");
// 3. electron-builder 打 .app（mac dir target，不产 dmg/zip）
run("npx electron-builder --mac --dir", electronDir);
console.log("完成: electron/dist/FLY.app");
