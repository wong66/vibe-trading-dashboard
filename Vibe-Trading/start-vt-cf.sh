#!/usr/bin/env bash
# ============================================================================
# Vibe-Trading · Cloudflare 模式启动器
#   - 启动后端 (127.0.0.1:8898)
#   - 启动 Cloudflare Tunnel（把 8898 暴露成公网网址，供 Pages 前端调用）
# 幂等：已在运行且健康则跳过。
# 由 com.wangzhiping.vt-cf.plist 在登录时自动调用（RunAtLoad）。
# ============================================================================
set -u

VT="/Users/wangzhiping/Claude/大A投研看板/Vibe-Trading"
LOGDIR="$HOME/.vt-cf-logs"
mkdir -p "$LOGDIR"
TUNNEL_NAME="vt-backend"
BACKEND_URL_LOCAL="http://127.0.0.1:8898"

port_listen() { lsof -iTCP:"$1" -sTCP:LISTEN -n -P 2>/dev/null | grep -q LISTEN; }

health() {
  local code
  code=$(curl -s --noproxy '*' --max-time 3 -o /dev/null -w '%{http_code}' "${BACKEND_URL_LOCAL}/health" 2>/dev/null)
  [ "$code" -ge 200 ] && [ "$code" -le 499 ] 2>/dev/null
}

# ---------- 1) 后端 ----------
if port_listen 8898 && health; then
  echo "[vt-cf] 后端已在运行且健康，跳过"
else
  if port_listen 8898; then
    echo "[vt-cf] 后端端口占用但无响应，重启中…"
    kill -9 "$(lsof -tiTCP:8898 -sTCP:LISTEN)" 2>/dev/null || true
    sleep 1
  fi
  echo "[vt-cf] 启动后端 :8898"
  cd "$VT" || exit 1
  setsid .venv/bin/python -m agent.api_server --host 127.0.0.1 --port 8898 \
    > "$LOGDIR/backend.log" 2>&1 < /dev/null &
  disown 2>/dev/null || true
fi

# ---------- 2) Cloudflare Tunnel ----------
if pgrep -f "cloudflared tunnel run.*${TUNNEL_NAME}" >/dev/null 2>&1; then
  echo "[vt-cf] 隧道 ${TUNNEL_NAME} 已在运行，跳过"
else
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "[vt-cf][错误] 未找到 cloudflared，请先运行 deploy-vt-cf.sh 完成安装与登录"
    exit 1
  fi
  echo "[vt-cf] 启动隧道 ${TUNNEL_NAME} → ${BACKEND_URL_LOCAL}"
  setsid cloudflared tunnel run --url "${BACKEND_URL_LOCAL}" "${TUNNEL_NAME}" \
    > "$LOGDIR/tunnel.log" 2>&1 < /dev/null &
  disown 2>/dev/null || true
fi

echo "[vt-cf] 完成。打开你的 Cloudflare Pages 网址即可（Mac 需保持开机联网）。"
