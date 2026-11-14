import { getDb } from './db';

export type CandidateStatus = 'new' | 'kept' | 'discarded' | 'promoted';

export interface Candidate {
  id: string;
  sourceId: string;
  sourceName: string;
  category: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string | null;
  fetchedAt: string;
  status: CandidateStatus;
  score?: number;
  reason?: string;
}

export interface RecallSourceStat {
  id: string;
  name: string;
  ok: boolean;
  count: number;
  ms?: number;
  error: string | null;
}

export interface RecallData {
  updatedAt: string | null;
  total: number;
  dropped: { blocked: number; tooOld: number; duplicate: number } | null;
  sources: RecallSourceStat[];
  items: Candidate[];
}

interface Row {
  id: string;
  source_id: string | null;
  source_name: string | null;
  title: string;
  url: string;
  summary: string | null;
  category: string | null;
  published_at: string | null;
  fetched_at: string | null;
  score: number | null;
  reason: string | null;
  status: string;
}

function toCandidate(r: Row): Candidate {
  return {
    id: r.id,
    sourceId: r.source_id ?? '',
    sourceName: r.source_name ?? '',
    category: r.category ?? '',
    title: r.title,
    url: r.url,
    summary: r.summary ?? '',
    publishedAt: r.published_at,
    fetchedAt: r.fetched_at ?? '',
    status: r.status as CandidateStatus,
    score: r.score ?? undefined,
    reason: r.reason ?? undefined,
  };
}

export function readRecall(): RecallData {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM candidates ORDER BY score DESC NULLS LAST, published_at DESC')
    .all() as Row[];

  let stats: { updatedAt?: string; dropped?: RecallData['dropped']; sources?: RecallSourceStat[] } = {};
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'recall_stats'").get() as
      | { value: string }
      | undefined;
    if (row) stats = JSON.parse(row.value);
  } catch {
    /* 忽略 */
  }

  return {
    updatedAt: stats.updatedAt ?? null,
    total: rows.length,
    dropped: stats.dropped ?? null,
    sources: stats.sources ?? [],
    items: rows.map(toCandidate),
  };
}

export function setCandidateStatus(id: string, status: CandidateStatus): Candidate | undefined {
  const db = getDb();
  const info = db.prepare('UPDATE candidates SET status = ? WHERE id = ?').run(status, id);
  if (info.changes === 0) return undefined;
  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Row;
  return toCandidate(row);
}

export function findCandidate(id: string): Candidate | undefined {
  const row = getDb().prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Row | undefined;
  return row ? toCandidate(row) : undefined;
}
