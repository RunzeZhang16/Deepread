#!/usr/bin/env bash
# 服务器上唯一的发布入口：拉代码、构建、换成 compose。
# 构建完成前不替换正在服务的旧容器。
set -euo pipefail

SKIP_PULL=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) SKIP_PULL=1 ;;
  esac
done

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if ! docker compose version >/dev/null 2>&1; then
  echo "缺少 docker compose 插件。Debian/Ubuntu 上执行：" >&2
  echo "  sudo apt-get install -y docker-compose-v2" >&2
  echo "装不上就手动放二进制到 /usr/local/lib/docker/cli-plugins/docker-compose" >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "当前目录不是 git 仓库。把仓库放在 /opt/deepread 后再运行。" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "缺少 .env。先执行：cp .env.example .env，再填入密钥和 SITE_URL。" >&2
  exit 1
fi

if [[ ! -f data/deepread.db && ! -f "${DATA_DIR:-}/deepread.db" ]]; then
  echo "提示: 当前目录没有 data/deepread.db。"
  echo "线上库如果在 /opt/deepread/data，请在这个目录运行，或 export DATA_DIR=/opt/deepread/data"
fi

ensure_swap() {
  [[ "$(uname -s)" == "Linux" ]] || return 0
  [[ -r /proc/meminfo ]] || return 0
  if swapon --show --noheadings 2>/dev/null | grep -q .; then
    return 0
  fi
  local mem_kb
  mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
  if (( mem_kb > 3500000 )); then
    return 0
  fi
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "内存约 $((mem_kb / 1024))MB，且没有 swap。构建可能被杀掉。请用 sudo bash ops/deploy.sh" >&2
    return 0
  fi
  echo "添加 2G swap：/swapfile"
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile || true
  if [[ -f /etc/fstab ]] && ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
}

port_blocked() {
  local port="$1"
  if ! command -v ss >/dev/null 2>&1; then
    return 1
  fi
  ss -ltn | awk '{print $4}' | grep -Eq "(:${port})$" || return 1
  local names
  names="$(docker ps --filter "publish=${port}" --format '{{.Names}}' 2>/dev/null || true)"
  if [[ -z "$names" ]]; then
    return 0
  fi
  if grep -qv '^deepread-nginx$' <<<"$names"; then
    return 0
  fi
  return 1
}

if port_blocked 80 || port_blocked 443; then
  echo "80 或 443 被占用。如果是宿主机 nginx：sudo systemctl disable --now nginx" >&2
  exit 1
fi

ensure_swap

# sudo 运行时用仓库主人的身份拉代码，避免 root 触发 git 的目录所有权检查。
# --no-pull：服务器连不上 GitHub 时跳过拉取（文件需自行同步，见 ops/README.md）。
if [[ "$SKIP_PULL" == "1" ]]; then
  echo "跳过 git pull（--no-pull）"
elif [[ "$(id -u)" -eq 0 && -d .git ]]; then
  owner="$(stat -c '%U' .git 2>/dev/null || true)"
  if [[ -n "$owner" && "$owner" != "root" ]]; then
    sudo -u "$owner" git pull --ff-only
  else
    git pull --ff-only
  fi
else
  git pull --ff-only
fi

mkdir -p ops/certs ops/certbot data
if [[ -f ops/certs/fullchain.pem && -f ops/certs/privkey.pem ]]; then
  cp ops/nginx.https.conf ops/nginx.active.conf
  echo "检测到证书，启用 HTTPS"
else
  cp ops/nginx.conf ops/nginx.active.conf
  echo "未发现 ops/certs 下的证书，先用 HTTP（80 端口）"
fi

remove_foreign() {
  local name="$1"
  if ! docker inspect "$name" >/dev/null 2>&1; then
    return 0
  fi
  local project
  project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$name" 2>/dev/null || true)"
  if [[ "$project" != "deepread" ]]; then
    echo "替换手工启动的容器 ${name}（数据库卷保留）"
    docker rm -f "$name"
  fi
}

docker compose build

# 构建完成后再停旧容器，避免 Next 编译的那几分钟站点不可用。
remove_foreign deepread
remove_foreign deepread-nginx
if docker inspect deepread-app >/dev/null 2>&1; then
  echo "停掉旧容器 deepread-app（数据库卷保留）"
  docker rm -f deepread-app
fi

if ! docker compose up -d --no-build --remove-orphans; then
  docker compose logs --tail 80
  exit 1
fi
docker compose ps

cat <<EOF

站点应能通过 http://服务器IP 打开（不再使用 :3000）。
请到腾讯云安全组关掉 3000，只留 22、80、443。

crontab 改为：
0 19 * * 5 ${ROOT}/ops/run-weekly.sh >> /var/log/deepread.log 2>&1

确认 .env 里 SITE_URL 不带 :3000。备案和证书的步骤见 ops/README.md。
EOF
