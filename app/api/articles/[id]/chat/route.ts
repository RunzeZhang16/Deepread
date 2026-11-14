import { NextResponse } from 'next/server';
import { askAboutArticle, type ChatMessage } from '@/lib/chat';
import { findArticle } from '@/lib/store';
import { consumeFor, logEvent, PER_ARTICLE_LIMIT, remainingFor } from '@/lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const article = findArticle(id);
  if (!article) return NextResponse.json({ ok: false, message: '没找到这条' }, { status: 404 });

  let body: { messages?: ChatMessage[]; aid?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: '请求体不是合法 JSON' }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return NextResponse.json({ ok: false, message: '没有消息' }, { status: 400 });

  const aid =
    (body.aid ?? '').slice(0, 64) ||
    (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();

  if (remainingFor(aid, id) <= 0) {
    logEvent('chat_limit_hit', { articleId: id }, aid, `/article/${id}`);
    return NextResponse.json(
      {
        ok: false,
        code: 'limit',
        message: '感谢您的好奇心，但是这篇文章的对话额度已经用完啦，更多轮次的功能正在开发中，敬请期待',
        remaining: 0,
      },
      { status: 429 }
    );
  }

  const question = lastUser.content.trim();

  // 展示的问题：直接返回预生成的答案，不调用模型
  const cached = article.answers?.find((x) => x.q.trim() === question);
  if (cached) {
    const used = consumeFor(aid, id);
    logEvent('chat_cached', { articleId: id, q: question, round: used }, aid, `/article/${id}`);
    return NextResponse.json({
      ok: true,
      answer: cached.a,
      next: cached.next || null,
      remaining: Math.max(0, PER_ARTICLE_LIMIT - used),
      cached: true,
    });
  }

  const result = await askAboutArticle({
    url: article.url,
    title: article.title,
    messages: messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
  });

  if (!result.ok) return NextResponse.json({ ok: false, message: result.error }, { status: 422 });

  const used = consumeFor(aid, id);
  logEvent('chat_sent', { articleId: id, round: used, hasNext: Boolean(result.next) }, aid, `/article/${id}`);
  if (used >= PER_ARTICLE_LIMIT) {
    logEvent('chat_limit_hit', { articleId: id, round: used }, aid, `/article/${id}`);
  }

  return NextResponse.json({
    ok: true,
    answer: result.answer,
    next: result.next,
    remaining: Math.max(0, PER_ARTICLE_LIMIT - used),
  });
}
