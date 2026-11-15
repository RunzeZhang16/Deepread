#!/bin/bash
# 每周五 19:00 出刊：召回 → 打分 → 出刊 → 订阅邮件 → 公众号稿
LOG() { echo "[$(date '+%F %T')] $*"; }

run() {
  local name="$1"; shift
  if "$@"; then LOG "✓ $name"; else LOG "✗ $name 失败，继续"; fi
}

LOG "=== 开始（每周一期）==="
run "召回"     docker exec deepread npm run recall
run "打分"     docker exec deepread npm run rank
run "出刊"     docker exec deepread npm run edition -- 8
run "订阅邮件" docker exec deepread npm run daily-mail
run "公众号稿" docker exec deepread npm run wechat-mail
LOG "=== 完成 ==="
