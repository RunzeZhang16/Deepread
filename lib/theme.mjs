/**
 * 每期主题：找出 8 篇的共性，起标题，并按「与主题的贴合度」排序。
 * 出刊时生成一次并存进 settings，网页、公众号、邮件都复用同一份，保证顺序一致。
 */

const BASE = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.LLM_MODEL || 'deepseek-flash';
const KEY = () => process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || '';

export const themeKey = (edition) => `theme_${edition}`;

export function readThemePlan(db, edition) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(themeKey(edition));
  if (!row) return null;
  try {
    const obj = JSON.parse(row.value);
    if (Array.isArray(obj.order) && obj.order.length) return obj;
  } catch {
    /* 坏数据当没有 */
  }
  return null;
}

export function saveThemePlan(db, edition, plan) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(themeKey(edition), JSON.stringify(plan));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} edition
 * @param {{id:string,title:string,hook?:string|null}[]} items
 * @returns {Promise<{title:string,theme:string,order:string[]}>}
 */
export async function buildThemePlan(db, edition, items) {
  const fallback = {
    title: `本期的 ${items.length} 篇`,
    theme: '',
    order: items.map((i) => i.id),
  };
  if (!KEY() || items.length === 0) return fallback;

  const lines = items
    .map((a, i) => `${i + 1}. ${a.title}${a.hook ? `\n   钩子：${a.hook}` : ''}`)
    .join('\n');

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY()}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: attempt === 0 ? 0.6 : 0.3,
          max_tokens: 6000,
          effort: 'low',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: `下面是本期选的 ${items.length} 篇文章。\n\n${lines}\n\n请做三件事：\n\n1) 找出它们真正的共性，用一句具体的主题说出来（12–22 字，不要「关于…的思考」这种空话）\n2) 用这个主题起一个公众号标题（12–20 字，有吸引力但不标题党：不用「震惊」「必看」，不用感叹号）\n3) 给每一篇打一个「与这个主题的贴合度」分数（0–100）：非常贴的 85 以上，沾边的 50–70，明显游离的 30 以下\n\n只输出 JSON：\n{"theme":"主题","title":"标题","fit":[{"i":1,"score":92},{"i":2,"score":65}]}\n\n注意：fit 要包含 1 到 ${items.length} 每一篇。`,
            },
          ],
          signal: AbortSignal.timeout(90000),
        }),
      });

      if (!res.ok) continue;
      const j = await res.json();
      const raw = j.choices?.[0]?.message?.content ?? '';
      const text = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const obj = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

      const title = String(obj.title ?? '').trim().replace(/^["「『]|["」』]$/g, '');
      const theme = String(obj.theme ?? '').trim();
      const fit = Array.isArray(obj.fit) ? obj.fit : [];

      if (title.length < 6 || title.length > 40) continue;

      const scored = fit
        .map((x) => ({ i: Number(x?.i) - 1, score: Number(x?.score) || 0 }))
        .filter((x) => Number.isInteger(x.i) && x.i >= 0 && x.i < items.length)
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map((x) => items[x.i].id);

      const missing = items.filter((it) => !scored.includes(it.id)).map((it) => it.id);
      return { title, theme, order: [...scored, ...missing] };
    } catch {
      /* 重试一次 */
    }
  }
  return fallback;
}
