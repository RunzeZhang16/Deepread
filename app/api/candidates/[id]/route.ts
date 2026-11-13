import { NextResponse } from 'next/server';
import { setCandidateStatus, type CandidateStatus } from '@/lib/recall';
import { READONLY } from '@/lib/flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED: CandidateStatus[] = ['new', 'kept', 'discarded'];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (READONLY) {
    return NextResponse.json({ ok: false, message: '演示站不能修改召回池' }, { status: 403 });
  }
  const { id } = await ctx.params;
  let body: { status?: CandidateStatus };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: '请求体不是合法 JSON' }, { status: 400 });
  }
  if (!body.status || !ALLOWED.includes(body.status)) {
    return NextResponse.json({ ok: false, message: '状态不合法' }, { status: 400 });
  }
  const candidate = setCandidateStatus(id, body.status);
  if (!candidate) return NextResponse.json({ ok: false, message: '没找到这条' }, { status: 404 });
  return NextResponse.json({ ok: true, candidate });
}
