/**
 * 本期专题（封面文章）
 *
 * 规则：字数 ≥ 3000 且分数 ≥ 85 里取最长的一篇；都不满足就不做专题。
 * 为什么用字数：专题应该是"这期最值得坐下来读的那篇长文"，
 * 用分数会选出短评，用贴合度会选出凑数的。
 */

export const COVER_MIN_WORDS = 3000;
export const COVER_MIN_SCORE = 85;

/** @param {{id:string,word_count:number,score:number|null}[]} rows */
export function pickCover(rows) {
  const eligible = rows.filter(
    (r) => (r.word_count ?? 0) >= COVER_MIN_WORDS && (r.score ?? 0) >= COVER_MIN_SCORE
  );
  if (eligible.length === 0) return null;
  return eligible.sort((a, b) => (b.word_count ?? 0) - (a.word_count ?? 0))[0].id;
}

/** 把 edition 这一期的 is_cover 重算一遍，返回专题 id（可能为 null） */
export function refreshCover(db, edition) {
  const rows = db
    .prepare('SELECT id, word_count, score FROM articles WHERE edition = ? AND title_only = 0')
    .all(edition);
  const coverId = pickCover(rows);
  db.prepare('UPDATE articles SET is_cover = 0 WHERE edition = ?').run(edition);
  if (coverId) db.prepare('UPDATE articles SET is_cover = 1 WHERE id = ?').run(coverId);
  return coverId;
}
