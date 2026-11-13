import { NextResponse } from 'next/server';
import { addFeed, CATEGORIES, readFeeds } from '@/lib/feeds';
import { READONLY } from '@/lib/flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ feeds: readFeeds(), categories: CATEGORIES });
}

export async function POST(req: Request) {
  if (READONLY) {
    return NextResponse.json({ ok: false, message: '演示站不能加源' }, { status: 403 });
  }
  let body: { url?: string; name?: string; category?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: '请求体不是合法 JSON' }, { status: 400 });
  }
  if (!body.url) return NextResponse.json({ ok: false, message: '缺少 url' }, { status: 400 });

  const result = await addFeed({ url: body.url, name: body.name, category: body.category });
  if (!result.ok) return NextResponse.json({ ok: false, message: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, feed: result.feed, probe: result.probe });
}
