#!/usr/bin/env bash
# 在运行中的容器里做 SQLite 快照，可选再 rsync 到另一台机器。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d)"
DEST="/app/data/backups/deepread-${STAMP}.db"

running="$(docker inspect -f '{{.State.Running}}' deepread 2>/dev/null || true)"
if [[ "$running" != "true" ]]; then
  echo "容器 deepread 不在运行，跳过备份" >&2
  exit 1
fi

docker exec -e BACKUP_STAMP="$STAMP" deepread node scripts/backup-db.mjs

dest_line=""
if [[ -f "$ROOT/.env" ]]; then
  dest_line="$(grep -E '^BACKUP_RSYNC_DEST=' "$ROOT/.env" | tail -1 | cut -d= -f2- || true)"
  dest_line="${dest_line%\"}"
  dest_line="${dest_line#\"}"
  dest_line="${dest_line%\'}"
  dest_line="${dest_line#\'}"
fi
TARGET="${BACKUP_RSYNC_DEST:-$dest_line}"

if [[ -n "$TARGET" ]]; then
  tmp="$(mktemp -d)"
  docker cp "deepread:${DEST}" "$tmp/"
  if [[ "$TARGET" == *:* ]]; then
    # 远程目标（user@host:/path），不建本地目录
    rsync -az "$tmp/deepread-${STAMP}.db" "$TARGET/"
  else
    mkdir -p "$TARGET"
    rsync -a "$tmp/deepread-${STAMP}.db" "$TARGET/"
  fi
  rm -rf "$tmp"
  echo "备份已复制到 $TARGET"
else
  echo "备份在容器内 ${DEST}（同一块磁盘）。要拷走，在 .env 里设置 BACKUP_RSYNC_DEST。"
fi
