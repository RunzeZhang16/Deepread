import { NextResponse } from 'next/server';
import { removeFeed, setFeedEnabled } from '@/lib/feeds';
import { READONLY } from '@/lib/flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (READONLY) {
    return NextResponse.json({ ok: false, message: '演示站不能改源' }, { status: 403 });
  }
  const { id } = await ctx.params;
  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: '请求体不是合法 JSON' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ ok: false, message: '缺少 enabled' }, { status: 400 });
  }
  const feed = setFeedEnabled(id, body.enabled);
  if (!feed) return NextResponse.json({ ok: false, message: '没找到这个源' }, { status: 404 });
  return NextResponse.json({ ok: true, feed });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (READONLY) {
    return NextResponse.json({ ok: false, message: '演示站不能删源' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const ok = removeFeed(id);
  if (!ok) return NextResponse.json({ ok: false, message: '没找到这个源' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
