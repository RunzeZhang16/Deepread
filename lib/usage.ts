import { getDb } from './db';

export const DAILY_LIMIT = Number(process.env.CHAT_DAILY_LIMIT ?? 3);

export function dayKey(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

/** 今天已经用了几轮 */
export function usedToday(aid: string): number {
  const row = getDb()
    .prepare('SELECT count FROM chat_usage WHERE aid = ? AND day = ?')
    .get(aid, dayKey()) as { count: number } | undefined;
  return row?.count ?? 0;
}

/** 用掉一轮，返回用完之后的数量 */
export function consume(aid: string): number {
  const db = getDb();
  const day = dayKey();
  db.prepare(
    `INSERT INTO chat_usage (aid, day, count) VALUES (?, ?, 1)
     ON CONFLICT(aid, day) DO UPDATE SET count = count + 1`
  ).run(aid, day);
  return usedToday(aid);
}

export function remaining(aid: string): number {
  return Math.max(0, DAILY_LIMIT - usedToday(aid));
}

/** 埋点 */
export function logEvent(name: string, props: Record<string, unknown> = {}, aid = '', path = '') {
  try {
    getDb()
      .prepare('INSERT INTO events (aid, name, props, path) VALUES (?, ?, ?, ?)')
      .run(aid, name, JSON.stringify(props), path);
  } catch {
    /* 埋点失败不影响主流程 */
  }
}
