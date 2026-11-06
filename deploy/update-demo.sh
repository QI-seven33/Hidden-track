#!/usr/bin/env bash
set -euo pipefail
# Run after extracting the deployment archive into a NEW directory.
incoming=$(realpath "${1:?Usage: bash deploy/update-demo.sh <extracted-update-directory> <current-app-directory>}")
current=$(realpath "${2:?Current app directory required}")
[[ "$incoming" != "$current" && -f "$incoming/dist/server.mjs" && -f "$current/.env" ]] || { echo 'Update directory or existing .env is missing'; exit 1; }
# pm2 也在管这个名字时别再起第二个进程：两边抢 3000 端口，还各自持锁。
if command -v pm2 >/dev/null 2>&1 && pm2 describe music-card >/dev/null 2>&1; then
  echo 'music-card 正由 pm2 管理，请改用 deploy/update-pm2.sh（pm2 方式），本脚本已退出。'
  exit 1
fi
exec 9>"$current/.update.lock"
flock -n 9 || { echo 'Another update is running'; exit 1; }
umask 077
node_name=node-v24.22.2-linux-x64
node_sha=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75
node_root="$HOME/opt/$node_name"
if [[ ! -x "$node_root/bin/node" ]]; then
  mkdir -p "$HOME/opt"
  download=$(mktemp -d)
  trap 'rm -f "$download/node.tar.xz"; rmdir "$download" 2>/dev/null || true' EXIT
  curl --fail --location --silent --show-error "https://nodejs.org/dist/v24.22.2/$node_name.tar.xz" -o "$download/node.tar.xz"
  printf '%s  %s\n' "$node_sha" "$download/node.tar.xz" | sha256sum --check --status
  tar -xJf "$download/node.tar.xz" -C "$HOME/opt"
fi
export PATH="$node_root/bin:$PATH"
cd "$current"
expected_version=$(node -p 'require(process.argv[1]).version' "$incoming/package.json")
[[ "$expected_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
port=$(node --env-file=.env -p 'Number(process.env.PORT||3000)')
[[ "$port" =~ ^[0-9]+$ && "$port" -gt 0 && "$port" -lt 65536 ]] || exit 1
pids=$(ss -H -ltnp "( sport = :$port )" | sed -nE 's/.*pid=([0-9]+).*/\1/p' | sort -u)
for pid in $pids; do
  [[ "$(readlink -f "/proc/$pid/cwd")" == "$current" ]] || { echo "Port $port belongs to a different application; nothing stopped"; exit 1; }
  executable=$(basename "$(readlink -f "/proc/$pid/exe")")
  [[ "$executable" == node ]] || { echo 'Listener is not Node; nothing stopped'; exit 1; }
done
backup="$current/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
for file in dist scripts deploy package.json package-lock.json .env; do [[ ! -e "$file" ]] || cp -a "$file" "$backup/"; done
node --env-file=.env "$incoming/deploy/backup.mjs" --output "$backup/database" > "$backup/database-backup.log"
for pid in $pids; do kill -TERM "$pid"; done
for i in $(seq 1 50); do [[ -z "$(ss -H -ltn "( sport = :$port )")" ]] && break; sleep .2; done
[[ -z "$(ss -H -ltn "( sport = :$port )")" ]] || { echo 'Old listener did not exit; update stopped before replacing files'; exit 1; }
deps_moved=0
rollback() {
  trap - ERR
  echo "Update failed; restoring previous code and dependencies from $backup"
  if [[ -f app.pid ]]; then
    newpid=$(cat app.pid)
    if [[ "$newpid" =~ ^[0-9]+$ && "$(readlink -f "/proc/$newpid/cwd" 2>/dev/null)" == "$current" ]]; then kill -TERM "$newpid" 2>/dev/null || true; fi
  fi
  if [[ -d dist ]]; then mv dist "$backup/failed-dist"; fi
  cp -a "$backup/dist" dist
  cp "$backup/package.json" "$backup/package-lock.json" .
  cp -a "$backup/scripts/." scripts/
  if [[ "$deps_moved" == 1 ]]; then
    if [[ -d node_modules ]]; then mv node_modules "$backup/failed-node_modules"; fi
    if [[ -d "$backup/node_modules" ]]; then mv "$backup/node_modules" node_modules; fi
  fi
  nohup "$node_root/bin/node" scripts/start.mjs > app.log 2>&1 9>&- &
  echo "$!" > app.pid
  echo 'Previous application restarted. Database was retained; private backup is available for a full rollback.'
}
trap rollback ERR
# Same filesystem directory swap; .env and data are never copied from the update.
if [[ -d dist ]]; then mv dist "$backup/dist-before-swap"; fi
if [[ -d node_modules ]]; then mv node_modules "$backup/node_modules"; deps_moved=1; fi
cp -a "$incoming/dist" dist
mkdir -p scripts deploy
cp "$incoming/scripts/start.mjs" scripts/start.mjs
cp "$incoming/package.json" "$incoming/package-lock.json" .
cp -a "$incoming/deploy/." deploy/
node "$node_root/lib/node_modules/npm/bin/npm-cli.js" ci --omit=dev --ignore-scripts --registry=https://registry.npmjs.org > "$backup/install.log" 2>&1
nohup "$node_root/bin/node" scripts/start.mjs > app.log 2>&1 9>&- &
echo "$!" > app.pid
for i in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$port/api/health" > "$backup/health.json"; then
    node -e 'const f=require("fs"); if(JSON.parse(f.readFileSync(process.argv[1])).version!==process.argv[2])process.exit(1)' "$backup/health.json" "$expected_version"
    echo "Updated to $expected_version using Node $(node -v); backup: $backup; Node PID: $(cat app.pid)"
    trap - ERR
    exit 0
  fi
  sleep .2
done
echo "Startup failed. Check app.log (safe structured errors); backup remains in $backup. Do not start another copy."
rollback
exit 1
