import { getDb } from './db';

/** 每篇文章的对话轮数上限 */
export const PER_ARTICLE_LIMIT = Number(process.env.CHAT_LIMIT_PER_ARTICLE ?? 3);

export function dayKey(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

export function usedFor(aid: string, articleId: string): number {
  const row = getDb()
    .prepare('SELECT count FROM chat_quota WHERE aid = ? AND article_id = ? AND day = ?')
    .get(aid, articleId, dayKey()) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function consumeFor(aid: string, articleId: string): number {
  const db = getDb();
  const day = dayKey();
  db.prepare(
    `INSERT INTO chat_quota (aid, article_id, day, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(aid, article_id, day) DO UPDATE SET count = count + 1`
  ).run(aid, articleId, day);
  return usedFor(aid, articleId);
}

export function remainingFor(aid: string, articleId: string): number {
  return Math.max(0, PER_ARTICLE_LIMIT - usedFor(aid, articleId));
}

export function logEvent(name: string, props: Record<string, unknown> = {}, aid = '', path = '') {
  try {
    getDb()
      .prepare('INSERT INTO events (aid, name, props, path) VALUES (?, ?, ?, ?)')
      .run(aid, name, JSON.stringify(props), path);
  } catch {
    /* 埋点失败不影响主流程 */
  }
}
