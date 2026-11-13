import { NextResponse } from 'next/server';
import { addArticle, listArticles } from '@/lib/store';
import { READONLY } from '@/lib/flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ articles: listArticles(), readonly: READONLY });
}

export async function POST(req: Request) {
  if (READONLY) {
    return NextResponse.json({ ok: false, message: '这是演示站，不能添加新文章' }, { status: 403 });
  }

  let body: { url?: string; titleOnly?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: '请求体不是合法 JSON' }, { status: 400 });
  }

  const url = (body.url ?? '').trim();
  if (!url) return NextResponse.json({ ok: false, message: '缺少 url' }, { status: 400 });

  const result = await addArticle(url, { titleOnly: Boolean(body.titleOnly) });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason, message: result.message },
      { status: 422 }
    );
  }
  return NextResponse.json(result);
}
