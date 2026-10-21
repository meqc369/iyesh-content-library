#!/usr/bin/env bash
# 月入万刀 · production update script
#
# Run on the production server as root:
#   curl -fsSL https://raw.githubusercontent.com/meqc369/iyesh-content-library/main/deploy/update.sh -o /root/iyesh-update.sh
#   bash /root/iyesh-update.sh            # deploy the latest main branch
#   bash /root/iyesh-update.sh <commit>   # deploy a specific commit / tag
#   bash /root/iyesh-update.sh --rollback /opt/iyesh/backups/<time>
#
# What it does:
#   1. finds the running API process (port 8787) and how it is managed (systemd or pm2)
#   2. downloads the requested version from GitHub and checks it
#   3. backs up the current front-end, API code and data/store.json
#   4. asks for confirmation, then replaces front-end files and server/index.mjs
#      (data/, uploads/, .env and node_modules are never touched)
#   5. restarts the API, checks /health and the home page, and rolls back
#      automatically if the check fails
set -Eeuo pipefail

REPO="${IYESH_REPO:-meqc369/iyesh-content-library}"
WEB_ROOT="${IYESH_WEB_ROOT:-/var/www/iyesh-h5}"
API_PORT="${IYESH_API_PORT:-8787}"
BACKUP_ROOT="${IYESH_BACKUP_ROOT:-/opt/iyesh/backups}"
SITE_URL="${IYESH_SITE_URL:-https://iyesh.com}"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m ✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 用户运行（或在命令前加 sudo）"
for bin in curl tar node; do command -v "$bin" >/dev/null 2>&1 || die "缺少命令：$bin"; done

