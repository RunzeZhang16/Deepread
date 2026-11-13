#!/usr/bin/env node
// 批量导入订阅源：读一个 OPML 文件（大部分 RSS 阅读器都能导出），
// 逐个测试，能用的写进 data/feeds.json。
//
// 用法：npm run import-opml -- path/to/subscriptions.opml

import fs from 'node:fs/promises';
import path from 'node:path';
import { probeFeed } from '../lib/probe.mjs';

const DB = path.join(process.cwd(), 'data', 'feeds.json');
const CATEGORY = process.argv[3] || '人文';
const MAX_AGE_DAYS = Number(process.env.IMPORT_MAX_AGE_DAYS ?? 30);

import crypto from 'node:crypto';

function idFor(url) {
  // 必须用哈希：hex 前缀对所有 https:// 地址都一样，会撞 id
  return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 10);
}

/** 从 OPML 里抠出所有 xmlUrl */
function parseOpml(xml) {
  const out = [];
  const re = /<outline\b[^>]*>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const url = /xmlUrl="([^"]+)"/i.exec(tag)?.[1];
    if (!url) continue;
    const text = /text="([^"]*)"/i.exec(tag)?.[1] ?? /title="([^"]*)"/i.exec(tag)?.[1] ?? '';
    out.push({ url: url.replace(/&amp;/g, '&').trim(), name: text.trim() });
  }
  return out;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('用法: npm run import-opml -- <文件.opml> [品类]');
    process.exit(1);
  }

  const xml = await fs.readFile(file, 'utf8');
  const entries = parseOpml(xml);
  if (entries.length === 0) {
    console.error('这个 OPML 里没有找到 xmlUrl');
    process.exit(1);
  }

  const registry = JSON.parse(await fs.readFile(DB, 'utf8'));
  const feeds = registry.feeds ?? [];
  const seen = new Set(feeds.map((f) => f.url));

  console.log(`\nOPML 里共 ${entries.length} 个源，开始逐个测试…\n`);

  const added = [];
  const failed = [];
  const stale = [];
  let cursor = 0;

  async function worker() {
    while (cursor < entries.length) {
      const e = entries[cursor++];
      if (seen.has(e.url)) {
        failed.push({ ...e, error: '已存在' });
        continue;
      }
      const p = await probeFeed(e.url);
      if (p.ok && p.latest) {
        const days = (Date.now() - Date.parse(p.latest)) / 86400000;
        if (days > MAX_AGE_DAYS) {
          stale.push({ ...e, days: Math.round(days) });
          console.log(`[SKIP] ${(e.name || '').padEnd(18, ' ').slice(0, 18)} 最后更新 ${Math.round(days)} 天前`);
          continue;
        }
      }
      if (p.ok) {
        seen.add(e.url);
        added.push({
          id: idFor(e.url),
          name: (e.name || p.title || new URL(e.url).hostname).slice(0, 20),
          category: CATEGORY,
          url: e.url,
          weight: 55,
          enabled: true,
          type: p.type,
        });
        console.log(`[ OK ] ${(e.name || '').padEnd(18, ' ').slice(0, 18)} ${p.items} 条`);
      } else {
        failed.push({ ...e, error: p.error });
        console.log(`[FAIL] ${(e.name || '').padEnd(18, ' ').slice(0, 18)} ${p.error}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker));

  await fs.writeFile(
    DB,
    JSON.stringify({ updatedAt: new Date().toISOString(), feeds: [...feeds, ...added] }, null, 2)
  );

  console.log(`\n—— 汇总 ——`);
  console.log(`可用 ${added.length} 个，停更 ${stale.length} 个，失败/重复 ${failed.length} 个`);
  if (failed.length) {
    console.log('\n没导入的：');
    for (const f of failed.slice(0, 20)) console.log(`  ${f.name || f.url} — ${f.error}`);
  }
  console.log('\n下次跑 npm run recall 就会带上这些源。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
