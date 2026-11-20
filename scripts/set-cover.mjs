#!/usr/bin/env node
// 给当前这一期重算专题，并重新生成主题/按语（换文章或调阈值后用）
import { getDb } from '../lib/db.mjs';
import { refreshCover } from '../lib/cover.mjs';
import { buildThemePlan, saveThemePlan } from '../lib/theme.mjs';

const db = getDb();
const edition = db
  .prepare("SELECT MAX(edition) e FROM articles WHERE edition IS NOT NULL AND edition <> '0000-00-00'")
  .get().e;

const coverId = refreshCover(db, edition);
const rows = db
  .prepare('SELECT id, title, hook, summary, word_count, score FROM articles WHERE edition = ? AND title_only = 0')
  .all(edition);
const cover = rows.find((r) => r.id === coverId) ?? null;

console.log(`当期 ${edition} · ${rows.length} 篇`);
console.log(cover ? `专题：${cover.title}（${cover.word_count} 字 / ${cover.score} 分）` : '本期没有专题（没有 3000 字以上且 85 分以上的文章）');

if (rows.length) {
  const plan = await buildThemePlan(db, edition, rows, cover);
  saveThemePlan(db, edition, plan);
  console.log(`标题：${plan.title}`);
  console.log(`按语：${(plan.intro || '').slice(0, 80)}…`);
  console.log(`顺序：${plan.order.slice(0, 3).join(' → ')} …`);
}