# ---------------------------------------------------------------- API process
API_PID=""; API_DIR=""; MANAGER=""; UNIT=""; PM2_ID=""
find_api() {
  API_PID=""
  if command -v ss >/dev/null 2>&1; then
    API_PID="$(ss -ltnpH "sport = :${API_PORT}" 2>/dev/null | grep -o 'pid=[0-9]*' | head -n1 | cut -d= -f2 || true)"
  fi
  if [ -z "$API_PID" ] && command -v lsof >/dev/null 2>&1; then
    API_PID="$(lsof -t -iTCP:"${API_PORT}" -sTCP:LISTEN 2>/dev/null | head -n1 || true)"
  fi
}
detect_manager() {
  find_api
  [ -n "$API_PID" ] || die "没有找到监听 ${API_PORT} 端口的 API 进程，请先确认后端在运行"
  # Work out which index.mjs the process runs: pm2's exec path, then the script
  # argument on the command line, then the working directory.
  local cwd script arg
  cwd="$(readlink -f "/proc/${API_PID}/cwd")"
  script="$(tr '\0' '\n' < "/proc/${API_PID}/environ" 2>/dev/null | grep '^pm_exec_path=' | head -n1 | cut -d= -f2- || true)"
  if [ -z "$script" ]; then
    while IFS= read -r arg; do
      case "$arg" in *index.mjs) script="$arg"; break ;; esac
    done < <(tr '\0' '\n' < "/proc/${API_PID}/cmdline")
  fi
  if [ -n "$script" ]; then
    case "$script" in /*) ;; *) script="${cwd}/${script}" ;; esac
    API_DIR="$(dirname "$(readlink -f "$script")")"
  else
    API_DIR="$cwd"
  fi
  [ -f "${API_DIR}/index.mjs" ] || die "没有在 ${API_DIR} 找到 API 程序 index.mjs，请手动确认后端目录"
  if tr '\0' '\n' < "/proc/${API_PID}/environ" 2>/dev/null | grep -q '^pm_id='; then
    MANAGER="pm2"
    PM2_ID="$(tr '\0' '\n' < "/proc/${API_PID}/environ" | grep '^pm_id=' | head -n1 | cut -d= -f2)"
    command -v pm2 >/dev/null 2>&1 || die "API 由 pm2 管理，但当前 shell 找不到 pm2 命令"
  elif grep -qE 'docker|containerd' "/proc/${API_PID}/cgroup" 2>/dev/null; then
    die "API 运行在 Docker 容器里，这个脚本只处理 systemd / pm2 部署，请改用 docker compose up -d --build"
  else
    UNIT="$(ps -o unit= -p "$API_PID" 2>/dev/null | tr -d ' ' || true)"
    [[ "$UNIT" == *.service ]] || UNIT="$(grep -o '[^/]*\.service' "/proc/${API_PID}/cgroup" 2>/dev/null | tail -n1 || true)"
    if [[ "$UNIT" == *.service ]]; then MANAGER="systemd"; else
      die "API 进程（PID ${API_PID}）不是由 systemd 或 pm2 管理的，无法安全重启。请把它配置成 systemd 服务后再运行本脚本"
    fi
  fi
}
restart_api() {
  case "$MANAGER" in
    systemd) systemctl restart "$UNIT" ;;
    pm2) pm2 restart "$PM2_ID" >/dev/null ;;
  esac
}
wait_healthy() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT}/health" 2>/dev/null | grep -q '"ok":true'; then return 0; fi
    sleep 1
  done
  return 1
}

# ---------------------------------------------------------------- rollback
rollback_from() {
  local dir="$1"
  [ -f "${dir}/web.tgz" ] && [ -f "${dir}/index.mjs" ] || die "备份目录 ${dir} 不完整（需要 web.tgz 和 index.mjs）"
  [ -n "$MANAGER" ] || detect_manager
  say "从 ${dir} 恢复前端和 API 代码"
  local parent; parent="$(dirname "$WEB_ROOT")"
  local stamp; stamp="$(date +%Y%m%d-%H%M%S)"
  mv "$WEB_ROOT" "${WEB_ROOT}.failed-${stamp}"
  mkdir -p "$parent"
  tar -xzf "${dir}/web.tgz" -C "$parent"
  cp -p "${dir}/index.mjs" "${API_DIR}/index.mjs"
  restart_api
  if wait_healthy; then ok "已回滚到更新前的版本"; else die "回滚后 API 仍未通过健康检查，请查看日志：$( [ "$MANAGER" = systemd ] && echo "journalctl -u $UNIT -n 100" || echo "pm2 logs $PM2_ID --lines 100")"; fi
  warn "失败的版本保留在 ${WEB_ROOT}.failed-${stamp}，确认无误后可以删除"
}

if [ "${1:-}" = "--rollback" ]; then
  [ -n "${2:-}" ] || die "用法：bash $0 --rollback /opt/iyesh/backups/<时间>"
  rollback_from "$2"
  exit 0
fi

REF="${1:-main}"
[[ "$REF" =~ ^[A-Za-z0-9._/-]+$ ]] || die "版本号格式不正确：$REF"

say "检查线上环境"
[ -d "$WEB_ROOT" ] || die "前端目录不存在：$WEB_ROOT"
detect_manager
ok "前端目录：$WEB_ROOT"
ok "API 目录：$API_DIR（PID ${API_PID}，由 ${MANAGER} 管理${UNIT:+：$UNIT}${PM2_ID:+：pm2 #$PM2_ID}）"

# ---------------------------------------------------------------- download
WORK="$(mktemp -d /tmp/iyesh-update.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
if [ -n "${IYESH_LOCAL_TARBALL:-}" ]; then
  say "使用本地代码包 ${IYESH_LOCAL_TARBALL}"
  cp "$IYESH_LOCAL_TARBALL" "${WORK}/src.tgz"
else
  say "下载 ${REPO}@${REF}"
  curl -fsSL --retry 3 --max-time 120 "https://codeload.github.com/${REPO}/tar.gz/${REF}" -o "${WORK}/src.tgz" \
    || die "下载失败，请检查服务器能否访问 GitHub，或版本号是否存在"
fi
mkdir -p "${WORK}/src"
tar -xzf "${WORK}/src.tgz" -C "${WORK}/src" --strip-components=1
SRC="${WORK}/src"
for f in index.html detail.html publish.html profile.html membership.html exploration.html login.html admin.html admin-login.html core.js exploration.js styles.css admin.css server/index.mjs; do
  [ -f "${SRC}/${f}" ] || die "下载的代码缺少 ${f}，已停止"
done
node --check "${SRC}/server/index.mjs" || die "server/index.mjs 语法检查未通过，已停止"
if ! cmp -s "${SRC}/server/package.json" "${API_DIR}/package.json" 2>/dev/null; then
  warn "server/package.json 和线上不同；本脚本不会自动安装依赖，如有新依赖请在 ${API_DIR} 运行 npm ci --omit=dev"
fi
ok "代码检查通过"

# ---------------------------------------------------------------- backup
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${BACKUP_ROOT}/${STAMP}"
say "备份当前线上版本到 ${BACKUP}"
mkdir -p "$BACKUP"
tar -czf "${BACKUP}/web.tgz" -C "$(dirname "$WEB_ROOT")" "$(basename "$WEB_ROOT")"
cp -p "${API_DIR}/index.mjs" "${BACKUP}/index.mjs"
tar -czf "${BACKUP}/api-code.tgz" -C "$API_DIR" --exclude=./node_modules --exclude=./uploads --exclude=./data .
if [ -d "${API_DIR}/data" ]; then tar -czf "${BACKUP}/data.tgz" -C "$API_DIR" data; fi
printf 'ref=%s\nmanager=%s\nunit=%s\npm2=%s\napi_dir=%s\nweb_root=%s\n' "$REF" "$MANAGER" "$UNIT" "$PM2_ID" "$API_DIR" "$WEB_ROOT" > "${BACKUP}/info.txt"
ok "备份完成（$(du -sh "$BACKUP" | cut -f1)）"

# ---------------------------------------------------------------- confirm
echo
echo "  将要更新：前端页面（${WEB_ROOT}）和 API 程序（${API_DIR}/index.mjs）"
echo "  不会改动：数据（data/）、上传的图片（uploads/）、环境变量和 nginx 配置"
echo "  如需回滚：bash $0 --rollback ${BACKUP}"
echo
if [ "${IYESH_YES:-}" != "1" ]; then
  answer=""
  read -r -p "确认上线？输入 y 继续：" answer < /dev/tty || true
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || { warn "已取消，线上没有任何改动（备份保留在 ${BACKUP}）"; exit 0; }
fi

# ---------------------------------------------------------------- deploy
say "更新前端"
STAGE="${WORK}/web"
mkdir -p "$STAGE"
cp -p "${SRC}"/*.html "${SRC}"/*.js "${SRC}"/*.css "$STAGE"/
cp -rp "${SRC}/assets" "$STAGE/assets"
[ -d "${SRC}/tags" ] && cp -rp "${SRC}/tags" "$STAGE/tags"
# Keep the production API config if it was customised on the server.
[ -f "${WEB_ROOT}/api-config.js" ] && cp -p "${WEB_ROOT}/api-config.js" "$STAGE/api-config.js"
# Copy over the live directory so files that only exist on the server
# (e.g. verification files) stay in place.
cp -rp "$STAGE"/. "$WEB_ROOT"/
chown -R --reference="$(dirname "$WEB_ROOT")" "$WEB_ROOT" 2>/dev/null || true
find "$WEB_ROOT" -type d -exec chmod 755 {} + ; find "$WEB_ROOT" -type f -exec chmod 644 {} +
ok "前端已更新"

say "更新 API"
cp "${SRC}/server/index.mjs" "${API_DIR}/index.mjs.new"
chown --reference="${API_DIR}/index.mjs" "${API_DIR}/index.mjs.new" 2>/dev/null || true
mv "${API_DIR}/index.mjs.new" "${API_DIR}/index.mjs"
# Nginx serves uploads directly via an alias. Keep the directory traversable
# for its worker user while leaving uploaded files readable but not writable.
if [ -d "${API_DIR}/uploads" ]; then
  chmod 755 "${API_DIR}/uploads"
  find "${API_DIR}/uploads" -type f -exec chmod 644 {} +
fi
for f in import-content.mjs smoke.mjs production-smoke.mjs; do [ -f "${SRC}/server/${f}" ] && cp "${SRC}/server/${f}" "${API_DIR}/${f}"; done
restart_api
if ! wait_healthy; then
  warn "新版本 API 没有通过健康检查，正在自动回滚"
  rollback_from "$BACKUP"
  exit 1
fi
ok "API 已重启并通过健康检查"

say "检查网站"
home="$(curl -fsS --max-time 10 "${SITE_URL}/" 2>/dev/null || true)"
if printf '%s' "$home" | grep -q 'core.js'; then ok "首页正常：${SITE_URL}/"; else warn "无法从服务器访问 ${SITE_URL}/ 或首页内容不符，请在浏览器里打开确认"; fi
if curl -fsS --max-time 10 "${SITE_URL}/api/v1/member/plans" >/dev/null 2>&1; then ok "接口正常：${SITE_URL}/api/v1/member/plans"; else warn "通过域名访问接口失败，请检查 nginx"; fi

echo
ok "上线完成。备份在 ${BACKUP}"
echo "  如需回滚：bash $0 --rollback ${BACKUP}"
echo "  手机和电脑如果看到旧样式，刷新一次页面即可（静态文件缓存最长 1 小时，本次已更新版本号）"
