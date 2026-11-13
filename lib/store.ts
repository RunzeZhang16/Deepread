import fs from 'node:fs';
import path from 'node:path';
import { fetchArticle, toStored } from './extract.mjs';
import { generateBrief, hasLLM } from './llm';
import { cleanTitle } from './title.mjs';

export type Status = 'full' | 'meta_only' | 'failed';

export const CATEGORIES = ['科技', '历史', '经济', '文艺', '其他'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Article {
  id: string;
  url: string;
  status: Status;
  site?: string;
  title: string;
  account?: string;
  wordCount: number;
  excerpt?: string;
  publishedAt?: string | null;
  fetchedAt: string;
  category?: Category | null;
  note?: string;
  error?: string;

  /** 精排分数，从召回池收录时带过来 */
  score?: number;
  /** 导读（W2）
  /** 只收标题：不生成摘要和问题，正文只用来数个数 */
  titleOnly?: boolean;
  summary?: string;
  questions?: string[];
  /** @deprecated 旧字段，只用于读老数据 */
  question?: string;
  enrichedAt?: string;
  enrichError?: string;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB = path.join(DATA_DIR, 'articles.json');

/** 由 URL 派生稳定的短 id，不需要额外存字段 */
export function idFor(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

interface DbFile {
  updatedAt?: string;
  articles: Omit<Article, 'id'>[];
}

function readDb(): DbFile {
  try {
    const raw = JSON.parse(fs.readFileSync(DB, 'utf8'));
    return { updatedAt: raw.updatedAt, articles: Array.isArray(raw.articles) ? raw.articles : [] };
  } catch {
    return { articles: [] };
  }
}

function writeDb(articles: Omit<Article, 'id'>[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // 清掉历史遗留字段（hook 已废弃）
  const clean = articles.map((a) => {
    const copy = { ...a } as Record<string, unknown>;
    delete copy.hook;
    return copy as unknown as Omit<Article, 'id'>;
  });
  fs.writeFileSync(DB, JSON.stringify({ updatedAt: new Date().toISOString(), articles: clean }, null, 2));
}

export function listArticles(): Article[] {
  const db = readDb();
  return db.articles
    .map((a) => ({
      ...a,
      id: idFor(a.url),
      category: a.category ?? null,
      questions: a.questions ?? (a.question ? [a.question] : undefined),
    }))
    .sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt));
}

export function findArticle(id: string): Article | undefined {
  return listArticles().find((a) => a.id === id);
}

/** 抓正文 → 生成导读 → 只把元数据和导读落库（正文丢弃） */
async function buildRecord(
  url: string,
  opts: { titleOnly?: boolean; account?: string; score?: number } = {}
): Promise<{ record: Omit<Article, 'id'>; error?: string }> {
  const fetched = (await fetchArticle(url)) as Record<string, unknown> & {
    body?: string;
    status: Status;
    title: string;
    account?: string;
    wordCount: number;
    note?: string;
  };

  const base = toStored(fetched) as Omit<Article, 'id'>;
  // 用调用方给的来源名（来自源注册表），比从页面里猜的准
  if (opts.account) {
    base.account = opts.account;
    base.title = cleanTitle(base.title, opts.account);
  }
  if (typeof opts.score === 'number') base.score = opts.score;

  if (fetched.status !== 'full') {
    return { record: base };
  }

  // 只收标题：正文抓到了也只用来算字数，不调模型
  if (opts.titleOnly) {
    return { record: { ...base, titleOnly: true } };
  }

  if (!hasLLM()) {
    return { record: { ...base, enrichError: '没有配置 DEEPSEEK_API_KEY' } };
  }

  const result = await generateBrief({
    title: fetched.title,
    account: fetched.account ?? '',
    body: fetched.body ?? '',
  });

  if (!result.ok) {
    return { record: { ...base, enrichError: result.error }, error: result.error };
  }

  return {
    record: {
      ...base,
      summary: result.brief.summary,
      questions: result.brief.questions,
      enrichedAt: new Date().toISOString(),
    },
  };
}

export interface AddResult {
  ok: boolean;
  article?: Article;
  reason?: 'duplicate' | 'invalid_url' | 'fetch_failed';
  message?: string;
  enrichError?: string;
}

export async function addArticle(
  rawUrl: string,
  opts: { titleOnly?: boolean; account?: string; score?: number } = {}
): Promise<AddResult> {
  const url = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid_url', message: '这不是一个合法链接' };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { ok: false, reason: 'invalid_url', message: '只支持 http / https 链接' };
  }

  const db = readDb();
  const existing = db.articles.find((a) => a.url === url);
  if (existing) {
    return {
      ok: true,
      reason: 'duplicate',
      article: { ...existing, id: idFor(url), category: existing.category ?? null },
      message: '这条已经在列表里了',
    };
  }

  let built: Awaited<ReturnType<typeof buildRecord>>;
  try {
    built = await buildRecord(url, opts);
  } catch (e) {
    return {
      ok: false,
      reason: 'fetch_failed',
      message: e instanceof Error ? `抓取失败：${e.message}` : '抓取失败',
    };
  }

  writeDb([built.record, ...db.articles]);
  return {
    ok: true,
    article: { ...built.record, id: idFor(url), category: null },
    enrichError: built.error,
  };
}

/** 给已有文章补/重生成导读（会重新抓一次正文） */
export async function enrichArticle(
  id: string
): Promise<{ ok: boolean; article?: Article; error?: string }> {
  const db = readDb();
  const idx = db.articles.findIndex((a) => idFor(a.url) === id);
  if (idx === -1) return { ok: false, error: '没找到这条' };

  const rec = db.articles[idx];
  if (rec.status !== 'full') return { ok: false, error: '这条没有正文，生成不了' };
  if (!hasLLM()) return { ok: false, error: '没有配置 DEEPSEEK_API_KEY' };

  let fetched: { body?: string; title?: string; account?: string; status?: string };
  try {
    fetched = (await fetchArticle(rec.url)) as typeof fetched;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `重新抓取失败：${e.message}` : '重新抓取失败' };
  }

  if (!fetched.body) return { ok: false, error: '这次没抓到正文，稍后再试' };

  const result = await generateBrief({
    title: fetched.title ?? rec.title,
    account: fetched.account ?? rec.account ?? '',
    body: fetched.body,
  });

  if (!result.ok) {
    db.articles[idx] = { ...rec, enrichError: result.error };
    writeDb(db.articles);
    return { ok: false, error: result.error };
  }

  // 老字段（hook / question）顺手清掉，避免脏数据
  const { question: _legacyQuestion, ...rest } = rec;
  db.articles[idx] = {
    ...rest,
    titleOnly: undefined,
    summary: result.brief.summary,
    questions: result.brief.questions,
    enrichedAt: new Date().toISOString(),
    enrichError: undefined,
  };
  writeDb(db.articles);

  return {
    ok: true,
    article: { ...db.articles[idx], id, category: db.articles[idx].category ?? null },
  };
}

export function setCategory(id: string, category: Category): Article | undefined {
  const db = readDb();
  const idx = db.articles.findIndex((a) => idFor(a.url) === id);
  if (idx === -1) return undefined;
  db.articles[idx] = { ...db.articles[idx], category };
  writeDb(db.articles);
  return { ...db.articles[idx], id, category };
}

export function removeArticle(id: string): boolean {
  const db = readDb();
  const next = db.articles.filter((a) => idFor(a.url) !== id);
  if (next.length === db.articles.length) return false;
  writeDb(next);
  return true;
}
