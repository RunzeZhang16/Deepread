#!/usr/bin/env node
// 每期出刊后，把文章标题列表发给所有已确认的订阅者
// 邮件只含：期号 + 网站链接 + 8 篇文章标题

import { getDb } from '../lib/db.mjs';
import { hasMailer, sendDigestMail, siteUrl } from '../lib/mailer.mjs';
import { buildThemePlan, readThemePlan, saveThemePlan } from '../lib/theme.mjs';

if (!hasMailer()) {
  console.log('邮件未配置，跳过订阅者群发。');
  process.exit(0);
}

const db = getDb();

const edition = (
  db.prepare("SELECT MAX(edition) d FROM articles WHERE edition IS NOT NULL AND edition <> '0000-00-00'").get() ?? {}
).d;

if (!edition) {
  console.log('还没有出刊，跳过。');
  process.exit(0);
}

// 期号：只从正式第一期（默认 2026-11-20）开始算，之前的测试期不算
const ISSUE_START = process.env.ISSUE_START_EDITION || '2026-11-20';
if (edition < ISSUE_START) {
  console.log(`当前是 ${edition}，早于正式第一期（${ISSUE_START}），不发订阅邮件。`);
  process.exit(0);
}

const issueNo =
  db
    .prepare(
      "SELECT COUNT(DISTINCT edition) n FROM articles WHERE edition >= ? AND edition <= ? AND edition <> '0000-00-00'"
    )
    .get(ISSUE_START, edition).n;

let picks = db
  .prepare(
    `SELECT id, title, account FROM articles
     WHERE edition = ? AND title_only = 0 ORDER BY score DESC NULLS LAST, id ASC`
  )
  .all(edition);

// 用出刊时定下的主题顺序；没有就现在生成一份，保证和网页、公众号一致
let plan = readThemePlan(db, edition);
if (!plan) {
  const rows = db
    .prepare('SELECT id, title, hook FROM articles WHERE edition = ? AND title_only = 0')
    .all(edition);
  plan = await buildThemePlan(db, edition, rows);
  saveThemePlan(db, edition, plan);
  console.log(`补生成主题：${plan.title}`);
}
if (plan && Array.isArray(plan.order)) {
  const idx = new Map(plan.order.map((id, i) => [id, i]));
  picks = picks
    .map((p) => ({ ...p, r: idx.has(p.id) ? idx.get(p.id) : 9999 }))
    .sort((a, b) => a.r - b.r)
    .map(({ r, ...p }) => p);
}

if (picks.length === 0) {
  console.log('这一期没有正文，跳过。');
  process.exit(0);
}

const subject = `Deepread 第 ${issueNo} 期`;
const subs = db.prepare("SELECT email, unsub_token FROM subscribers WHERE status = 'confirmed'").all();
console.log(`订阅者 ${subs.length} 人，开始发送「${subject}」`);

let ok = 0;
let fail = 0;

for (const s of subs) {
  try {
    await sendDigestMail(s.email, {
      title: subject,
      url: siteUrl(),
      items: picks.map((p) => ({ title: p.title, account: p.account ?? undefined })),
      unsubUrl: `${siteUrl()}/api/unsubscribe?token=${s.unsub_token}`,
    });
    ok++;
  } catch (e) {
    fail++;
    console.log(`  ✗ ${s.email}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`完成：成功 ${ok}，失败 ${fail}`);
