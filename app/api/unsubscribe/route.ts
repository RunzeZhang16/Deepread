import { unsubscribeByToken } from '@/lib/subscribers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const sub = token ? unsubscribeByToken(token) : undefined;

  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>已退订</title></head>
<body style="margin:0;background:#faf8f4;color:#1c1917;font-family:-apple-system,'PingFang SC',sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:90px 24px;text-align:center;">
  <p style="font-family:Georgia,'Songti SC',serif;font-size:26px;margin:0 0 26px;">Deepread</p>
  <p style="font-size:15px;line-height:1.9;">${
    sub ? '已退订，以后不会再收到邮件了。' : '这个退订链接无效，或者你已经退订过了。'
  }</p>
  <p style="margin:34px 0 0;"><a href="/" style="color:#a8442e;text-decoration:none;font-size:14px;">随时回来看看 →</a></p>
</div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
