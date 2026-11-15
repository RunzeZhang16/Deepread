import nodemailer from 'nodemailer';

let cached = null;

export function hasMailer() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transporter() {
  if (cached) return cached;
  const port = Number(process.env.SMTP_PORT || 465);
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return cached;
}

export function siteUrl() {
  return (process.env.SITE_URL || 'http://124.220.163.131:3000').replace(/\/$/, '');
}

const from = () => `Deepread <${process.env.SMTP_USER}>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendConfirmMail(email, token) {
  const url = `${siteUrl()}/api/subscribe/confirm?token=${token}`;
  await transporter().sendMail({
    from: from(),
    to: email,
    subject: '确认订阅 Deepread',
    html: `<div style="font-family:-apple-system,'PingFang SC',sans-serif;max-width:520px;margin:0 auto;color:#1c1917;">
  <p style="font-size:15px;line-height:1.9;margin:0 0 18px;">点下面这个链接，确认订阅：</p>
  <p style="margin:0 0 22px;"><a href="${url}" style="display:inline-block;background:#1c1917;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:14px;">确认订阅</a></p>
  <p style="font-size:12px;color:#8a8378;line-height:1.8;margin:0;">每天下午 5 点，一封邮件，8 篇文章。<br/>如果不是你本人操作，忽略这封邮件即可。</p>
</div>`,
  });
}

export async function sendDigestMail(email, data) {
  const list = data.items
    .map(
      (it, i) => `<tr><td style="padding:9px 0;border-bottom:1px solid #eee8dd;font-size:14px;line-height:1.7;color:#1c1917;">
      <span style="color:#a8442e;font-size:11px;margin-right:8px;">${String(i + 1).padStart(2, '0')}</span>${esc(it.title)}
      ${it.account ? `<span style="color:#b3aba0;font-size:11px;">　${esc(it.account)}</span>` : ''}
    </td></tr>`
    )
    .join('');

  await transporter().sendMail({
    from: from(),
    to: email,
    subject: data.title,
    html: `<div style="font-family:-apple-system,'PingFang SC',sans-serif;max-width:560px;margin:0 auto;color:#1c1917;">
  <p style="margin:0 0 10px;font-size:20px;font-weight:600;line-height:1.5;">${esc(data.title)}</p>
  <p style="margin:0 0 22px;font-size:13.5px;line-height:1.9;color:#44403c;">${esc(data.intro)}</p>
  <p style="margin:0 0 26px;"><a href="${data.url}" style="display:inline-block;background:#a8442e;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;">打开今天的 8 篇 →</a></p>
  <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.18em;color:#8a8378;">今 天 的 八 篇</p>
  <table style="width:100%;border-collapse:collapse;">${list}</table>
  <p style="margin:24px 0 0;font-size:11px;color:#b3aba0;line-height:1.8;">你收到这封邮件，是因为在 Deepread 订阅了每日更新。<br/><a href="${data.unsubUrl}" style="color:#b3aba0;">退订</a></p>
</div>`,
  });
}
