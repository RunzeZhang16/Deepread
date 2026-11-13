import { NextResponse } from 'next/server';
import { enrichArticle } from '@/lib/store';
import { READONLY } from '@/lib/flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (READONLY) {
    return NextResponse.json({ ok: false, message: '这是演示站，不能生成' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const result = await enrichArticle(id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.error }, { status: 422 });
  }
  return NextResponse.json({ ok: true, article: result.article });
}
