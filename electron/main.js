// FLY 桌面壳：本地静态服务（前端产物）+ 后端 server.js 子进程（独立 WS 端口）
// 后端优先用系统 node 跑（实测：Electron 内置 node 的 c-ares 在 DNS 解析时会 SIGILL 崩溃，
// 崩两次/天后后端进程消失 → 前端 WS 断连、busy 卡死、暂停/切会话全失灵；
// 系统 node（/usr/local/bin/node）跑 dev 后端一天零崩溃，稳定性有实证）。
// 找不到系统 node 时回退 utilityProcess（保留"免系统依赖"的 Finder 启动能力）。
// 看门狗：后端崩了自动重启（退避：连崩翻倍，活过 30s 归零），前端 2s 重连自动恢复。
const { app, BrowserWindow, utilityProcess } = require("electron");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const APP_DIR = __dirname; // 打包后 = <FLY.app>/Contents/Resources/app
const OUT_DIR = path.join(APP_DIR, "out");
const BACKEND_JS = path.join(APP_DIR, "backend", "server.js");
// 与前端编译期内联的 NEXT_PUBLIC_WS_PORT 保持一致（dev 用 4700，互不干扰）
const WS_PORT = 4800;
const SYSTEM_NODE = process.env.FLY_BACKEND_NODE || "/usr/local/bin/node";

let backendProc = null;
let quitting = false;
let restartTimer = null;
let restartDelay = 2000;
const MAX_RESTART_DELAY = 30000; // 连崩退避上限：最坏每 30s 重试一次，不无限打日志

// 活过 30s 视为健康：退避归零（区分"偶发崩"与"持续崩"）
function startBackend() {
  if (backendProc || quitting) return;
  const env = { ...process.env, PORT: String(WS_PORT) };
  const aliveTimer = setTimeout(() => {
    restartDelay = 2000;
  }, 30000);
  const scheduleRestart = (code) => {
    clearTimeout(aliveTimer);
    backendProc = null;
    if (quitting) return;
    console.log(`[FLY] backend exited (${code ?? "signal"}), restarting in ${restartDelay}ms`);
    restartTimer = setTimeout(startBackend, restartDelay);
    restartDelay = Math.min(restartDelay * 2, MAX_RESTART_DELAY);
  };
  const proc = spawn(SYSTEM_NODE, [BACKEND_JS], { env, stdio: "inherit" });
  backendProc = proc;
  proc.on("exit", scheduleRestart);
  proc.on("error", () => {
    // 系统 node 不存在/不可执行（其他机器）：回退 Electron 内置 node。
    // spawn 失败后 exit 可能也会触发，先摘掉监听避免双重启。
    proc.removeListener("exit", scheduleRestart);
    if (quitting) return;
    backendProc = utilityProcess.fork(BACKEND_JS, [], { env, stdio: "inherit" });
    backendProc.on("exit", scheduleRestart);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".ico": "image/x-icon",
};

function startStaticServer() {
  return http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const file = path.join(OUT_DIR, rel);
      if (!file.startsWith(OUT_DIR)) {
        res.writeHead(403);
        return res.end();
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          return res.end("not found");
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
}

app.whenReady().then(async () => {
  startBackend();

  const server = startStaticServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const pagePort = server.address().port;

  const win = new BrowserWindow({
    width: 668,
    height: 595,
    minWidth: 480,
    minHeight: 400,
    backgroundColor: "#000000",
    title: "FLY",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(APP_DIR, "preload.js"),
    },
  });
  await win.loadURL(`http://127.0.0.1:${pagePort}`);
});

app.on("before-quit", () => {
  quitting = true;
  clearTimeout(restartTimer);
  backendProc?.kill();
});
app.on("window-all-closed", () => {
  app.quit();
});
