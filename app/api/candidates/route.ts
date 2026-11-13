import { NextResponse } from 'next/server';
import { readRecall } from '@/lib/recall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const data = readRecall();
  return NextResponse.json(data);
}
