import type Database from 'better-sqlite3';
import { getDb as openDb, parseQuestions as pq, parseAnswers as pa } from './db.mjs';

/** 全局只开一个连接（Next.js 开发模式热更新时会复用） */
export function getDb(): Database.Database {
  return openDb() as Database.Database;
}

/** 把数据库里的行转成前端用的对象（questions 是 JSON 字符串） */
export function parseQuestions(raw: string | null): string[] | undefined {
  return pq(raw) as string[] | undefined;
}

export function parseAnswers(raw: string | null): { q: string; a: string; next: string }[] | undefined {
  return pa(raw) as { q: string; a: string; next: string }[] | undefined;
}
