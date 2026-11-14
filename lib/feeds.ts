import crypto from 'node:crypto';
import { probeFeed as probeFeedRaw } from './probe.mjs';
import { getDb } from './db';

export type FeedType = 'rss' | 'html';

export interface Feed {
  id: string;
  name: string;
  category: string;
  url: string;
  weight: number;
  enabled: boolean;
  type?: FeedType;
  /** 只取标题的源（列表页媒体） */
  briefOnly?: boolean;
}

export const CATEGORIES = ['科技', '经济', '科学', '游戏', '开发', '人文', '艺术', '历史', '法律', '社会'] as const;

interface SourceRow {
  id: string;
  name: string;
  url: string;
  category: string | null;
  weight: number;
  enabled: number;
  type: string | null;
  brief_only: number;
}

function toFeed(r: SourceRow): Feed {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    category: r.category ?? '',
    weight: r.weight ?? 55,
    enabled: !!r.enabled,
    type: (r.type as FeedType) ?? 'rss',
    briefOnly: r.brief_only ? true : undefined,
  };
}

export function readFeeds(): Feed[] {
  const rows = getDb().prepare('SELECT * FROM sources ORDER BY category, name').all() as SourceRow[];
  return rows.map(toFeed);
}

function idFor(url: string) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
}

export interface FeedProbe {
  ok: boolean;
  type?: FeedType;
  title?: string;
  items?: number;
  latest?: string | null;
  sample?: string;
  error?: string;
}

export async function probeFeed(url: string): Promise<FeedProbe> {
  return (await probeFeedRaw(url)) as FeedProbe;
}

export async function addFeed(input: {
  url: string;
  name?: string;
  category?: string;
}): Promise<{ ok: true; feed: Feed; probe: FeedProbe } | { ok: false; error: string }> {
  const url = input.url.trim();
  const db = getDb();

  const exists = db.prepare('SELECT 1 FROM sources WHERE url = ?').get(url);
  if (exists) return { ok: false, error: '这个地址已经在列表里了' };

  const probe = await probeFeed(url);
  if (!probe.ok) return { ok: false, error: `地址不可用：${probe.error}` };

  const name = (input.name || probe.title || new URL(url).hostname).trim().slice(0, 20);
  const feed: Feed = {
    id: idFor(url),
    name,
    category: input.category || '人文',
    url,
    weight: 55,
    enabled: true,
    type: probe.type ?? 'rss',
  };

  db.prepare(
    `INSERT INTO sources (id, name, url, category, weight, enabled, type, brief_only)
     VALUES (?, ?, ?, ?, ?, 1, ?, 0)`
  ).run(feed.id, feed.name, feed.url, feed.category, feed.weight, feed.type ?? 'rss');

  return { ok: true, feed, probe };
}

export function removeFeed(id: string): boolean {
  return getDb().prepare('DELETE FROM sources WHERE id = ?').run(id).changes > 0;
}

export function setFeedEnabled(id: string, enabled: boolean): Feed | undefined {
  const db = getDb();
  const info = db.prepare('UPDATE sources SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  if (info.changes === 0) return undefined;
  return readFeeds().find((f) => f.id === id);
}

const BLOCKED_PATTERNS: RegExp[] = [/AI\s*解读/i, /听说了吗/];

/** 源级黑名单：AI 生成的二手解读站，不进精选 */
export function isBlockedSourceName(name: string): boolean {
  return BLOCKED_PATTERNS.some((re) => re.test(name));
}
