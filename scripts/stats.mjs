#!/usr/bin/env node
// 看四个核心指标
// 用法：npm run stats [-- 7]

import { getDb } from '../lib/db.mjs';

const DAYS = Number(process.argv[2] ?? 7);
const db = getDb();

const rows = db
  .prepare(`SELECT name, aid, created_at FROM events WHERE created_at >= datetime('now', ?)`)
  .all(`-${DAYS} day`);

const byName = (n) => rows.filter((r) => r.name === n);
const uniq = (list) => new Set(list.map((r) => r.aid).filter(Boolean)).size;

const pageViews = byName('page_view');
const chatOpens = byName('chat_open');
const chatSends = byName('chat_sent');
const limitHits = byName('chat_limit_hit');
const qClicks = byName('question_click');
const nextClicks = byName('next_click');

const visitors = uniq(pageViews);
const chatUsers = uniq(chatOpens);
const satUsers = uniq(limitHits);

// 次日回访：昨天用满额度的人，今天有没有再来
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const satYesterday = new Set(
  limitHits.filter((r) => r.created_at.startsWith(yesterday)).map((r) => r.aid)
);
const cameBack = [...satYesterday].filter((aid) =>
  pageViews.some((r) => r.aid === aid && r.created_at.startsWith(today))
).length;

const pct = (a, b) => (b === 0 ? '—' : `${Math.round((a / b) * 100)}%`);

console.log(`\n最近 ${DAYS} 天\n`);
console.log('① 对话渗透率    打开对话 / 访问用户   ', pct(chatUsers, visitors), `(${chatUsers}/${visitors})`);
console.log('② 饱和率        用满 3 轮 / 打开对话   ', pct(satUsers, chatUsers), `(${satUsers}/${chatUsers})`);
console.log('③ 追问点击率    点追问 / 回答次数      ', pct(nextClicks.length, chatSends.length), `(${nextClicks.length}/${chatSends.length})`);
console.log('④ 次日回访率    昨天用满今天又来       ', pct(cameBack, satYesterday.size), `(${cameBack}/${satYesterday.size})`);
console.log(`\n原始数据：页面 ${pageViews.length} 次 · 对话 ${chatSends.length} 轮 · 问题点击 ${qClicks.length} 次 · 用满 ${limitHits.length} 次\n`);
