import { NextResponse } from 'next/server';
import { CATEGORIES, removeArticle, setCategory, type Category } from '@/lib/store';
import { READONLY } from '@/lib/flags';

const guard = () =>
  READONLY
    ? NextResponse.json({ ok: false, message: '这是演示站，不能修改' }, { status: 403 })
    : null;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = guard();
  if (blocked) return blocked;
  const { id } = await ctx.params;
  let body: { category?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: '请求体不是合法 JSON' }, { status: 400 });
  }

  const category = body.category as Category | undefined;
  if (!category || !CATEGORIES.includes(category)) {
    return NextResponse.json({ ok: false, message: '分类不合法' }, { status: 400 });
  }

  const article = setCategory(id, category);
  if (!article) return NextResponse.json({ ok: false, message: '没找到这条' }, { status: 404 });
  return NextResponse.json({ ok: true, article });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = guard();
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const ok = removeArticle(id);
  if (!ok) return NextResponse.json({ ok: false, message: '没找到这条' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
