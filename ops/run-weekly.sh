#!/usr/bin/env bash
# 每周五 19:00：召回 → 打分 → 出刊 → 订阅邮件 → 公众号稿 → 备份
# 容器名固定为 deepread（见 docker-compose.yml）。脚本在镜像里，不单独挂载。
set -u

LOG() { echo "[$(date '+%F %T')] $*"; }

run() {
  local name="$1"
  shift
  if "$@"; then
    LOG "✓ $name"
  else
    LOG "✗ $name 失败，继续"
  fi
}

LOG "=== 开始（每周一期）==="
run "召回"     docker exec deepread npm run recall
run "打分"     docker exec deepread npm run rank
run "出刊"     docker exec deepread npm run edition -- 8
run "封面"     docker exec deepread npm run cover
run "订阅邮件" docker exec deepread npm run daily-mail
run "公众号稿" docker exec deepread npm run wechat-mail
run "备份"     bash "$(dirname "$0")/backup.sh"
LOG "=== 完成 ==="
