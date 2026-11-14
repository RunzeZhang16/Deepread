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

  // 轻量迁移：老库缺列时自动补
  if (ensureColumn(db, 'articles', 'edition', 'TEXT')) {
    // 首次加列时把历史文章归档，之后不再自动改
    db.prepare("UPDATE articles SET edition = '0000-00-00' WHERE edition IS NULL").run();
  }

  instance = db;
  return db;
}

function ensureColumn(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    return true;
  }
  return false;
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
