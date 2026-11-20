#!/usr/bin/env node
// 从当期换掉一篇文章：删掉它，从候选池补一篇（抓正文 + 生成摘要/问题/答案）
// 用法：node scripts/replace-article.mjs <文章URL或id> [--no-backfill]

import crypto from 'node:crypto';
import { getDb } from '../lib/db.mjs';
import { fetchArticle } from '../lib/extract.mjs';
import { generateBrief } from '../lib/llm.mjs';
import { cleanTitle } from '../lib/title.mjs';
import { buildThemePlan, saveThemePlan } from '../lib/theme.mjs';
import { isNonArticleUrl } from '../config/feeds.mjs';

const target = process.argv[2];
const noBackfill = process.argv.includes('--no-backfill');
if (!target) {
  console.error('用法：node scripts/replace-article.mjs <文章URL或id> [--no-backfill]');
  process.exit(1);
}

const db = getDb();
const edition = db
  .prepare("SELECT MAX(edition) e FROM articles WHERE edition IS NOT NULL AND edition <> '0000-00-00'")
  .get().e;

const row = db
  .prepare('SELECT id, url, title FROM articles WHERE (id = ? OR url = ?) AND edition = ?')
  .get(target, target, edition);
if (!row) {
  console.error(`当期（${edition}）里没找到：${target}`);
  process.exit(1);
}

console.log(`当期 ${edition} · 移除：${row.title.slice(0, 30)}`);
db.prepare('DELETE FROM articles WHERE id = ?').run(row.id);
db.prepare("UPDATE candidates SET status = 'discarded' WHERE url = ?").run(row.url);

if (noBackfill) {
  console.log('已移除，不补位。');
  process.exit(0);
}

const briefIds = new Set(db.prepare('SELECT id FROM sources WHERE brief_only = 1').all().map((r) => r.id));
const used = new Set(db.prepare('SELECT url FROM articles').all().map((r) => r.url));

const pool = db
  .prepare(
    `SELECT * FROM candidates
     WHERE status = 'new' AND score IS NOT NULL AND score >= 60
     ORDER BY score DESC`
  )
  .all()
  .filter((c) => !briefIds.has(c.source_id))
  .filter((c) => !used.has(c.url))
  .filter((c) => !isNonArticleUrl(c.url));

console.log(`候选池可用：${pool.length} 条`);

let added = null;
for (const c of pool.slice(0, 12)) {
  try {
    const a = await fetchArticle(c.url);
    if (!a.body || a.body.trim().length < 400) {
      console.log(`  ✗ ${c.title.slice(0, 24)}（正文太短）`);
      continue;
    }
    const brief = await generateBrief({
      title: a.title ?? c.title,
      account: c.source_name ?? '',
      body: a.body,
    });
    if (!brief.ok) {
      console.log(`  ✗ ${c.title.slice(0, 24)}（${brief.error}）`);
      continue;
    }
    const id = crypto.createHash('sha1').update(String(c.url)).digest('hex').slice(0, 12);
    db.prepare(
      `INSERT INTO articles (id, url, title, account, site, status, word_count, excerpt, summary, questions, answers, hook,
                            published_at, fetched_at, category, title_only, score, note, error, enrich_error, edition)
       VALUES (?, ?, ?, ?, ?, 'full', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL, ?)`
    ).run(
      id,
      c.url,
      cleanTitle(a.title ?? c.title, c.source_name ?? ''),
      c.source_name ?? '',
      a.site ?? '',
      a.wordCount ?? 0,
      a.excerpt ?? '',
      brief.brief.summary,
      JSON.stringify(brief.brief.items.map((i) => i.q)),
      JSON.stringify(brief.brief.items),
      brief.brief.hook ?? null,
      a.publishedAt ?? null,
      new Date().toISOString(),
      c.category ?? null,
      c.score ?? null,
      edition
    );
    db.prepare("UPDATE candidates SET status = 'promoted' WHERE id = ?").run(c.id);
    added = { title: a.title ?? c.title, account: c.source_name, words: a.wordCount };
    console.log(`  ✓ 补入：${added.account} · ${added.title.slice(0, 28)}（${added.words} 字）`);
    break;
  } catch (e) {
    console.log(`  ✗ ${c.title.slice(0, 24)}（${e.message}）`);
  }
}

if (!added) {
  console.error('补位失败，当期少一篇。');
  process.exit(2);
}

// 重新生成主题顺序
const rows = db
  .prepare("SELECT id, title, hook FROM articles WHERE edition = ? AND title_only = 0")
  .all(edition);
const plan = await buildThemePlan(db, edition, rows);
saveThemePlan(db, edition, plan);

console.log(`\n当期现有 ${rows.length} 篇；主题：${plan.title}`);
