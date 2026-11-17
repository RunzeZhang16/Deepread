// 用 VACUUM INTO 做一份一致的库快照。WAL 模式下直接 cp 会拷到写了一半的文件。
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'deepread.db');
const dir = path.join(path.dirname(dbPath), 'backups');
fs.mkdirSync(dir, { recursive: true });

const stamp = process.env.BACKUP_STAMP || new Date().toISOString().slice(0, 10).replace(/-/g, '');
if (!/^\d{8}$/.test(stamp)) {
  console.error('BACKUP_STAMP 必须是 YYYYMMDD');
  process.exit(1);
}

const dest = path.join(dir, `deepread-${stamp}.db`);
if (fs.existsSync(dest)) fs.unlinkSync(dest);

const db = new Database(dbPath);
db.pragma('busy_timeout = 5000');
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();

const keep = 8;
const files = fs.readdirSync(dir).filter((f) => /^deepread-\d{8}\.db$/.test(f)).sort();
while (files.length > keep) {
  fs.unlinkSync(path.join(dir, files.shift()));
}

console.log(dest);
