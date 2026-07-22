#!/usr/bin/env bash
# ============================================================================
# Vibe-Trading → Cloudflare 一键部署（Mac 隧道模式）
# ----------------------------------------------------------------------------
# 需要你本人在浏览器里完成 2 次登录（脚本会主动弹出浏览器）：
#   1) wrangler login        —— 部署前端到 Cloudflare Pages
#   2) cloudflared tunnel login —— 把本机后端暴露成公网网址
# 其余（安装、构建、配置、开机自启）全自动。
#
# 用法：在「终端」里运行
#   bash /Users/wangzhiping/Claude/大A投研看板/Vibe-Trading/deploy-vt-cf.sh
# ============================================================================
set -u

VT="/Users/wangzhiping/Claude/大A投研看板/Vibe-Trading"
MANAGED_NODE="/Users/wangzhiping/.workbuddy/binaries/node/versions/22.22.2/bin"
TUNNEL_NAME="vt-backend"
CONF="$HOME/.vt-cf.conf"
PLIST="$HOME/Library/LaunchAgents/com.wangzhiping.vt-cf.plist"

# ---- PATH：优先用受管 node + brew ----
export PATH="$MANAGED_NODE:/opt/homebrew/bin:/usr/local/bin:$PATH"
# npm 全局装到用户目录，避免 sudo
mkdir -p "$HOME/.npm-global"
"$MANAGED_NODE/npm" config set prefix "$HOME/.npm-global" >/dev/null 2>&1 || true
export PATH="$HOME/.npm-global/bin:$PATH"

step(){ echo; echo "========== $1 =========="; }

# ---------------------------------------------------------------------------
step "1/7 安装工具"
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[*] 安装 cloudflared ..."
  if command -v brew >/dev/null 2>&1; then
    brew install cloudflared
  else
    echo "[!] 没装 Homebrew。请先打开浏览器搜『安装 Homebrew』，或手动下载："
    echo "    https://github.com/cloudflare/cloudflared/releases"
    exit 1
  fi
else
  echo "[✓] cloudflared 已安装"
fi

if ! command -v wrangler >/dev/null 2>&1; then
  echo "[*] 安装 wrangler（全局，装到 ~/.npm-global）..."
  "$MANAGED_NODE/npm" install -g wrangler
else
  echo "[✓] wrangler 已安装"
fi

# ---------------------------------------------------------------------------
step "2/7 登录 Cloudflare（会弹出浏览器，请授权）"
if wrangler whoami >/dev/null 2>&1; then
  echo "[✓] wrangler 已登录：$(wrangler whoami 2>/dev/null)"
else
  echo "[*] 请在弹出的浏览器里登录 Cloudflare 账号…"
  wrangler login || { echo "[!] wrangler 登录失败"; exit 1; }
fi

if [ -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "[✓] cloudflared 已授权"
else
  echo "[*] 请在弹出的浏览器里登录 Cloudflare 账号（授权隧道）…"
  cloudflared tunnel login || { echo "[!] cloudflared 登录失败"; exit 1; }
fi

# ---------------------------------------------------------------------------
step "3/7 创建 Cloudflare Tunnel（拿公网网址）"
EXISTING=$(cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2==n {print $1}')
if [ -n "$EXISTING" ]; then
  TUNNEL_ID="$EXISTING"
  echo "[✓] 隧道已存在: $TUNNEL_ID"
else
  echo "[*] 创建隧道 $TUNNEL_NAME ..."
  OUT=$(cloudflared tunnel create "$TUNNEL_NAME" 2>&1) || { echo "[!] 创建失败: $OUT"; exit 1; }
  TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2==n {print $1}')
fi
[ -z "$TUNNEL_ID" ] && { echo "[!] 取不到隧道 ID"; exit 1; }
TUNNEL_URL="https://${TUNNEL_ID}.cfargotunnel.com"
echo "    公网网址: $TUNNEL_URL"
printf 'TUNNEL_ID=%s\nTUNNEL_URL=%s\n' "$TUNNEL_ID" "$TUNNEL_URL" > "$CONF"
echo "[✓] 已写入 $CONF"

# ---------------------------------------------------------------------------
step "4/7 把隧道网址写入 wrangler.toml"
cd "$VT" || exit 1
if [ -f wrangler.toml ]; then
  sed -i '' -E "s#^(BACKEND_URL = ).*#\1\"${TUNNEL_URL}\"#" wrangler.toml
  echo "[✓] wrangler.toml 已更新 BACKEND_URL"
  grep -n "BACKEND_URL" wrangler.toml
else
  echo "[!] 找不到 wrangler.toml"; exit 1
fi

# ---------------------------------------------------------------------------
step "5/7 构建前端"
cd "$VT/frontend" || exit 1
"$MANAGED_NODE/npm" run build || { echo "[!] 前端构建失败"; exit 1; }
echo "[✓] 前端构建完成 -> frontend/dist"

# ---------------------------------------------------------------------------
step "6/7 部署到 Cloudflare Pages（新项目 vt-board，避开旧站点 vibe-trading 的 Access 登录墙）"
cd "$VT" || exit 1   # functions/ 必须在项目根目录，wrangler 才能读到
wrangler pages project create vt-board --production-branch main >/dev/null 2>&1 || true
wrangler pages deploy frontend/dist --project-name vt-board || { echo "[!] 部署失败"; exit 1; }
echo "[✓] 部署完成"

# ---------------------------------------------------------------------------
step "7/7 配置开机自启（Mac 登录后自动起后端+隧道）"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.wangzhiping.vt-cf</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${VT}/start-vt-cf.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${VT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.vt-cf-logs/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.vt-cf-logs/launchd.err</string>
</dict>
</plist>
EOF
launchctl load "$PLIST" 2>/dev/null || true
echo "[✓] 已写入并加载 $PLIST（RunAtLoad）"

# ---------------------------------------------------------------------------
step "完成 🎉"
echo
echo "你的 Vibe-Trading 已部署到 Cloudflare："
echo "  前端（任何地方打开）: https://vt-board.pages.dev"
echo "  后端隧道网址         : $TUNNEL_URL"
echo
echo "重要提醒："
echo "  • 任意设备打开 https://vt-board.pages.dev 即可看界面。"
echo "  • 要看到实时数据，本机 Mac 必须开机 + 联网 + 后端在跑（已设开机自启）。"
echo "  • 想手动启动/重启：bash $VT/start-vt-cf.sh"
echo "  • 查看后端日志：cat ~/.vt-cf-logs/backend.log"
echo "  • 查看隧道日志：cat ~/.vt-cf-logs/tunnel.log"
echo "  • 取消开机自启：launchctl unload $PLIST"
