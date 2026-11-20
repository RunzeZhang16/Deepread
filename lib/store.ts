import path from 'node:path';
import fs from 'node:fs';
import { fetchArticle, toStored } from './extract.mjs';
import { generateBrief, hasLLM } from './llm';
import { cleanTitle } from './title.mjs';
import { getDb, parseQuestions, parseAnswers } from './db';
import { readThemePlan } from './theme.mjs';

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
  /** 只收标题：不生成摘要和问题 */
  titleOnly?: boolean;
  summary?: string;
  questions?: string[];
  answers?: { q: string; a: string; next: string }[];
  hook?: string | null;
  /** 本期专题（封面文章） */
  isCover?: boolean;
  edition?: string;
  enrichedAt?: string;
  enrichError?: string;
}

/** 北京时间的今天 */
export function todayEdition(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

/** 由 URL 派生稳定 id */
export function idFor(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

interface ArticleRow {
  id: string;
  url: string;
  title: string | null;
  account: string | null;
  site: string | null;
  status: string;
  word_count: number;
  excerpt: string | null;
  summary: string | null;
  questions: string | null;
  answers: string | null;
  hook: string | null;
  is_cover: number | null;
  published_at: string | null;
  fetched_at: string | null;
  category: string | null;
  title_only: number;
  score: number | null;
  note: string | null;
  error: string | null;
  enrich_error: string | null;
}

function toArticle(row: ArticleRow): Article {
  return {
    id: row.id,
    url: row.url,
    status: row.status as Status,
    site: row.site ?? undefined,
    title: row.title ?? '',
    account: row.account ?? undefined,
    wordCount: row.word_count ?? 0,
    excerpt: row.excerpt ?? undefined,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at ?? '',
    category: (row.category as Category | null) ?? null,
    note: row.note ?? undefined,
    error: row.error ?? undefined,
    score: row.score ?? undefined,
    titleOnly: row.title_only ? true : undefined,
    summary: row.summary ?? undefined,
    questions: parseQuestions(row.questions),
    answers: parseAnswers(row.answers),
    hook: row.hook ?? null,
    isCover: Boolean(row.is_cover),
    enrichError: row.enrich_error ?? undefined,
  };
}

export interface EditionInfo {
  edition: string;
  count: number;
  picks: number;
}

/** 往期：只列早于当前这期的（当前这期算"今天"，不算往期） */
export function listEditions(): EditionInfo[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT edition, COUNT(*) count,
              SUM(CASE WHEN title_only = 0 THEN 1 ELSE 0 END) picks
       FROM articles
       WHERE edition IS NOT NULL
         AND edition != '0000-00-00'
         AND edition < (SELECT MAX(edition) FROM articles WHERE edition != '0000-00-00')
       GROUP BY edition
       ORDER BY edition DESC`
    )
    .all() as EditionInfo[];
  return rows;
}

/** 某一期的全部内容 */
export function listArticlesByEdition(edition: string): Article[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM articles WHERE edition = ? ORDER BY title_only ASC, score DESC NULLS LAST, id ASC')
    .all(edition) as ArticleRow[];
  return rows.map(toArticle);
}

export function listArticles(): Article[] {
  const db = getDb();
  // 只展示最新一期
  const latest = db
    .prepare("SELECT MAX(edition) e FROM articles WHERE edition IS NOT NULL AND edition != '0000-00-00'")
    .get() as { e: string | null };
  const edition = latest?.e ?? '';
  const rows = db
    .prepare('SELECT * FROM articles WHERE edition = ? ORDER BY score DESC NULLS LAST, id ASC')
    .all(edition) as ArticleRow[];

  // 顺序：专题永远第一，其余按主题贴合度；速览自然排在最后
  const plan = readThemePlan(db, edition) as { order: string[] } | null;
  const list = rows.map(toArticle);
  const rank = new Map((plan?.order ?? []).map((id, i) => [id, i]));

  return list.sort((a, b) => {
    if (a.isCover !== b.isCover) return a.isCover ? -1 : 1;
    const ra = rank.has(a.id) ? (rank.get(a.id) as number) : 9999;
    const rb = rank.has(b.id) ? (rank.get(b.id) as number) : 9999;
    if (ra !== rb) return ra - rb;
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

export function findArticle(id: string): Article | undefined {
  const row = getDb().prepare('SELECT * FROM articles WHERE id = ?').get(id) as ArticleRow | undefined;
  return row ? toArticle(row) : undefined;
}

function insertArticle(rec: Article) {
  getDb()
    .prepare(
      `INSERT INTO articles (id, url, title, account, site, status, word_count, excerpt, summary, questions,
                             published_at, fetched_at, category, title_only, score, note, error, enrich_error)
       VALUES (@id, @url, @title, @account, @site, @status, @wordCount, @excerpt, @summary, @questions,
               @publishedAt, @fetchedAt, @category, @titleOnly, @score, @note, @error, @enrichError, @edition, @answers, @hook)
       ON CONFLICT(url) DO UPDATE SET
         title=excluded.title, account=excluded.account, summary=excluded.summary,
         questions=excluded.questions, word_count=excluded.word_count, title_only=excluded.title_only,
         score=excluded.score, status=excluded.status, enrich_error=excluded.enrich_error`
    )
    .run({
      id: rec.id,
      url: rec.url,
      title: rec.title ?? '',
      account: rec.account ?? null,
      site: rec.site ?? null,
      status: rec.status,
      wordCount: rec.wordCount ?? 0,
      excerpt: rec.excerpt ?? '',
      summary: rec.summary ?? null,
      questions: rec.questions ? JSON.stringify(rec.questions) : null,
      answers: rec.answers ? JSON.stringify(rec.answers) : null,
      hook: rec.hook ?? null,
      publishedAt: rec.publishedAt ?? null,
      fetchedAt: rec.fetchedAt ?? new Date().toISOString(),
      category: rec.category ?? null,
      titleOnly: rec.titleOnly ? 1 : 0,
      score: typeof rec.score === 'number' ? rec.score : null,
      note: rec.note ?? null,
      error: rec.error ?? null,
      enrichError: rec.enrichError ?? null,
      edition: rec.edition ?? todayEdition(),
    });
}

/** 抓正文 → 生成导读 → 落库（正文丢弃） */
async function buildRecord(
  url: string,
  opts: { titleOnly?: boolean; account?: string; score?: number } = {}
): Promise<{ record: Partial<Article> & { title: string; url: string; status: Status; fetchedAt: string }; error?: string }> {
  const fetched = (await fetchArticle(url)) as Record<string, unknown> & {
    body?: string;
    status: Status;
    title: string;
    account?: string;
    wordCount: number;
    note?: string;
  };

  const base = toStored(fetched) as Partial<Article>;
  if (opts.account) {
    base.account = opts.account;
    base.title = cleanTitle(base.title ?? '', opts.account);
  }
  if (typeof opts.score === 'number') base.score = opts.score;

  const record = {
    ...base,
    url,
    title: base.title ?? '',
    status: (base.status ?? 'full') as Status,
    fetchedAt: new Date().toISOString(),
  };

  if (fetched.status !== 'full') return { record };

  if (opts.titleOnly) return { record: { ...record, titleOnly: true } };

  if (!hasLLM()) return { record: { ...record, enrichError: '没有配置 DEEPSEEK_API_KEY' } };

  const result = await generateBrief({
    title: fetched.title,
    account: fetched.account ?? '',
    body: fetched.body ?? '',
  });

  if (!result.ok) return { record: { ...record, enrichError: result.error }, error: result.error };

  return {
    record: {
      ...record,
      summary: result.brief.summary,
      hook: result.brief.hook,
      questions: result.brief.items.map((i) => i.q),
      answers: result.brief.items,
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

  const existing = getDb().prepare('SELECT * FROM articles WHERE url = ?').get(url) as ArticleRow | undefined;
  if (existing) {
    return { ok: true, reason: 'duplicate', article: toArticle(existing), message: '这条已经在列表里了' };
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

  const rec = { ...built.record, id: idFor(url), category: null, edition: todayEdition() } as Article;
  insertArticle(rec);
  return { ok: true, article: findArticle(rec.id), enrichError: built.error };
}

/** 给已有文章补/重生成导读（重新抓一次正文） */
export async function enrichArticle(
  id: string
): Promise<{ ok: boolean; article?: Article; error?: string }> {
  const rec = findArticle(id);
  if (!rec) return { ok: false, error: '没找到这条' };
  if (rec.status !== 'full') return { ok: false, error: '这条没有正文，生成不了' };
  if (!hasLLM()) return { ok: false, error: '没有配置 DEEPSEEK_API_KEY' };

  let fetched: { body?: string; title?: string; account?: string };
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
    getDb().prepare('UPDATE articles SET enrich_error = ? WHERE id = ?').run(result.error, id);
    return { ok: false, error: result.error };
  }

  getDb()
    .prepare(
      `UPDATE articles SET summary = ?, questions = ?, answers = ?, hook = ?, title_only = 0, enrich_error = NULL WHERE id = ?`
    )
    .run(
      result.brief.summary,
      JSON.stringify(result.brief.items.map((i) => i.q)),
      JSON.stringify(result.brief.items),
      result.brief.hook,
      id
    );

  return { ok: true, article: findArticle(id) };
}

export function setCategory(id: string, category: Category): Article | undefined {
  const info = getDb().prepare('UPDATE articles SET category = ? WHERE id = ?').run(category, id);
  if (info.changes === 0) return undefined;
  return findArticle(id);
}

export function removeArticle(id: string): boolean {
  return getDb().prepare('DELETE FROM articles WHERE id = ?').run(id).changes > 0;
}

/** 兼容旧路径：确保 data 目录存在（有些脚本会用） */
export function dataDir(): string {
  return path.join(process.cwd(), 'data');
}
