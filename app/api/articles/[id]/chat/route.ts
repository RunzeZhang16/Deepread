import { NextResponse } from 'next/server';
import { askAboutArticle, type ChatMessage } from '@/lib/chat';
import { findArticle } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const article = findArticle(id);
  if (!article) return NextResponse.json({ ok: false, message: '没找到这条' }, { status: 404 });

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: '请求体不是合法 JSON' }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ ok: false, message: '没有消息' }, { status: 400 });
  }

  const result = await askAboutArticle({
    url: article.url,
    title: article.title,
    messages: messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
  });

  if (!result.ok) return NextResponse.json({ ok: false, message: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, answer: result.answer });
}
