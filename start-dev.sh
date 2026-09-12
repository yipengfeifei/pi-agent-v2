#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# pi Agent V2 · 开发启动脚本
#
# 解决的核心问题：会话归档分裂。
# backend/server.js 的 CWD 默认由自身路径推导，导致：
#   从 <项目根>/backend 启动  → CWD = <项目根>
#   从 <项目根>/electron/backend 启动 → CWD = <FLY.app>/Contents/Resources/app
# 两者的会话归档目录不同，前端只看当前 CWD → 历史会话"消失"。
#
# 本脚本显式固定 CWD，保证无论从哪启动都归到同一个归档。
# ─────────────────────────────────────────────────────────────────────

set -e

PROJECT_ROOT="/Users/yipengfei/Desktop/pi Agent V2"

# ★ 关键：固定会话工作目录（必须 export，子进程才能继承）
export CWD="$PROJECT_ROOT"

cd "$PROJECT_ROOT"

echo "─────────────────────────────────────────────"
echo " pi Agent V2 · 开发模式"
echo "─────────────────────────────────────────────"
echo " 项目根      : $PROJECT_ROOT"
echo " 会话 CWD    : $CWD"
echo " 归档目录    : ~/.pi/agent/sessions/--Users-yipengfei-Desktop-pi Agent V2--/"
echo "─────────────────────────────────────────────"

# 检查 node
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 找不到 node，请先安装 Node.js" >&2
  exit 1
fi

# 可选：清理 Turbopack 开发缓存（会随 next dev 编译单调增长，可大到数百 MB）
# 想清理就取消下面这行的注释
# rm -rf "$PROJECT_ROOT/frontend/.next/dev"

echo ""
echo "▶ 启动后端 (WS 服务)..."
node "$PROJECT_ROOT/backend/server.js" &
BACKEND_PID=$!

echo "▶ 启动前端 (Next.js, http://localhost:3102)..."
cd "$PROJECT_ROOT/frontend"
npx next dev -p 3102 &
FRONTEND_PID=$!

# Ctrl+C 时一并退出两个子进程
cleanup() {
  echo ""
  echo "▶ 正在停止..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  echo "▶ 已停止。"
  exit 0
}
trap cleanup INT TERM

wait
