# Deepread

读过的文章，多半在合上页面时就散了。做 Deepread，是想把这件事放慢一点：每期只选几篇长文，把脉络写清楚，把问题留下来。问题不是测验，而是邀请——愿意顺着它多聊几句，这次阅读才算完成。

线上：http://124.220.163.131

## 功能

| 功能 | 说明 |
|---|---|
| 每周一期 | 每周五晚 7 点自动出刊 |
| 问题对话 | 点问题直接看答案，可追问 |
| 往期 | 按日期翻历史 |
| 收藏 | 存浏览器本地，14 天自动清理 |
| 邮件订阅 | 双重确认，每周五收到「第 N 期」邮件 |

## 技术栈

Next.js 15（App Router）+ React 19 + TypeScript · SQLite（better-sqlite3）· DeepSeek `deepseek-flash` · nodemailer · Docker

## 本地运行

```bash
npm install
cp .env.example .env.local   # 填入 DEEPSEEK_API_KEY
npm run dev                  # http://localhost:3000
```

数据库在 `data/deepread.db`，首次启动自动建表。

## 内容流水线

```bash
npm run recall        # 召回：抓源 → 候选池
npm run rank          # 打分：模型给 0–100 分
npm run edition       # 出刊：选 8 篇 → 生成摘要/钩子/问题/答案 → 本期主题
npm run daily-mail    # 给订阅者发信
npm run wechat-mail   # 公众号稿发到自己邮箱
npm run stats         # 看 8 个核心指标
```

每周五 19:00 由服务器 cron 串起来跑。发布、反向代理和备份见 [ops/README.md](ops/README.md)。

## 部署

服务器上仓库放在 `/opt/deepread`，数据在 `/opt/deepread/data/deepread.db`：

```bash
cd /opt/deepread
sudo bash ops/deploy.sh     # git pull → 构建 → 切换 compose
```

docker compose 同时起应用和 nginx；公网只走 80/443，应用不映射端口。
数据库备份：`sudo bash ops/backup.sh`（每周五出刊后自动执行，保留 8 份）。

## 目录

```
app/         页面与 API 路由
components/  对话面板、订阅表单
lib/         业务逻辑（抓取、生成、去重、主题、发信）
scripts/     命令行任务（召回/打分/出刊/发信/统计）
db/          表结构（11 张表）
ops/         部署脚本与运维命令
```

## 官方托管

https://xdeepread.com

## 许可

本项目采用 **AGPL-3.0**：可以自由使用、修改、分发，包括商业用途；
但如果修改后作为网络服务对外提供，修改后的代码也必须同样开源。

完整条款见 [LICENSE](LICENSE)。

「Deepread」名称、标识与品牌视觉**不在代码许可范围内**，未经许可不得用于衍生产品的命名或推广。