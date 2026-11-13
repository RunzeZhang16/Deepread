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

const DATA = path.join(process.cwd(), 'data');
const COUNT = Number(process.argv[2] ?? 5);

/** 按北京时间判断是不是今天 */
function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const fmt = (x) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(x);
  return fmt(d) === fmt(new Date());
}

const feeds = JSON.parse(await fs.readFile(path.join(DATA, 'feeds.json'), 'utf8')).feeds ?? [];
const briefSourceIds = new Set(feeds.filter((f) => f.briefOnly === true).map((f) => f.id));

const cands = JSON.parse(await fs.readFile(path.join(DATA, 'candidates.json'), 'utf8'));
const arts = JSON.parse(await fs.readFile(path.join(DATA, 'articles.json'), 'utf8'));

const have = new Set(arts.articles.map((a) => a.url));

// 清掉旧的速览
const oldCount = arts.articles.filter((a) => a.titleOnly).length;
arts.articles = arts.articles.filter((a) => !a.titleOnly);

const pool = cands.items
  .filter((c) => briefSourceIds.has(c.sourceId))
  .filter((c) => !have.has(c.url))
  .filter((c) => typeof c.score === 'number')
  .sort((a, b) => b.score - a.score);

console.log(`\n清理旧速览 ${oldCount} 条，候选 ${pool.length} 条，逐条核对发布日期…\n`);

const today = [];
let cursor = 0;
async function worker() {
  while (cursor < pool.length && today.length < COUNT * 3) {
    const c = pool[cursor++];
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
  for (const c of picked) {
    arts.articles.push({
      url: c.url,
      status: 'meta_only',
      site: c.sourceId,
      title: cleanTitle(c.title, c.sourceName),
      account: c.sourceName,
      wordCount: 0,
      excerpt: '',
      publishedAt: c.publishedAt ?? null,
      fetchedAt: now,
      category: c.category ?? null,
      note: '仅标题',
      titleOnly: true,
      score: c.score,
    });
    const target = cands.items.find((i) => i.id === c.id);
    if (target) target.status = 'promoted';
  }
}

await fs.writeFile(path.join(DATA, 'articles.json'), JSON.stringify(arts, null, 2));
await fs.writeFile(path.join(DATA, 'candidates.json'), JSON.stringify(cands, null, 2));
console.log(`\n速览 ${picked.length} 条（今日发布）`);
