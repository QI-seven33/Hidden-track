#!/usr/bin/env bash
# pm2 方式更新：替换代码 → npm ci → pm2 restart → 健康检查，失败自动回滚。
# 用法：bash deploy/update-pm2.sh <解压出来的更新目录> <当前部署目录> [pm2 应用名]
# 前提：pm2 里已有该应用，且它跑的是 scripts/start.mjs（这个脚本会读 .env）。
set -euo pipefail
incoming=$(realpath "${1:?Usage: bash deploy/update-pm2.sh <extracted-update-directory> <current-app-directory> [app-name]}")
current=$(realpath "${2:?Current app directory required}")
app=${3:-music-card}
[[ "$incoming" != "$current" && -f "$incoming/dist/server.mjs" && -f "$current/.env" ]] || {
  echo '更新目录不对，或当前部署目录缺少 .env'; exit 1;
}
command -v pm2 >/dev/null 2>&1 || { echo '找不到 pm2'; exit 1; }
pm2 describe "$app" >/dev/null 2>&1 || { echo "pm2 里没有名为 $app 的应用，请先 pm2 start ecosystem.config.cjs"; exit 1; }

# 进程真正跑的是哪个脚本、在哪个目录：pm2 不会自动读 .env，跑 dist/server.mjs 就会丢配置。
pid=$(pm2 pid "$app" 2>/dev/null | tr -dc '0-9')
cmdline=$(tr '\0' ' ' < "/proc/${pid:-0}/cmdline" 2>/dev/null || true)
cwd=$(readlink -f "/proc/${pid:-0}/cwd" 2>/dev/null || true)
case "$cmdline" in
  *scripts/start.mjs*) ;;
  *)
    echo "pm2 应用 $app 现在跑的是：${cmdline:-未知}。"
    echo '它不会读取 .env，QQ 音乐登录会全部失效。'
    echo '请先按 docs/1.0.4-线上恢复与更新流程.md 把 pm2 改成 scripts/start.mjs。'
    exit 1
    ;;
esac
[[ "$cwd" == "$current" ]] || { echo "pm2 应用的工作目录是 $cwd，不是 $current"; exit 1; }

port=$(sed -n 's/^PORT=\([0-9][0-9]*\).*/\1/p' "$current/.env" | tail -1)
port=${port:-3000}

backup="$current/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
for f in dist scripts deploy package.json package-lock.json; do
  [[ ! -e "$current/$f" ]] || cp -a "$current/$f" "$backup/"
done

restore() {
  trap - ERR
  echo "更新失败，回滚到 $backup"
  rm -rf "$current/dist"
  [[ -d "$backup/dist" ]] && cp -a "$backup/dist" "$current/dist"
  cp -f "$backup/package.json" "$backup/package-lock.json" "$current/" 2>/dev/null || true
  [[ -d "$backup/scripts" ]] && cp -a "$backup/scripts/." "$current/scripts/"
  [[ -d "$backup/deploy" ]] && cp -a "$backup/deploy/." "$current/deploy/"
  pm2 restart "$app" --update-env >/dev/null 2>&1 || true
  exit 1
}
trap restore ERR

pm2 stop "$app" >/dev/null
rm -rf "$current/dist"
cp -a "$incoming/dist" "$current/dist"
cp -f "$incoming/package.json" "$incoming/package-lock.json" "$current/"
mkdir -p "$current/scripts" "$current/deploy"
cp -a "$incoming/scripts/." "$current/scripts/"
cp -a "$incoming/deploy/." "$current/deploy/"
cd "$current"
npm ci --omit=dev --ignore-scripts > "$backup/install.log" 2>&1
pm2 restart "$app" --update-env >/dev/null

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$port/api/health" > "$backup/health.json" 2>/dev/null; then
    echo -n 'health: '; cat "$backup/health.json"; echo
    echo "backup: $backup"
    trap - ERR
    exit 0
  fi
  sleep .5
done
echo '启动后 30 秒内健康检查未通过，可看 pm2 logs 排查'
restore
