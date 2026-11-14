#!/usr/bin/env node
// 每天出刊后，把公众号排版稿发到邮箱（正文可读 + HTML 附件）
//
// 需要环境变量：
//   SMTP_HOST  SMTP_PORT  SMTP_USER  SMTP_PASS  MAIL_TO
// 例：smtp.qq.com / 465 / xxx@qq.com / 授权码 / 你的收件邮箱

import nodemailer from 'nodemailer';
import { writeFileSync } from 'node:fs';

const HOST = process.env.SMTP_HOST;
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const TO = process.env.MAIL_TO;

if (!HOST || !USER || !PASS || !TO) {
  console.log('邮件未配置（缺 SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_TO），跳过。');
  process.exit(0);
}

const base = process.env.LOCAL_BASE || 'http://127.0.0.1:3000';

const res = await fetch(`${base}/api/wechat`, { cache: 'no-store' });
const data = await res.json();
if (!data.ok) {
  console.error('生成公众号稿失败：', data.message);
  process.exit(1);
}

const { title, html } = data;
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());

const page = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:24px;background:#faf8f4;">
${html}
</body></html>`;

const file = `/tmp/deepread-wechat-${date}.html`;
try {
  writeFileSync(file, page);
} catch {
  /* 写不了也不影响发信 */
}

const transporter = nodemailer.createTransport({
  host: HOST,
  port: PORT,
  secure: PORT === 465,
  auth: { user: USER, pass: PASS },
});

const info = await transporter.sendMail({
  from: `Deepread <${USER}>`,
  to: TO,
  subject: `${title}`,
  html: `<div style="font-family:-apple-system,'PingFang SC',sans-serif;">
  <p style="font-size:13px;color:#8a8378;margin:0 0 18px;">
    ${date} 公众号稿 · 直接复制下面内容粘到公众号编辑器；附件也可下载
  </p>
  ${html}
</div>`,
  attachments: [{ filename: `deepread-wechat-${date}.html`, path: file }],
});

console.log(`邮件已发送：${info.messageId} → ${TO}`);
