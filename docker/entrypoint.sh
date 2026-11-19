#!/bin/sh
# 单容器双服务：SearXNG（搜索引擎）+ agent-search（MCP server）
#
# 为什么合并：两者需要同一个网络出口。分容器时 SearXNG 走旁路由代理、
# agent-search 走宿主 DNS，导致「搜得到国外链接但抓不到内容」。
# 合并后共享一份网络配置，抓取和搜索永远同一条链路。
#
# 进程关系：agent-search 依赖 SearXNG，任一退出即整体退出，
# 由 Docker 的 restart policy 拉起，避免留下半死状态。

set -u

log() { echo "[entrypoint] $*"; }

# ---- SearXNG ----
# 官方 entrypoint 负责：配置存在性检查、目录属主修正、update-ca-certificates，
# 最后 exec granian（进程镜像被替换，所以 $! 后续就是 granian 的 PID）
log "starting searxng"
/usr/local/searxng/entrypoint.sh &
SEARXNG_PID=$!

# 等 SearXNG 可服务再起 agent-search，避免首请求打到未就绪的端口。
# 最多等 30 秒，超时也继续启动（agent-search 首次请求晚于启动，通常来得及）。
i=0
while [ "$i" -lt 30 ]; do
  if wget -q -O /dev/null http://127.0.0.1:8080/ 2>/dev/null; then
    log "searxng ready after ${i}s"
    break
  fi
  sleep 1
  i=$((i + 1))
done
[ "$i" -ge 30 ] && log "searxng not ready after 30s, continuing anyway"

# ---- agent-search ----
log "starting agent-search (port ${MCP_HTTP_PORT:-1234})"
(cd /app && exec node dist/index.js) &
AGENT_PID=$!

shutdown() {
  log "signal received, stopping both"
  kill "$SEARXNG_PID" "$AGENT_PID" 2>/dev/null
  wait 2>/dev/null
  exit 0
}
trap shutdown TERM INT

# 任一进程退出就收尾
while kill -0 "$SEARXNG_PID" 2>/dev/null && kill -0 "$AGENT_PID" 2>/dev/null; do
  sleep 2
done

if kill -0 "$SEARXNG_PID" 2>/dev/null; then
  log "agent-search exited, stopping searxng"
else
  log "searxng exited, stopping agent-search"
fi

kill "$SEARXNG_PID" "$AGENT_PID" 2>/dev/null
wait 2>/dev/null
exit 1
