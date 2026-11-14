#!/usr/bin/env bash
# 每天自动跑：召回 → 打分 → 速览
# 服务器 crontab：30 6 * * * /opt/deepread/scripts/daily.sh >> /var/log/deepread.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-/etc/ssl/certs/ca-certificates.crt}"

echo "=== $(date '+%F %T') 每日任务开始 ==="

echo "--- 召回 ---"
npm run recall

echo "--- 精排 ---"
npm run rank

echo "--- 速览 ---"
npm run briefs -- 5

echo "=== $(date '+%F %T') 完成 ==="
