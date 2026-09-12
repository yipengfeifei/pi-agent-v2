#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# FLY 一键打包
#
# 双击本文件即可运行（macOS 会用「终端」打开并执行）。
#
# 为什么需要它：打包过程要清理上一次的构建产物（.next-app / out / backend），
# 属于批量删除；WorkBuddy 的安全守卫会拦截这类操作（防止 AI 误删文件）。
# 在你自己终端的干净环境里运行就没有这个限制。
# ─────────────────────────────────────────────────────────────────────

cd "$(dirname "$0")" || exit 1
PROJECT="$(pwd)"

echo "════════════════════════════════════════════════"
echo "  FLY 打包"
echo "════════════════════════════════════════════════"
echo "  项目: $PROJECT"
echo "════════════════════════════════════════════════"
echo ""

# 确保能找到 node / npm（GUI 启动的终端 PATH 可能不全）
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ 找不到 npm。请先确认已安装 Node.js。"
  echo ""
  read -r -p "按回车关闭窗口..."
  exit 1
fi

echo "▶ node: $(node --version)   npm: $(npm --version)"
echo ""
echo "▶ 开始打包（约 1-3 分钟，请耐心等待）..."
echo ""

cd "$PROJECT/electron" || exit 1
npm run build:app
STATUS=$?

APP="$PROJECT/electron/dist/mac/FLY.app"

if [ $STATUS -eq 0 ] && [ -d "$APP" ]; then
  echo ""
  echo "✅ 打包成功：$APP"
  echo ""
  # 把桌面上旧的那份备份掉（不直接删除，便于回退）
  if [ -e "$HOME/Desktop/FLY.app" ]; then
    OLD="$HOME/Desktop/FLY.app.old-$(date +%Y%m%d-%H%M%S)"
    echo "▶ 桌面已有旧版，先备份为：$(basename "$OLD")"
    mv "$HOME/Desktop/FLY.app" "$OLD"
  fi
  echo "▶ 复制新版到桌面..."
  cp -R "$APP" "$HOME/Desktop/FLY.app"
  echo "✅ 完成！桌面上的 FLY.app 已是新版（含固定 CWD 修复）"
  echo ""
  echo "   以后直接双击桌面上的 FLY.app 就能打开。"
else
  echo ""
  echo "❌ 打包失败（退出码 $STATUS）"
  echo "   请把上面完整的错误信息发给小W。"
fi

echo ""
read -r -p "按回车关闭此窗口..."
