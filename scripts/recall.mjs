#!/usr/bin/env node
// 召回：抓所有源 → 规范化 → 去重 → 写入候选池
//
// 用法：npm run recall

import path from 'node:path';
import crypto from 'node:crypto';
import Parser from 'rss-parser';
import { titleBlocklist, MAX_AGE_DAYS, isBlockedSource, isNonArticleUrl } from '../config/feeds.mjs';
import { extractArticles, fetchHtml } from '../lib/listpage.mjs';
import { getDb } from '../lib/db.mjs';

const db = getDb();
const PER_FEED_LIMIT = 20;

const parser = new Parser({ timeout: 15000 });

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function stripHtml(s = '') {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function idFor(url) {
  return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 12);
}

/** 去掉 utm 等追踪参数，用于判定"同一个链接" */
function canonicalUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|spm|from|share|ref|source)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return s;
  }
}

/** 标题归一化：去标点空格，用来判重 */
function titleKey(t) {
  return t
    .replace(/[\s\u3000]/g, '')
    .replace(/[|｜\-—–_.,，。!！?？:：;；"'“”‘’（）()【】\[\]]/g, '')
    .toLowerCase();
}

function blocked(title) {
  return titleBlocklist.some((w) => title.includes(w));
}

async function fetchFeed(feed) {
  const started = Date.now();
  const res = await fetch(feed.url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const parsed = await parser.parseString(xml);
  const items = (parsed.items ?? []).slice(0, PER_FEED_LIMIT);

  return {
    feed,
    ms: Date.now() - started,
    items: items
      .map((it) => ({
        title: stripHtml(it.title ?? ''),
        url: canonicalUrl(it.link ?? ''),
        summary: (() => {
          const raw = stripHtml(it.contentSnippet ?? it.content ?? it.summary ?? '');
          return /^(点击查看原文|阅读原文|查看原文)[>＞]?$/.test(raw) ? '' : raw.slice(0, 160);
        })(),
        publishedAt: (() => {
          const d = new Date(it.isoDate ?? it.pubDate ?? '');
          return Number.isNaN(d.getTime()) ? null : d.toISOString();
        })(),
      }))
      .filter((it) => it.title && typeof it.url === 'string' && /^https?:\/\//.test(it.url)),
  };
}

/** 列表页源：抓栏目页，把文章标题和链接捞出来（没有发布时间） */
async function fetchList(feed) {
  const started = Date.now();
  const html = await fetchHtml(feed.url);
  const links = extractArticles(html, feed.url);
  if (links.length === 0) throw new Error('页面里没找到文章链接');

  return {
    feed,
    ms: Date.now() - started,
    items: links.slice(0, 40).map((l) => ({
      title: l.title,
      url: canonicalUrl(l.url),
      summary: '',
      publishedAt: null,
    })),
  };
}

async function main() {
  const registry = { feeds: db.prepare('SELECT id, name, url, category, weight, enabled, type, brief_only FROM sources').all() };
  const active = [];
  for (const raw of registry.feeds ?? []) {
    const f = { ...raw, briefOnly: !!raw.brief_only, enabled: !!raw.enabled };
    if (!f.enabled) continue;
    const why = isBlockedSource(f);
    if (why) {
      console.log(`[SKIP] ${f.name} — ${why}`);
      continue;
    }
    active.push(f);
  }
  console.log(`\n召回 ${active.length} 个源…\n`);

  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < active.length) {
      const feed = active[cursor++];
      try {
        const r = feed.type === 'html' ? await fetchList(feed) : await fetchFeed(feed);
        results.push({ ok: true, ...r });
        console.log(`[ OK ] ${feed.name.padEnd(10, ' ')} ${String(r.items.length).padStart(3)} 条  ${r.ms}ms`);
      } catch (e) {
        results.push({ ok: false, feed, ms: 0, items: [], error: e.message });
        console.log(`[FAIL] ${feed.name.padEnd(10, ' ')}  ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));

  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  const seenUrl = new Set();
  const seenTitle = new Set();
  const items = [];
  let droppedBlocked = 0;
  let droppedOld = 0;
  let droppedDup = 0;

  for (const r of results) {
    if (!r.ok) continue;
    // 按源权重排，保证重复条目归到权重高的源
    const feed = r.feed;
    for (const it of r.items) {
      if (blocked(it.title) || isNonArticleUrl(it.url)) {
        droppedBlocked++;
        continue;
      }
      if (it.publishedAt && Date.parse(it.publishedAt) < cutoff) {
        droppedOld++;
        continue;
      }
      const tk = titleKey(it.title);
      if (seenUrl.has(it.url) || seenTitle.has(tk)) {
        droppedDup++;
        continue;
      }
      seenUrl.add(it.url);
      seenTitle.add(tk);

      const id = idFor(it.url);
      const old = db.prepare('SELECT status, score, reason FROM candidates WHERE id = ?').get(id);
      items.push({
        id,
        sourceId: feed.id,
        sourceName: feed.name,
        category: feed.category,
        weight: feed.weight,
        title: it.title,
        url: it.url,
        summary: it.summary,
        publishedAt: it.publishedAt,
        fetchedAt: new Date().toISOString(),
        status: old?.status ?? 'new',
        // 分数跟着条目走，重新召回不用重新花钱打分
        ...(typeof old?.score === 'number' ? { score: old.score, reason: old.reason } : {}),
      });
    }
  }

  // 每个源按时间排好，然后轮转取，避免 IT之家这种高频源把首页刷满
  const queues = new Map();
  for (const it of items) {
    if (!queues.has(it.sourceId)) queues.set(it.sourceId, []);
    queues.get(it.sourceId).push(it);
  }
  for (const q of queues.values()) {
    q.sort((a, b) => Date.parse(b.publishedAt ?? 0) - Date.parse(a.publishedAt ?? 0));
  }
  const order = [...queues.keys()].sort(
    (a, b) => (queues.get(b)[0]?.weight ?? 0) - (queues.get(a)[0]?.weight ?? 0)
  );
  const mixed = [];
  for (let round = 0; ; round++) {
    let added = false;
    for (const id of order) {
      const q = queues.get(id);
      if (round < q.length) {
        mixed.push(q[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  items.length = 0;
  items.push(...mixed);

  const stats = {
    updatedAt: new Date().toISOString(),
    total: items.length,
    dropped: { blocked: droppedBlocked, tooOld: droppedOld, duplicate: droppedDup },
    sources: results.map((r) => ({
      id: r.feed.id,
      name: r.feed.name,
      ok: r.ok,
      count: r.ok ? r.items.length : 0,
      ms: r.ms,
      error: r.ok ? null : r.error,
    })),
  };

  const upsert = db.prepare(`
    INSERT INTO candidates (id, source_id, source_name, title, url, summary, category, published_at, fetched_at, score, reason, status)
    VALUES (@id, @sourceId, @sourceName, @title, @url, @summary, @category, @publishedAt, @fetchedAt, @score, @reason, @status)
    ON CONFLICT(url) DO UPDATE SET
      score=excluded.score, reason=excluded.reason, status=excluded.status,
      summary=excluded.summary, fetched_at=excluded.fetched_at, published_at=excluded.published_at,
      source_name=excluded.source_name, category=excluded.category
  `);
  const seenIds = new Set();
  const tx = db.transaction(() => {
    for (const it of items) {
      seenIds.add(it.id);
      upsert.run({
        id: it.id,
        sourceId: it.sourceId ?? null,
        sourceName: it.sourceName ?? null,
        title: it.title,
        url: it.url,
        summary: it.summary ?? '',
        category: it.category ?? null,
        publishedAt: it.publishedAt ?? null,
        fetchedAt: it.fetchedAt,
        score: typeof it.score === 'number' ? it.score : null,
        reason: it.reason ?? null,
        status: it.status ?? 'new',
      });
    }
    // 清掉这一轮没出现、且还没处理的旧候选（超过 30 天）
    db.prepare(`DELETE FROM candidates
                WHERE status = 'new' AND score IS NULL
                  AND fetched_at < datetime('now', '-30 day')`).run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('recall_stats', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(stats));
  });
  tx();

  const bySource = {};
  for (const it of items) bySource[it.sourceName] = (bySource[it.sourceName] ?? 0) + 1;

  console.log('\n—— 汇总 ——');
  console.log(
    `入库 ${items.length} 条 | 挡掉：关键词 ${droppedBlocked}、过期 ${droppedOld}、重复 ${droppedDup}`
  );
  console.log('按来源：', bySource);
  console.log(`\n写入数据库（${items.length} 条）\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
