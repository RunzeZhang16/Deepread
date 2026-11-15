import { confirmByToken } from '@/lib/subscribers';
import { logEvent } from '@/lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(title: string, body: string) {
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;background:#faf8f4;color:#1c1917;font-family:-apple-system,'PingFang SC',sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:90px 24px;text-align:center;">
  <p style="font-family:Georgia,'Songti SC',serif;font-size:26px;margin:0 0 26px;">Deepread</p>
  ${body}
  <p style="margin:34px 0 0;"><a href="/" style="color:#a8442e;text-decoration:none;font-size:14px;">去读今天的 8 篇 →</a></p>
</div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const sub = token ? confirmByToken(token) : undefined;

  if (!sub) return page('链接无效', '<p style="font-size:15px;line-height:1.9;">这个链接无效或已过期。</p>');

  logEvent('subscribe_confirm', {}, sub.email.slice(0, 24), '/');
  return page(
    '订阅成功',
    `<p style="font-size:16px;line-height:1.9;margin:0 0 8px;">好了，你订上了。</p>
     <p style="font-size:14px;line-height:1.9;color:#8a8378;margin:0;">每周五晚 7 点，一封邮件，8 篇文章。</p>`
  );
}
