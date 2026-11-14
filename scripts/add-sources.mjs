import { getDb } from '../lib/db.mjs';
import crypto from 'node:crypto';

const db = getDb();
const idFor = (u) => crypto.createHash('sha1').update(u).digest('hex').slice(0, 10);

const sources = [
  { name: '南方周末', url: 'https://www.infzm.com/', category: '社会' },
  { name: '中国新闻周刊', url: 'https://www.inewsweek.cn/', category: '社会' },
  { name: '新周刊', url: 'https://www.neweekly.com.cn/', category: '人文' },
];

for (const s of sources) {
  if (db.prepare('SELECT 1 FROM sources WHERE url = ?').get(s.url)) {
    console.log('已存在:', s.name);
    continue;
  }
  db.prepare(
    `INSERT INTO sources (id, name, url, category, weight, enabled, type, brief_only)
     VALUES (?, ?, ?, ?, 60, 1, 'html', 1)`
  ).run(idFor(s.url), s.name, s.url, s.category);
  console.log('已添加:', s.name);
}
console.log('速览源:', db.prepare('SELECT name FROM sources WHERE brief_only = 1').all().map((r) => r.name).join('、'));
