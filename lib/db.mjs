// SQLite 连接（JS 版，供 scripts 直接使用）
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

let instance = null;

export function getDb() {
  if (instance) return instance;

  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'deepread.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = path.join(process.cwd(), 'db', 'schema.sql');
  db.exec(fs.readFileSync(schema, 'utf8'));

  instance = db;
  return db;
}

export function parseQuestions(raw) {
  if (!raw) return undefined;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0 ? arr : undefined;
  } catch {
    return undefined;
  }
}
