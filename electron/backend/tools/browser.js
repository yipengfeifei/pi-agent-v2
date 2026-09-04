// browser 工具：真实浏览器（ego-browser）——打开网页、等待渲染、提取页面文本
// 治本方案：模型不再用 bash heredoc 拼脚本，直接调本工具；前端独立工具行 + 图标 + url 描述
// 适用：反爬/JS 渲染站点（1688、TikTok、FastMoss 等）——curl/搜索索引拿不到的页面
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const MAX_OUTPUT = 8000; // 单次提取上限（防刷爆上下文）
const TIMEOUT_MS = 120_000;

// ego-browser CLI 路径缓存（首次调用解析，避免每次 spawn 前查 which）
let browserBin = "ego-browser";
let binResolved = false;
async function resolveBin() {
  if (binResolved) return browserBin;
  try {
    const { stdout } = await execFileP("which", ["ego-browser"]);
    if (stdout.trim()) browserBin = stdout.trim();
  } catch { /* PATH 里没有就用默认名 */ }
  binResolved = true;
  return browserBin;
}

// 生成 ego-browser nodejs 脚本：打开 URL → 等待渲染 → 提取 body 文本
function buildScript(url, waitSec) {
  return [
    `const task = await useOrCreateTaskSpace('browser:${String(url).slice(0, 40).replace(/[^a-zA-Z0-9:/. _-]/g, "")}')`,
    `await openOrReuseTab(${JSON.stringify(url)}, { wait: true, timeout: 30 })`,
    `await new Promise(r => setTimeout(r, ${Math.max(1, Math.min(waitSec, 30)) * 1000}))`,
    `const text = await js('document.body.innerText')`,
    `cliLog(text.slice(0, ${MAX_OUTPUT}))`,
  ].join("\n");
}

// spawn 方式运行 ego-browser（execFile 实测失败/超时被杀；spawn + 手动 stdin 已验证可用）
// 注意：ego-browser 的 cliLog 输出走 stderr
function runBrowserScript(script) {
  return new Promise((resolve, reject) => {
    const proc = spawn(browserBin, ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { proc.kill(); reject(new Error("浏览器操作超时")); }, TIMEOUT_MS);
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !err.trim()) reject(new Error(`ego-browser 退出码 ${code}`));
      else resolve((err || out).trim());
    });
    proc.stdin.write(script);
    proc.stdin.end();
  });
}

export const browserTool = defineTool({
  name: "browser",
  label: "浏览器操作",
  description:
    "真实浏览器（ego-browser）：打开网页、等待渲染、提取页面文本。用于访问反爬/JS 渲染/需登录态的站点（1688、TikTok、FastMoss 等），" +
    "curl 和 search 拿不到的页面用它。参数：url（要打开的地址）、wait（等待渲染秒数，默认 3）、" +
    "action=open（默认，返回页面正文文本）。注意：验证码/登录墙会移交用户人工处理；页面文本可能含噪音，需自行清洗。",
  parameters: Type.Object({
    url: Type.String({ description: "要打开的完整 URL（含协议）" }),
    action: Type.Optional(Type.String({ description: "open（默认，打开+提取正文）| screenshot" })),
    wait: Type.Optional(Type.Number({ description: "等待渲染秒数 1-30，默认 3" })),
  }),
  execute: async (_toolCallId, params) => {
    const url = String(params.url ?? "").trim();
    if (!/^https?:\/\//.test(url)) {
      return { content: [{ type: "text", text: "url 必须是完整 http(s) 地址，如 https://s.1688.com/selloffer/offer_search.htm?keywords=xxx" }], details: { isError: true } };
    }
    const wait = Math.max(1, Math.min(Number(params.wait) || 3, 30));
    const bin = await resolveBin();
    const script = buildScript(url, wait);
    try {
      const text = await runBrowserScript(script);
      if (!text) {
        return { content: [{ type: "text", text: `页面打开但未提取到文本（url: ${url}）。可能：① 还在加载/被验证码拦截 ② 页面无正文（JS 重定向）。可加大 wait 重试，或改用 search 搜索该站点。` }], details: { isError: true } };
      }
      return {
        content: [{ type: "text", text: `## ${url}\n\n${text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) + "\n…（已截断）" : text}` }],
        details: { url, bytes: text.length },
      };
    } catch (err) {
      console.error(`[browser] 打开失败（${url}）：${String(err?.message ?? err)}`);
      return {
        content: [{ type: "text", text: `浏览器打开失败：${String(err?.message ?? err).slice(0, 200)}（url: ${url}）。可重试或改用 search。` }],
        details: { isError: true },
      };
    }
  },
});
