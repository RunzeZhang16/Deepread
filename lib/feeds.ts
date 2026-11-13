import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { probeFeed as probeFeedRaw } from './probe.mjs';

export type FeedType = 'rss' | 'html';

export interface Feed {
  id: string;
  name: string;
  category: string;
  url: string;
  weight: number;
  enabled: boolean;
  /** rss = 订阅源；html = 列表页抓标题 */
  type?: FeedType;
  /** 最近一次召回抓到的条数，只用于展示 */
  lastCount?: number;
}

export const CATEGORIES = ['科技', '经济', '科学', '游戏', '开发', '人文', '艺术', '历史', '法律', '社会'] as const;

const DB = path.join(process.cwd(), 'data', 'feeds.json');

export function readFeeds(): Feed[] {
  try {
    const raw = JSON.parse(fs.readFileSync(DB, 'utf8'));
    return Array.isArray(raw.feeds) ? raw.feeds : [];
  } catch {
    return [];
  }
}

function writeFeeds(feeds: Feed[]) {
  fs.writeFileSync(
    DB,
    JSON.stringify({ updatedAt: new Date().toISOString(), feeds }, null, 2)
  );
}

function idFor(url: string) {
  // 必须用哈希：base64 前缀相同会导致所有 https:// 地址撞 id
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

/** 包一层：把 JS 那边的宽泛返回值收敛成这里的类型 */
export async function probeFeed(url: string): Promise<FeedProbe> {
  return (await probeFeedRaw(url)) as FeedProbe;
}

/** 现场测一个 RSS 地址，不写库 */
export async function addFeed(input: {
  url: string;
  name?: string;
  category?: string;
}): Promise<{ ok: true; feed: Feed; probe: FeedProbe } | { ok: false; error: string }> {
  const url = input.url.trim();
  const feeds = readFeeds();
  if (feeds.some((f) => f.url === url)) return { ok: false, error: '这个地址已经在列表里了' };

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
    type: (probe.type ?? 'rss') as FeedType,
  };
  writeFeeds([...feeds, feed]);
  return { ok: true, feed, probe };
}

export function removeFeed(id: string): boolean {
  const feeds = readFeeds();
  const next = feeds.filter((f) => f.id !== id);
  if (next.length === feeds.length) return false;
  writeFeeds(next);
  return true;
}

export function setFeedEnabled(id: string, enabled: boolean): Feed | undefined {
  const feeds = readFeeds();
  const idx = feeds.findIndex((f) => f.id === id);
  if (idx === -1) return undefined;
  feeds[idx] = { ...feeds[idx], enabled };
  writeFeeds(feeds);
  return feeds[idx];
}

const BLOCKED_PATTERNS: RegExp[] = [/AI\s*解读/i, /听说了吗/];

/** 源级黑名单：AI 生成的二手解读站，不进精选 */
export function isBlockedSourceName(name: string): boolean {
  return BLOCKED_PATTERNS.some((re) => re.test(name));
}
