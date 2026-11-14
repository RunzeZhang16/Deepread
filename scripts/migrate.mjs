#!/usr/bin/env node
// 把现有的 JSON 数据导入 SQLite
//
// 用法：npm run migrate

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA, 'deepread.db');

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function idFor(url) {
  return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 12);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'));

const feeds = readJson('feeds.json', { feeds: [] }).feeds ?? [];
const cands = readJson('candidates.json', { items: [] }).items ?? [];
const arts = readJson('articles.json', { articles: [] }).articles ?? [];

let added = { sources: 0, candidates: 0, articles: 0 };

const insSource = db.prepare(`
  INSERT INTO sources (id, name, url, category, weight, enabled, type, brief_only)
  VALUES (@id, @name, @url, @category, @weight, @enabled, @type, @briefOnly)
  ON CONFLICT(url) DO UPDATE SET
    name=excluded.name, category=excluded.category, weight=excluded.weight,
    enabled=excluded.enabled, type=excluded.type, brief_only=excluded.brief_only
`);

const insCand = db.prepare(`
  INSERT INTO candidates (id, source_id, source_name, title, url, summary, category, published_at, fetched_at, score, reason, status)
  VALUES (@id, @sourceId, @sourceName, @title, @url, @summary, @category, @publishedAt, @fetchedAt, @score, @reason, @status)
  ON CONFLICT(url) DO UPDATE SET
    score=excluded.score, reason=excluded.reason, status=excluded.status, summary=excluded.summary
`);

const insArt = db.prepare(`
  INSERT INTO articles (id, url, title, account, site, status, word_count, excerpt, summary, questions,
                        published_at, fetched_at, category, title_only, score, note, error, enrich_error)
  VALUES (@id, @url, @title, @account, @site, @status, @wordCount, @excerpt, @summary, @questions,
          @publishedAt, @fetchedAt, @category, @titleOnly, @score, @note, @error, @enrichError)
  ON CONFLICT(url) DO UPDATE SET
    title=excluded.title, summary=excluded.summary, questions=excluded.questions,
    word_count=excluded.word_count, title_only=excluded.title_only, score=excluded.score
`);

const tx = db.transaction(() => {
  for (const f of feeds) {
    const r = insSource.run({
      id: f.id || idFor(f.url),
      name: f.name,
      url: f.url,
      category: f.category ?? null,
      weight: f.weight ?? 55,
      enabled: f.enabled ? 1 : 0,
      type: f.type ?? 'rss',
      briefOnly: f.briefOnly ? 1 : 0,
    });
    added.sources += r.changes;
  }
  for (const c of cands) {
    const r = insCand.run({
      id: c.id || idFor(c.url),
      sourceId: c.sourceId ?? null,
      sourceName: c.sourceName ?? null,
      title: c.title,
      url: c.url,
      summary: c.summary ?? '',
      category: c.category ?? null,
      publishedAt: c.publishedAt ?? null,
      fetchedAt: c.fetchedAt ?? null,
      score: typeof c.score === 'number' ? c.score : null,
      reason: c.reason ?? null,
      status: c.status ?? 'new',
    });
    added.candidates += r.changes;
  }
  for (const a of arts) {
    const r = insArt.run({
      id: a.id || idFor(a.url),
      url: a.url,
      title: a.title ?? '',
      account: a.account ?? null,
      site: a.site ?? null,
      status: a.status ?? 'full',
      wordCount: a.wordCount ?? 0,
      excerpt: a.excerpt ?? '',
      summary: a.summary ?? null,
      questions: a.questions ? JSON.stringify(a.questions) : null,
      publishedAt: a.publishedAt ?? null,
      fetchedAt: a.fetchedAt ?? null,
      category: a.category ?? null,
      titleOnly: a.titleOnly ? 1 : 0,
      score: typeof a.score === 'number' ? a.score : null,
      note: a.note ?? null,
      error: a.error ?? null,
      enrichError: a.enrichError ?? null,
    });
    added.articles += r.changes;
  }
});
tx();

const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
console.log('\n—— 迁移完成 ——');
console.log('数据库:', DB_PATH);
console.log(`源 ${count('sources')} · 候选 ${count('candidates')} · 文章 ${count('articles')}`);
console.log('本次写入:', added);
