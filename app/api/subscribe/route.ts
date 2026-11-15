import { NextResponse } from 'next/server';
import { hasMailer, sendConfirmMail } from '@/lib/mailer';
import { findByEmail, isEmail, normalizeEmail, upsertPending } from '@/lib/subscribers';
import { logEvent } from '@/lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 简单防刷：每个 IP 每小时最多 5 次
const hits = new Map<string, number[]>();

export async function POST(req: Request) {
  let body: { email?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: '请求格式不对' }, { status: 400 });
  }

  const email = normalizeEmail(body.email ?? '');
  if (!isEmail(email)) {
    return NextResponse.json({ ok: false, message: '邮箱格式不太对，检查一下？' }, { status: 400 });
  }

  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= 5) {
    return NextResponse.json({ ok: false, message: '试得有点频繁，过一会儿再试' }, { status: 429 });
  }
  recent.push(now);
  hits.set(ip, recent);

  const existing = findByEmail(email);
  if (existing?.status === 'confirmed') {
    return NextResponse.json({ ok: true, status: 'already', message: '你已经在订阅列表里了，明天见。' });
  }

  if (!hasMailer()) {
    return NextResponse.json({ ok: false, message: '订阅功能暂时不可用' }, { status: 503 });
  }

  const token = upsertPending(email, (body.source ?? 'web').slice(0, 32));
  try {
    await sendConfirmMail(email, token);
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: `确认邮件没发出去（${e instanceof Error ? e.message : '未知错误'}）` },
      { status: 502 }
    );
  }

  logEvent('subscribe_submit', { source: body.source ?? 'web' }, email.slice(0, 24), '/');
  return NextResponse.json({ ok: true, status: 'pending', message: '确认邮件已发出，去收件箱点一下链接' });
}
