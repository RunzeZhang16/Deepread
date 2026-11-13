import fs from 'node:fs';
import path from 'node:path';

export type CandidateStatus = 'new' | 'kept' | 'discarded' | 'promoted';

export interface Candidate {
  id: string;
  sourceId: string;
  sourceName: string;
  category: string;
  weight: number;
  title: string;
  url: string;
  summary: string;
  publishedAt: string | null;
  fetchedAt: string;
  status: CandidateStatus;
  /** 精排分数 0-100 */
  score?: number;
  /** 打分理由，一句话 */
  reason?: string;
}

export interface RecallSourceStat {
  id: string;
  name: string;
  ok: boolean;
  count: number;
  ms: number;
  error: string | null;
}

export interface RecallData {
  updatedAt: string | null;
  total: number;
  dropped: { blocked: number; tooOld: number; duplicate: number } | null;
  sources: RecallSourceStat[];
  items: Candidate[];
}

const DB = path.join(process.cwd(), 'data', 'candidates.json');

export function readRecall(): RecallData {
  try {
    const raw = JSON.parse(fs.readFileSync(DB, 'utf8'));
    return {
      updatedAt: raw.updatedAt ?? null,
      total: raw.total ?? 0,
      dropped: raw.dropped ?? null,
      sources: raw.sources ?? [],
      items: raw.items ?? [],
    };
  } catch {
    return { updatedAt: null, total: 0, dropped: null, sources: [], items: [] };
  }
}

function writeRecall(data: RecallData) {
  fs.writeFileSync(
    DB,
    JSON.stringify(
      {
        updatedAt: data.updatedAt,
        total: data.items.length,
        dropped: data.dropped,
        sources: data.sources,
        items: data.items,
      },
      null,
      2
    )
  );
}

export function setCandidateStatus(id: string, status: CandidateStatus): Candidate | undefined {
  const data = readRecall();
  const idx = data.items.findIndex((i) => i.id === id);
  if (idx === -1) return undefined;
  data.items[idx] = { ...data.items[idx], status };
  writeRecall(data);
  return data.items[idx];
}

export function findCandidate(id: string): Candidate | undefined {
  return readRecall().items.find((i) => i.id === id);
}
