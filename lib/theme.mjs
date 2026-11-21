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
    if (Array.isArray(obj.order) && obj.order.length) {
      return { title: obj.title ?? '', theme: obj.theme ?? '', intro: obj.intro ?? '', order: obj.order };
    }
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
 * @param {{id:string,title:string,hook?:string|null,summary?:string|null}[]} items
 * @param {{id:string,title:string,hook?:string|null,summary?:string|null}|null} cover 本期专题
 * @returns {Promise<{title:string,theme:string,intro:string,order:string[]}>}
 */
export async function buildThemePlan(db, edition, items, cover = null) {
  const fallback = {
    title: `本期的 ${items.length} 篇`,
    theme: '',
    intro: '',
    order: items.map((i) => (i.id === cover?.id ? i.id : i.id)),
  };
  if (!KEY() || items.length === 0) return fallback;

  const others = items.filter((i) => i.id !== cover?.id);
  const lines = others
    .map((a, i) => `${i + 1}. ${a.title}${a.hook ? `\n   钩子：${a.hook}` : ''}`)
    .join('\n');

  const coverBlock = cover
    ? `本期专题（封面文章）：\n《${cover.title}》\n${cover.hook ? `钩子：${cover.hook}\n` : ''}${cover.summary ? `摘要：${cover.summary}\n` : ''}`
    : '本期没有指定专题，请从下面这些里找一条真实的线索，不要硬凑。\n';

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
              content: cover
                ? `${coverBlock}\n其余文章：\n${lines}\n\n请做四件事：\n\n1) 用一句话说清这个专题在追问什么（12–22 字，具体，不要「关于…的思考」这种空话）\n2) 起一个公众号标题：围绕专题、12–20 字、有吸引力但不标题党（不用「震惊」「必看」，不用感叹号，不要抽象名词堆砌）\n3) 写一段按语，分两段。语气是「杂志编辑的卷首语」：书面、克制、有分寸的文学性，**不是口语复述**。\n   要求：\n   - 用书面语。禁止口语词：拿、搞、说白了、其实、于是乎、不得不说、让人想不到\n   - 用一个具体细节切入（数字、动作、场景），再用一句观察收束，不剧透结论\n   - 句式紧凑，不用「这」「那」开头的口水句，不用感叹号\n   - 第一段 100–160 字：讲清这个专题在追问什么、为什么值得花时间\n   - 第二段 40–70 字：一句带过其余文章的方向，不要写成「另外几篇讲的是……」\n   - **只能引用上面列表里真实存在的文章**：不得虚构事件、人物、数字。拿不准就概括成方向，不要举例\n   - 不要给文章里的角色改身份（研究者不要写成救援者，开发者不要写成创业者）\n4) 给「其余每篇」打一个与专题的相关度分数（0–100）：明显同频的 80 以上，沾边的 50–70，无关的 30 以下\n\n只输出 JSON：\n{"theme":"一句话","title":"标题","intro":"两段按语，用\\n分开","fit":[{"i":1,"score":82}]}\n\n注意：fit 只需要覆盖上面 ${others.length} 篇其余文章，编号对应它们的序号。`
                : `下面是本期选的 ${items.length} 篇文章。\n\n${lines}\n\n请做三件事：\n\n1) 找出它们真正的共性，用一句具体的主题说出来（12–22 字，不要空话）\n2) 用这个主题起一个公众号标题（12–20 字，有吸引力但不标题党）\n3) 给每一篇打贴合度分数（0–100）\n\n只输出 JSON：\n{"theme":"一句话","title":"标题","intro":"","fit":[{"i":1,"score":90}]}\n\n注意：fit 要覆盖 1 到 ${items.length}。`,
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
      const intro = String(obj.intro ?? '').trim();
      const fit = Array.isArray(obj.fit) ? obj.fit : [];

      if (title.length < 6 || title.length > 40) continue;

      const scored = fit
        .map((x) => ({ i: Number(x?.i) - 1, score: Number(x?.score) || 0 }))
        .filter((x) => Number.isInteger(x.i) && x.i >= 0 && x.i < others.length)
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map((x) => others[x.i].id);

      const missing = others.filter((it) => !scored.includes(it.id)).map((it) => it.id);
      const order = [...(cover ? [cover.id] : []), ...scored, ...missing];

      return { title, theme, intro, order };
    } catch {
      /* 重试一次 */
    }
  }
  return fallback;
}
