import { NextResponse } from 'next/server';
import { buildWechatArticle } from '@/lib/wechat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET() {
  try {
    const data = await buildWechatArticle();
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : '生成失败' },
      { status: 500 }
    );
  }
}
