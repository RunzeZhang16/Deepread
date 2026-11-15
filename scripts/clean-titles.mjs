#!/usr/bin/env node
// 用最新的标题清洗规则，把当期已经入库的脏标题再洗一遍
import { getDb } from '../lib/db.mjs';
import { cleanTitle } from '../lib/title.mjs';

const db = getDb();
const rows = db.prepare("SELECT id, title, account FROM articles WHERE edition <> '0000-00-00'").all();
const upd = db.prepare('UPDATE articles SET title = ? WHERE id = ?');

let n = 0;
for (const r of rows) {
  const t = cleanTitle(r.title, r.account ?? '');
  if (t && t !== r.title) {
    upd.run(t, r.id);
    n++;
  }
}
console.log(`清洗完成：${n} 条`);
