#!/usr/bin/env node
// 自动填充「今日速览」：
//  1. 只从 briefOnly 源里挑（目前是界面新闻）
//  2. 逐条抓页面拿发布时间，只留当天的
//  3. 只存标题和链接，不生成摘要、不调模型
//
// 用法：npm run briefs [-- 5]

import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanTitle } from '../lib/title.mjs';
import { fetchArticle } from '../lib/extract.mjs';
import { getDb } from '../lib/db.mjs';
import { findDuplicates } from '../lib/dedupe.mjs';

const COUNT = Number(process.argv[2] ?? 5);
const db = getDb();

/** 按北京时间判断是不是今天 */
function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const fmt = (x) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(x);
  return fmt(d) === fmt(new Date());
}

const briefSourceIds = new Set(
  db.prepare('SELECT id FROM sources WHERE brief_only = 1').all().map((r) => r.id)
);
const have = new Set(db.prepare('SELECT url FROM articles').all().map((r) => r.url));

// 清掉旧的速览
const oldCount = db.prepare('SELECT COUNT(*) n FROM articles WHERE title_only = 1').get().n;
db.prepare('DELETE FROM articles WHERE title_only = 1').run();

const pool = db
  .prepare(`SELECT * FROM candidates WHERE status != 'discarded' AND score IS NOT NULL ORDER BY score DESC`)
  .all()
  .map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    sourceName: r.source_name,
    title: r.title,
    url: r.url,
    score: r.score,
    category: r.category,
    publishedAt: r.published_at,
  }))
  .filter((c) => briefSourceIds.has(c.sourceId))
  .filter((c) => !have.has(c.url));

console.log(`\n清理旧速览 ${oldCount} 条，候选 ${pool.length} 条，逐条核对发布日期…\n`);

const dupIds = await findDuplicates(
  pool.slice(0, 25).map((c) => ({ id: c.id, title: c.title, sourceName: c.sourceName ?? '' }))
);
if (dupIds.size) console.log(`速览去重：合并 ${dupIds.size} 条同题\n`);

const today = [];
let cursor = 0;
async function worker() {
  while (cursor < pool.length && today.length < COUNT * 3) {
    const c = pool[cursor++];
    if (dupIds.has(c.id)) continue;
    try {
      const r = await fetchArticle(c.url);
      const date = r.publishedAt ?? null;
      if (isToday(date)) {
        today.push({ ...c, publishedAt: date });
        console.log(`[今天] ${(date ?? '').slice(0, 10)}  ${c.title.slice(0, 34)}`);
      }
    } catch {
      /* 抓不到就跳过 */
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

today.sort((a, b) => b.score - a.score);
const picked = today.slice(0, COUNT);

if (picked.length === 0) {
  console.log('\n⚠ 今天没有找到当日发布的条目');
} else {
  const now = new Date().toISOString();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const ins = db.prepare(`
    INSERT INTO articles (id, url, title, account, site, status, word_count, excerpt, summary, questions,
                          published_at, fetched_at, category, title_only, score, note, edition)
    VALUES (@id, @url, @title, @account, @site, 'meta_only', 0, '', NULL, NULL,
            @publishedAt, @fetchedAt, @category, 1, @score, '仅标题', @edition)
    ON CONFLICT(url) DO NOTHING
  `);
  const mark = db.prepare("UPDATE candidates SET status = 'promoted' WHERE id = ?");
  const crypto = await import('node:crypto');
  const idFor = (u) => crypto.createHash('sha1').update(u).digest('hex').slice(0, 12);

  const tx = db.transaction(() => {
    for (const c of picked) {
      ins.run({
        id: idFor(c.url),
        url: c.url,
        title: cleanTitle(c.title, c.sourceName),
        account: c.sourceName,
        site: c.sourceId,
        publishedAt: c.publishedAt ?? null,
        fetchedAt: now,
        category: c.category ?? null,
        score: c.score,
        edition: today,
      });
      mark.run(c.id);
    }
  });
  tx();
}
console.log(`\n速览 ${picked.length} 条（今日发布）`);
