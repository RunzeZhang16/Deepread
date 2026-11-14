#!/usr/bin/env node
// 给当前这一期没有 answers 的文章补生成（摘要 + 问题 + 答案）
// 用法：npm run enrich-all

import { getDb } from '../lib/db.mjs';
import { fetchArticle } from '../lib/extract.mjs';
import { generateBrief } from '../lib/llm.mjs';

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const db = getDb();

const rows = db
  .prepare(
    `SELECT id, url, title FROM articles
     WHERE edition = ? AND title_only = 0 AND (answers IS NULL OR answers = '')`
  )
  .all(today);

console.log(`\n需要补答案：${rows.length} 篇（${today}）\n`);

const upd = db.prepare(
  `UPDATE articles SET summary = ?, questions = ?, answers = ?, word_count = ?, enrich_error = NULL WHERE id = ?`
);

for (const r of rows) {
  try {
    const a = await fetchArticle(r.url);
    if (!a.body || a.body.trim().length < 400) {
      console.log(`  ✗ ${r.title.slice(0, 24)}（正文太短）`);
      continue;
    }
    const brief = await generateBrief({ title: a.title ?? r.title, account: a.account ?? '', body: a.body });
    if (!brief.ok) {
      console.log(`  ✗ ${r.title.slice(0, 24)}（${brief.error}）`);
      continue;
    }
    upd.run(
      brief.brief.summary,
      JSON.stringify(brief.brief.items.map((i) => i.q)),
      JSON.stringify(brief.brief.items),
      a.wordCount ?? 0,
      r.id
    );
    console.log(`  ✓ ${r.title.slice(0, 24)}  ${brief.brief.items.length} 个问题（含答案）`);
  } catch (e) {
    console.log(`  ✗ ${r.title.slice(0, 24)}（${e.message}）`);
  }
}

const left = db
  .prepare(`SELECT COUNT(*) n FROM articles WHERE edition = ? AND title_only = 0 AND answers IS NULL`)
  .get(today).n;
console.log(`\n完成，剩余未补 ${left} 篇\n`);
