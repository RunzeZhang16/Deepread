import { NextResponse } from 'next/server';
import { addArticle } from '@/lib/store';
import { findCandidate, setCandidateStatus } from '@/lib/recall';
import { isBlockedSourceName } from '@/lib/feeds';
import { READONLY } from '@/lib/flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** 收录：把候选抓成正式文章（抓正文 + 生成摘要和问题） */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (READONLY) {
    return NextResponse.json({ ok: false, message: '演示站不能收录' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const candidate = findCandidate(id);
  if (!candidate) return NextResponse.json({ ok: false, message: '没找到这条' }, { status: 404 });
  if (isBlockedSourceName(candidate.sourceName)) {
    return NextResponse.json({ ok: false, message: `不收这类源：${candidate.sourceName}` }, { status: 422 });
  }

  const result = await addArticle(candidate.url, {
    account: candidate.sourceName,
    score: candidate.score,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message ?? '收录失败' }, { status: 422 });
  }

  setCandidateStatus(id, 'promoted');
  return NextResponse.json({ ok: true, article: result.article, duplicate: result.reason === 'duplicate' });
}
