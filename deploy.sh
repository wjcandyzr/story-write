#!/usr/bin/env bash
# deploy.sh — AI Novel stack 一键启停
#
#   ./deploy.sh start    # postgres + redis (docker) + nest dev + vite dev
#   ./deploy.sh stop     # 关 nest + vite,docker 容器保留(下次 start 更快)
#   ./deploy.sh down     # 关全部,包括 docker 容器(数据卷不删)
#   ./deploy.sh status   # 看现在跑了什么
#   ./deploy.sh logs api # 跟 nest 日志
#   ./deploy.sh logs web # 跟 vite 日志
#   ./deploy.sh restart  # = stop + start
#
# Windows 用户:在 Git Bash 中运行(Win+R → cmd → "C:\Program Files\Git\bin\bash.exe")
# Linux/Mac:  chmod +x deploy.sh && ./deploy.sh start

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="$ROOT_DIR/.run"
PID_API="$RUN_DIR/api.pid"
PID_WEB="$RUN_DIR/web.pid"
LOG_API="$RUN_DIR/api.log"
LOG_WEB="$RUN_DIR/web.log"
mkdir -p "$RUN_DIR"

API_PORT=3000
WEB_PORT=4000

# ---------- helpers ----------

c_green() { printf "\033[32m%s\033[0m\n" "$1"; }
c_red()   { printf "\033[31m%s\033[0m\n" "$1"; }
c_dim()   { printf "\033[2m%s\033[0m\n" "$1"; }
step()    { printf "\033[36m▶\033[0m %s\n" "$1"; }

pid_alive() {
  [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null
}

port_in_use() {
  # Linux/Mac:    nc / lsof
  # Git Bash on Windows: nc 通常没有,用 powershell.exe -c "Test-NetConnection ..." 太重
  # 退化策略: 直接打它,connect 成功即占用
  (echo > /dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1
}

stop_pid() {
  local pidfile="$1"
  local name="$2"
  if pid_alive "$pidfile"; then
    local pid
    pid="$(cat "$pidfile")"
    step "stop $name (pid=$pid)"
    kill "$pid" 2>/dev/null || true
    # 给 5 秒优雅退出,然后 -9
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      c_red "  · 强制 SIGKILL"
      kill -9 "$pid" 2>/dev/null || true
    fi
  else
    c_dim "● $name 未运行"
  fi
  rm -f "$pidfile"
}

# ---------- starters ----------

start_docker() {
  step "docker compose up -d postgres redis"
  (cd "$ROOT_DIR" && docker compose up -d postgres redis)
}

start_api() {
  if pid_alive "$PID_API"; then
    c_dim "● nest 已在跑 (pid=$(cat "$PID_API"))"
    return
  fi
  if port_in_use "$API_PORT"; then
    c_red "● 端口 :$API_PORT 已被占用,但不是我们启的;请先释放或 stop 现有进程"
    return 1
  fi
  step "start nest (dev) → $LOG_API"
  if [ ! -d "$ROOT_DIR/node_modules" ]; then
    step "首次启动,先 npm install (后端)"
    (cd "$ROOT_DIR" && npm install)
  fi
  (cd "$ROOT_DIR" && nohup npm run start:dev > "$LOG_API" 2>&1 &
    echo $! > "$PID_API")
  sleep 1
  c_dim "  pid=$(cat "$PID_API"),正在编译,请稍候 5~10 秒"
}

start_web() {
  if pid_alive "$PID_WEB"; then
    c_dim "● vite 已在跑 (pid=$(cat "$PID_WEB"))"
    return
  fi
  if port_in_use "$WEB_PORT"; then
    c_red "● 端口 :$WEB_PORT 已被占用,但不是我们启的;请先释放或 stop 现有进程"
    return 1
  fi
  step "start vite (dev) → $LOG_WEB"
  if [ ! -d "$ROOT_DIR/web/node_modules" ]; then
    step "首次启动,先 npm install (前端)"
    (cd "$ROOT_DIR/web" && npm install)
  fi
  (cd "$ROOT_DIR/web" && nohup npm run dev > "$LOG_WEB" 2>&1 &
    echo $! > "$PID_WEB")
  sleep 1
  c_dim "  pid=$(cat "$PID_WEB")"
}

# ---------- main ----------

cmd="${1:-}"
case "$cmd" in

  start)
    start_docker
    start_api
    start_web
    echo
    c_green "✓ 已拉起整套服务"
    echo "    前端:  http://localhost:$WEB_PORT/"
    echo "    后端:  http://localhost:$API_PORT/api"
    echo "    Swagger: http://localhost:$API_PORT/docs"
    echo
    c_dim "查看日志:  ./deploy.sh logs api  /  ./deploy.sh logs web"
    c_dim "停止:      ./deploy.sh stop  (容器保留)  /  ./deploy.sh down  (全关)"
    ;;

  stop)
    stop_pid "$PID_WEB" "vite"
    stop_pid "$PID_API" "nest"
    c_green "✓ 应用层已停 (postgres / redis 容器仍运行)"
    ;;

  down)
    stop_pid "$PID_WEB" "vite"
    stop_pid "$PID_API" "nest"
    step "docker compose down"
    (cd "$ROOT_DIR" && docker compose down)
    c_green "✓ 全部已停 (数据卷保留,下次 start 数据还在)"
    ;;

  restart)
    "$0" stop
    "$0" start
    ;;

  status)
    if pid_alive "$PID_API"; then
      c_green "● nest  : running (pid=$(cat "$PID_API"))  → http://localhost:$API_PORT"
    else
      c_dim   "○ nest  : stopped"
    fi
    if pid_alive "$PID_WEB"; then
      c_green "● vite  : running (pid=$(cat "$PID_WEB"))  → http://localhost:$WEB_PORT"
    else
      c_dim   "○ vite  : stopped"
    fi
    echo
    (cd "$ROOT_DIR" && docker compose ps)
    ;;

  logs)
    case "${2:-}" in
      api) tail -f "$LOG_API" ;;
      web) tail -f "$LOG_WEB" ;;
      *)   echo "usage: $0 logs api|web"; exit 1 ;;
    esac
    ;;

  ""|-h|--help|help)
    cat <<EOF
deploy.sh — AI Novel stack 一键启停

  $0 start        启动 postgres+redis(容器) + nest(本机 dev) + vite(本机 dev)
  $0 stop         停 nest + vite,容器保留
  $0 down         停 nest + vite,顺便 docker compose down(数据卷不删)
  $0 restart      stop + start
  $0 status       显示当前状态
  $0 logs api     跟 nest 日志
  $0 logs web     跟 vite 日志

服务地址:
  前端:    http://localhost:$WEB_PORT/
  后端:    http://localhost:$API_PORT/api
  Swagger: http://localhost:$API_PORT/docs
EOF
    ;;

  *)
    c_red "未知命令: $cmd"
    exec "$0" --help
    ;;
esac
