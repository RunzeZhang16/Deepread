# Deepread

每天 5 篇中文好文章，每篇给一个问题，带着问题去读。

当前进度：**W1 完成** —— 粘贴框 + 抓取 + 列表 + 手动分类。
摘要和「带着问题读」在 W2。

## 运行

```bash
npm install
npm run dev          # http://localhost:3000
```

生产模式：

```bash
npm run build && npm start
```

## 怎么用

1. 打开首页，在粘贴框里贴一条链接（公众号、博客、媒体文章都行）
2. 等 1–2 秒，卡片出现
3. 在卡片左上角选分类（科技 / 历史 / 经济 / 文艺 / 其他）
4. 点标题或「去读原文」跳原文

## 命令行（批量）

```bash
npm run fetch -- https://mp.weixin.qq.com/s/xxxx
npm run fetch -- --file data/urls.txt
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/articles` | 列表 |
| POST | `/api/articles` | `{ "url": "..." }` 抓取并新增 |
| PATCH | `/api/articles/{id}` | `{ "category": "科技" }` 改分类 |
| DELETE | `/api/articles/{id}` | 移除 |

## 目录

```
app/
  page.tsx                     首页：粘贴框 + 卡片列表
  api/articles/route.ts        GET 列表 / POST 新增
  api/articles/[id]/route.ts   PATCH 改分类 / DELETE 移除
lib/
  extract.mjs                  正文提取（公众号分支 + Readability + 噪音过滤）
  store.ts                     JSON 存储层（W2 换 Postgres 时只改这里）
scripts/
  fetch.mjs                    命令行抓取
data/
  articles.json                数据（自动生成）
docs/
  Deepread产品方案v1.0.md
  Deepread产品方案v1.1.md
```

## 两条硬约束

1. **不存正文**：只存标题、300 字摘录、元数据。正文用完即弃。
2. **分类要手动**：W1 不做自动分类，五选一，你说了算。
