# Deepread

每周 8 篇中文好文章。每篇配一段摘要、两个问题——点开问题，可以接着和 AI 聊这篇文章。

线上：http://124.220.163.131:3000（跑过 `ops/deploy.sh` 之后改为不带端口的 80）

## 它解决什么

好的长文被信息流埋掉了。Deepread 从约 300 个媒体和独立博客里自动捞出文章、打分，只留下最适合普通人读的 8 篇。

**核心不是"推荐"，是"读完还能问"。** 每篇文章的两个问题都预先生成好了答案，点开秒回；想继续追问，再调模型。

## 功能

| 功能 | 说明 |
|---|---|
| 每周一期 | 每周五晚 7 点自动出刊，8 篇长文 |
| 问题对话 | 点问题直接看答案；每篇 3 轮，可追问 |
| 往期 | `/archive` 按日期翻历史 |
| 收藏 | 存浏览器本地，14 天自动清理 |
| 邮件订阅 | 双重确认，每周五收到「第 N 期」邮件 |
| 公众号排版 | `/wechat` 一键生成可粘贴的排版稿 |

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
npm run recall     # 召回：抓源 → 候选池
npm run rank       # 打分：模型给 0–100 分
npm run edition    # 出刊：选 8 篇 → 生成摘要/钩子/问题/答案 → 本期主题
npm run daily-mail # 给订阅者发信
npm run wechat-mail# 公众号稿发到自己邮箱
npm run stats      # 看 8 个核心指标
```

每周五 19:00 由服务器 cron 串起来跑。发布、反向代理和备份见 [ops/README.md](ops/README.md)。

## 部署

服务器上仓库放在 `/opt/deepread`（数据库就在这个目录的 `data/` 里）：

```bash
cp .env.example .env    # 填密钥；SITE_URL 不要带 :3000
sudo bash ops/deploy.sh
```

公网只开放 80 和 443。应用不再映射 3000。

## 目录

```
app/         页面与 API 路由
components/  对话面板、订阅表单
lib/         业务逻辑（抓取、生成、去重、主题、发信）
scripts/     命令行任务（召回/打分/出刊/发信/统计）
db/          表结构（11 张表）
ops/         部署脚本与运维命令
docs/        产品方案与技术文档
```

## 文档

- [产品应用说明书](docs/产品应用说明书v1.0.md) —— 功能、实现原理、代码地图、部署运维
- [上线版方案](docs/上线版方案v1.0.md) —— 产品与商业模式

## 一条底线

**不存正文。** 只保留标题、摘要、问题、≤300 字摘录和原文链接。正文在内存里用完即弃。
