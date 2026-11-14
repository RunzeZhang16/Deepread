import { NextResponse } from 'next/server';
import { logEvent } from '@/lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set([
  'page_view',
  'chat_open',
  'question_click',
  'next_click',
  'article_click',
  'subscribe_click',
]);

export async function POST(req: Request) {
  let body: { name?: string; aid?: string; props?: Record<string, unknown>; path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!body.name || !ALLOWED.has(body.name)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  logEvent(body.name, body.props ?? {}, (body.aid ?? '').slice(0, 64), body.path ?? '');
  return NextResponse.json({ ok: true });
}
