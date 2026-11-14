import { getDb } from '../lib/db.mjs';
import crypto from 'node:crypto';

const db = getDb();
const idFor = (u) => crypto.createHash('sha1').update(u).digest('hex').slice(0, 10);

const sources = [
  { name: '第一财经', url: 'https://www.yicai.com/', category: '经济' },
  { name: '财联社', url: 'https://www.cls.cn/', category: '经济' },
];

for (const s of sources) {
  const exists = db.prepare('SELECT 1 FROM sources WHERE url = ?').get(s.url);
  if (exists) {
    console.log('已存在:', s.name);
    continue;
  }
  db.prepare(
    `INSERT INTO sources (id, name, url, category, weight, enabled, type, brief_only)
     VALUES (?, ?, ?, ?, 60, 1, 'html', 1)`
  ).run(idFor(s.url), s.name, s.url, s.category);
  console.log('已添加速览源:', s.name);
}
console.log('当前速览源:', db.prepare('SELECT name FROM sources WHERE brief_only = 1').all().map(r => r.name));
