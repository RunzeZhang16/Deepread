#!/usr/bin/env node
// 每天出刊后，把「今天的 8 篇」发给所有已确认的订阅者
// 邮件结构：开头的网页链接 + 8 篇标题（不含公众号稿全文）

import { getDb } from '../lib/db.mjs';
import { hasMailer, sendDigestMail, siteUrl } from '../lib/mailer.mjs';

if (!hasMailer()) {
  console.log('邮件未配置，跳过订阅者群发。');
  process.exit(0);
}

const db = getDb();

const edition = (
  db.prepare("SELECT MAX(edition) d FROM articles WHERE edition IS NOT NULL AND edition != '0000-00-00'").get() ?? {}
).d;

if (!edition) {
  console.log('还没有出刊，跳过。');
  process.exit(0);
}

const picks = db
  .prepare(
    `SELECT id, title, account FROM articles
     WHERE edition = ? AND title_only = 0 ORDER BY score DESC NULLS LAST, id ASC`
  )
  .all(edition);

if (picks.length === 0) {
  console.log('这一期没有正文，跳过。');
  process.exit(0);
}

const setting = (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? null;
};

let title = setting(`wechat_plan_${edition}`);
try {
  title = title ? JSON.parse(title).title : null;
} catch {
  title = null;
}
if (!title) {
  const [y, m, d] = edition.split('-');
  title = `今天值得读的 ${picks.length} 篇 · ${Number(m)} 月 ${Number(d)} 日`;
}

const intro =
  setting(`wechat_intro_${edition}`) ||
  `今天挑了 ${picks.length} 篇，都值得坐下来读完。`;

const subs = db.prepare("SELECT email, unsub_token FROM subscribers WHERE status = 'confirmed'").all();
console.log(`订阅者 ${subs.length} 人，开始发送「${title}」`);

let ok = 0;
let fail = 0;

for (const s of subs) {
  try {
    await sendDigestMail(s.email, {
      title,
      intro,
      url: siteUrl(),
      items: picks.map((p) => ({ title: p.title, account: p.account ?? undefined })),
      unsubUrl: `${siteUrl()}/api/unsubscribe?token=${s.unsub_token}`,
    });
    ok++;
  } catch (e) {
    fail++;
    console.log(`  ✗ ${s.email}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 300)); // 控制发送速率
}

console.log(`完成：成功 ${ok}，失败 ${fail}`);
