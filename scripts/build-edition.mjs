#!/usr/bin/env node
// 自动出刊：从候选池按分数选出今天的 8 篇，抓正文、生成摘要和问题，落库。
//
// 用法：npm run edition [-- 8]

import crypto from 'node:crypto';
import { getDb } from '../lib/db.mjs';
import { fetchArticle } from '../lib/extract.mjs';
import { generateBrief } from '../lib/llm.mjs';
import { cleanTitle } from '../lib/title.mjs';
import { findDuplicates } from '../lib/dedupe.mjs';
import { isNonArticleUrl } from '../config/feeds.mjs';
import { buildThemePlan, saveThemePlan } from '../lib/theme.mjs';

const COUNT = Number(process.argv[2] ?? 8);
const PER_SOURCE_MAX = 2;      // 同一来源最多 2 篇，保证多样性
const MIN_SCORE = 60;
const WINDOW_DAYS = 7;         // 周更：从过去 7 天的候选里挑
const FRESH_DECAY = 0.05;      // 每旧一天扣 5%，避免老高分文章长期霸榜

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const db = getDb();

function idFor(url) {
  return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 12);
}

// 先清掉今天已有的正文（可重复执行，每次都是全新一期）
const oldRows = db
  .prepare("SELECT id, url FROM articles WHERE edition = ? AND title_only = 0")
  .all(today);
if (oldRows.length) {
  const reset = db.prepare("UPDATE candidates SET status = 'new' WHERE url = ?");
  const del = db.prepare('DELETE FROM articles WHERE id = ?');
  const tx = db.transaction(() => {
    for (const r of oldRows) {
      reset.run(r.url);
      del.run(r.id);
    }
  });
  tx();
  console.log(`清理今日已有 ${oldRows.length} 篇，重新出刊`);
}

// 只从「非速览源」里选
const briefSourceIds = new Set(
  db.prepare('SELECT id FROM sources WHERE brief_only = 1').all().map((r) => r.id)
);

const pool = db
  .prepare(
    `SELECT *, (score * (1 - MIN(6, CAST(julianday('now') - julianday(fetched_at) AS INTEGER)) * ?)) AS adj
     FROM candidates
     WHERE status = 'new' AND score IS NOT NULL AND score >= ?
       AND fetched_at >= datetime('now', ?)
     ORDER BY adj DESC`
  )
  .all(FRESH_DECAY, MIN_SCORE, `-${WINDOW_DAYS} day`)
  .filter((c) => !briefSourceIds.has(c.source_id))
  .filter((c) => !isNonArticleUrl(c.url));

// 已在文章库里的跳过
const have = new Set(db.prepare('SELECT url FROM articles').all().map((r) => r.url));

// 先让模型找出同一件事的多条，只留分数最高的
const dupIds = await findDuplicates(
  pool.slice(0, 30).map((c) => ({ id: c.id, title: c.title, sourceName: c.source_name ?? '' }))
);
if (dupIds.size) console.log(`去重：合并 ${dupIds.size} 条同题报道\n`);

const picked = [];
const perSource = new Map();
for (const c of pool) {
  if (picked.length >= COUNT) break;
  if (have.has(c.url) || dupIds.has(c.id)) continue;
  const n = perSource.get(c.source_id) ?? 0;
  if (n >= PER_SOURCE_MAX) continue;
  perSource.set(c.source_id, n + 1);
  picked.push(c);
}

console.log(`\n今日出刊（${today}）：候选 ${pool.length} 条，选出 ${picked.length} 篇\n`);

const ins = db.prepare(`
  INSERT INTO articles (id, url, title, account, site, status, word_count, excerpt, summary, questions, answers, hook,
                        published_at, fetched_at, category, title_only, score, note, error, enrich_error, edition)
  VALUES (@id, @url, @title, @account, @site, @status, @wordCount, @excerpt, @summary, @questions, @answers, @hook,
          @publishedAt, @fetchedAt, @category, 0, @score, NULL, NULL, @enrichError, @edition)
  ON CONFLICT(url) DO UPDATE SET
    title=excluded.title, account=excluded.account, summary=excluded.summary,
    questions=excluded.questions, word_count=excluded.word_count, score=excluded.score,
    edition=excluded.edition, status=excluded.status, enrich_error=excluded.enrich_error
`);
const mark = db.prepare("UPDATE candidates SET status = 'promoted' WHERE id = ?");

let ok = 0;
let failed = 0;

// 失败的会跳过，继续从池子里补位
const queue = [...pool.filter((c) => !picked.includes(c))];
let list = [...picked];

for (let idx = 0; idx < list.length; idx++) {
  if (ok >= COUNT) break;
  const c = list[idx];
  const label = `${String(c.score).padStart(3)}  ${String(c.source_name).slice(0, 10)}  ${c.title.slice(0, 34)}`;
  try {
    const r = await fetchArticle(c.url);
    if (r.status !== 'full' || !r.body || r.body.trim().length < 400) {
      console.log(`  ✗ ${label}  （正文太短或抓不到）`);
      failed++;
      if (queue.length) list.push(queue.shift());
      continue;
    }

    const brief = await generateBrief({
      title: r.title ?? c.title,
      account: c.source_name ?? '',
      body: r.body,
    });

    if (!brief.ok) {
      console.log(`  ✗ ${label}  （生成失败：${brief.error}）`);
      failed++;
      if (queue.length) list.push(queue.shift());
      continue;
    }

    const items = brief.brief.items;
    const questions = items.map((i) => i.q);
    const summary = brief.brief.summary;

    ins.run({
      id: idFor(c.url),
      url: c.url,
      title: cleanTitle(r.title ?? c.title, c.source_name),
      account: c.source_name ?? null,
      site: c.site ?? null,
      status: 'full',
      wordCount: r.wordCount ?? 0,
      excerpt: r.excerpt ?? '',
      summary,
      questions: questions.length ? JSON.stringify(questions) : null,
      answers: items.length ? JSON.stringify(items) : null,
      hook: brief.brief.hook ?? null,
      publishedAt: r.publishedAt ?? null,
      fetchedAt: new Date().toISOString(),
      category: c.category ?? null,
      score: c.score,
      enrichError: null,
      edition: today,
    });
    mark.run(c.id);

    ok++;
    console.log(`  ✓ ${label}  ${r.wordCount} 字 · ${questions.length} 问`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${label}  ${e.message}`);
  }
}

// 把今天的速览也归到同一期
db.prepare("UPDATE articles SET edition = ? WHERE title_only = 1 AND edition IS NULL").run(today);

const total = db.prepare('SELECT COUNT(*) n FROM articles WHERE edition = ?').get(today).n;
// 生成这期的主题（网页/公众号/邮件共用同一份顺序）
try {
  const rows = db
    .prepare("SELECT id, title, hook FROM articles WHERE edition = ? AND title_only = 0")
    .all(today);
  if (rows.length) {
    const plan = await buildThemePlan(db, today, rows);
    saveThemePlan(db, today, plan);
    console.log(`本期主题：${plan.title}`);
  }
} catch (e) {
  console.log(`主题生成失败（不影响出刊）：${e.message}`);
}

console.log(`\n本期共 ${total} 篇（成功 ${ok}，跳过 ${failed}）`);
