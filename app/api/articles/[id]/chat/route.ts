import { NextResponse } from 'next/server';
import { askAboutArticle, type ChatMessage } from '@/lib/chat';
import { findArticle } from '@/lib/store';
import { consume, DAILY_LIMIT, logEvent, remaining } from '@/lib/usage';

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
  if (messages.length === 0) {
    return NextResponse.json({ ok: false, message: '没有消息' }, { status: 400 });
  }

  // 匿名标识：没有就用 IP 兜底
  const aid =
    (body.aid ?? '').slice(0, 64) ||
    (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();

  const left = remaining(aid);
  if (left <= 0) {
    logEvent('chat_limit_hit', { articleId: id }, aid, `/article/${id}`);
    return NextResponse.json(
      {
        ok: false,
        code: 'limit',
        message: '感谢您的好奇心，但是今天的对话额度已经用完啦，更多轮次的功能正在开发中，敬请期待',
        remaining: 0,
      },
      { status: 429 }
    );
  }

  const result = await askAboutArticle({
    url: article.url,
    title: article.title,
    messages: messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
  });

  if (!result.ok) return NextResponse.json({ ok: false, message: result.error }, { status: 422 });

  const used = consume(aid);
  const round = used;
  logEvent('chat_sent', { articleId: id, round, hasNext: Boolean(result.next) }, aid, `/article/${id}`);
  if (used >= DAILY_LIMIT) {
    logEvent('chat_limit_hit', { articleId: id, round: used }, aid, `/article/${id}`);
  }

  return NextResponse.json({
    ok: true,
    answer: result.answer,
    next: result.next,
    remaining: Math.max(0, DAILY_LIMIT - used),
  });
}
