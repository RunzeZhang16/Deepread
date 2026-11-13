#!/usr/bin/env node
// 粘贴链接 → 抓取 → 落库（只存元数据 + 300 字摘录）
//
// 用法：
//   npm run fetch -- https://mp.weixin.qq.com/s/xxxx
//   npm run fetch -- https://a.com/1 https://b.com/2
//   npm run fetch -- --file data/urls.txt

import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchArticle, detectSite, toStored } from '../lib/extract.mjs';

const DATA = path.join(process.cwd(), 'data');
const DB = path.join(DATA, 'articles.json');

function parseArgs(argv) {
  const urls = [];
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' || a === '-f') file = argv[++i];
    else if (a.startsWith('--file=')) file = a.slice(7);
    else if (!a.startsWith('-')) urls.push(a);
  }
  return { urls, file };
}

async function loadDb() {
  try {
    const raw = JSON.parse(await fs.readFile(DB, 'utf8'));
    return Array.isArray(raw.articles) ? raw : { articles: [] };
  } catch {
    return { articles: [] };
  }
}

function labelStatus(a) {
  if (a.status === 'full') return '✓ 全文';
  if (a.status === 'meta_only') return '◐ 仅标题';
  return '✗ 失败';
}

async function main() {
  const { urls: argUrls, file } = parseArgs(process.argv.slice(2));

  let urls = argUrls;
  if (file) {
    const text = await fs.readFile(file, 'utf8');
    urls = urls.concat(
      text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    );
  }

  urls = [...new Set(urls)];
  if (urls.length === 0) {
    console.error('用法: npm run fetch -- <url> [<url> ...]   或   --file data/urls.txt');
    process.exit(1);
  }

  await fs.mkdir(DATA, { recursive: true });
  const db = await loadDb();
  const byUrl = new Map(db.articles.map((a) => [a.url, a]));

  const results = [];
  for (const url of urls) {
    const site = detectSite(url);
    process.stdout.write(`抓取 ${site} … `);
    try {
      const article = await fetchArticle(url);
      byUrl.set(url, toStored(article));
      results.push(article);
      console.log(`${labelStatus(article)}  ${article.wordCount} 字  ${article.ms}ms`);
    } catch (e) {
      const failed = {
        url,
        site,
        status: 'failed',
        title: '',
        account: '',
        wordCount: 0,
        excerpt: '',
        publishedAt: null,
        error: e.status ? `HTTP ${e.status}` : e.message,
        fetchedAt: new Date().toISOString(),
      };
      byUrl.set(url, failed);
      results.push(failed);
      console.log(`✗ 失败  ${failed.error}`);
    }
  }

  const articles = [...byUrl.values()].sort(
    (a, b) => Date.parse(b.fetchedAt ?? 0) - Date.parse(a.fetchedAt ?? 0)
  );
  await fs.writeFile(DB, JSON.stringify({ updatedAt: new Date().toISOString(), articles }, null, 2));

  console.log('\n—— 结果 ——');
  results.forEach((a, i) => {
    console.log(`\n${i + 1}. [${a.status}] ${a.title || '（无标题）'}`);
    console.log(`   ${a.account || '未知账号'}  ·  ${a.wordCount} 字  ·  ${a.publishedAt?.slice(0, 10) ?? '无日期'}`);
    if (a.excerpt) console.log(`   ${a.excerpt.slice(0, 80)}…`);
    if (a.note) console.log(`   备注：${a.note}`);
    if (a.error) console.log(`   错误：${a.error}`);
  });

  const full = results.filter((a) => a.status === 'full').length;
  console.log(`\n成功全文 ${full} / 仅标题 ${results.filter((a) => a.status === 'meta_only').length} / 失败 ${results.filter((a) => a.status === 'failed').length}`);
  console.log(`已写入 ${path.relative(process.cwd(), DB)}（共 ${articles.length} 条）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
