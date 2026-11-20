import { getDb } from './db';
import { buildThemePlan, readThemePlan, saveThemePlan } from './theme.mjs';
import { listArticles, todayEdition, type Article } from './store';

const ACCENT = '#a8442e';
const INK = '#1c1917';
const MUTED = '#8a8378';
const LINE = '#e8e2d8';

function esc(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtCN(date: string) {
  const [y, m, d] = date.split('-');
  return `${Number(m)} 月 ${Number(d)} 日`;
}

/** 固定题记：为什么做这个产品 */
const EPIGRAPH = `我每天都会读到几篇好东西，读完又很快忘了。做 Deepread，是想把这件事放慢一点：每天挑几篇，写清它讲了什么，再留两个问题。也许你会想接着聊两句——那样这篇文章才算真的读过。`;

/** 从 settings 读缓存的小工具 */
function cached(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function save(key: string, value: string) {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value);
}

/** 同一天并发请求只生成一次，避免两次生成互相覆盖 */
const planInflight = new Map<string, Promise<{ title: string; theme: string; order: number[] }>>();

function buildPlanOnce(items: Article[], day: string) {
  const hit = planInflight.get(day);
  if (hit) return hit;
  const p = buildPlan(items, day).finally(() => planInflight.delete(day));
  planInflight.set(day, p);
  return p;
}

/**
 * 找共性、定主题、按贴合度排序（当天缓存）
 * 返回标题 + 主题 + 重排后的顺序
 */
async function buildPlan(
  items: Article[],
  day: string
): Promise<{ title: string; theme: string; order: number[] }> {
  const key = `wechat_plan_${day}`;
  const identity = { title: `今天这 ${items.length} 篇，值得慢慢读`, theme: '', order: items.map((_, i) => i) };

  const hit = cached(key);
  if (hit) {
    try {
      const obj = JSON.parse(hit);
      const order = Array.isArray(obj.order) ? sanitizeZeroBased(obj.order, items.length) : identity.order;
      return { title: String(obj.title || identity.title), theme: String(obj.theme || ''), order };
    } catch {
      /* 缓存坏了就重新生成 */
    }
  }

  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || '';
  if (!apiKey) return identity;

  const lines = items
    .map((a, i) => `${i + 1}. ${a.title}${a.hook ? `\n   钩子：${a.hook}` : ''}`)
    .join('\n');

  for (let attempt = 0; attempt < 2; attempt++) {
  try {
    const res = await fetch(`${process.env.LLM_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'deepseek-flash',
        temperature: attempt === 0 ? 0.6 : 0.3,
        max_tokens: 6000,
        effort: 'low',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: `下面是今天选的 ${items.length} 篇文章。\n\n${lines}\n\n请做三件事：\n\n1) 找出它们真正的共性，用一句具体的主题说出来（12–22 字，不要「关于…的思考」这种空话）\n2) 用这个主题起一个公众号标题（12–20 字，有吸引力但不标题党：不用「震惊」「必看」，不用感叹号）\n3) 给每一篇打一个「与这个主题的贴合度」分数（0–100）：非常贴的 85 以上，沾边的 50–70，明显游离的 30 以下\n\n只输出 JSON：\n{"theme":"主题","title":"公众号标题","fit":[{"i":1,"score":92},{"i":2,"score":65}]}\n\n注意：fit 要包含 1 到 ${items.length} 每一篇，i 用上面的编号。`,
          },
        ],
        signal: AbortSignal.timeout(90000),
      }),
    });

    if (res.ok) {
      const j = await res.json();
      const raw = j.choices?.[0]?.message?.content ?? '';
      const text = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const obj = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

      const theme = String(obj.theme ?? '').trim();
      const title = String(obj.title ?? '').trim().replace(/^["「『]|["」』]$/g, '');

      // 用贴合度分数排序，比让模型直接给顺序稳定得多
      const fitList: { i: number; score: number }[] = Array.isArray(obj.fit)
        ? obj.fit
            .map((x: { i?: unknown; score?: unknown }) => ({
              i: Number(x?.i) - 1,
              score: Number(x?.score) || 0,
            }))
            .filter((x: { i: number }) => Number.isInteger(x.i) && x.i >= 0 && x.i < items.length)
        : [];

      const order =
        fitList.length > 0
          ? [...fitList]
              .sort((a, b) => b.score - a.score || a.i - b.i)
              .map((x) => x.i)
              .concat(
                items.map((_, i) => i).filter((i) => !fitList.some((x) => x.i === i))
              )
          : normalizeOrder(Array.isArray(obj.order) ? obj.order : [], items.length);

      if (title.length >= 6 && title.length <= 40) {
        save(key, JSON.stringify({ theme, title, order }));
        return { title, theme, order };
      }
    }
  } catch {
    /* 这次失败，重试一次 */
  }
  }
  return identity;
}

/** 校正已经是 0 基的顺序 */
function sanitizeZeroBased(raw: unknown[], n: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of raw) {
    const i = Number(v);
    if (Number.isInteger(i) && i >= 0 && i < n && !seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  for (let i = 0; i < n; i++) if (!seen.has(i)) out.push(i);
  return out;
}

/** 把模型给的顺序修正成 0..n-1 的完整排列 */
function normalizeOrder(raw: unknown[], n: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of raw) {
    const i = Number(v) - 1;
    if (Number.isInteger(i) && i >= 0 && i < n && !seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  for (let i = 0; i < n; i++) if (!seen.has(i)) out.push(i);
  return out;
}

/** 自动写一段开场按语（有缓存） */
async function buildIntro(items: Article[], day: string): Promise<string> {
  const db = getDb();
  const key = `wechat_intro_${day}`;
  const cached = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (cached?.value) return cached.value;

  const key2 = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || '';
  const titles = items.map((a, i) => `${i + 1}. ${a.title}`).join('\n');
  const fallback = `今天挑了 ${items.length} 篇，都是能坐下来读完的长文。`;

  if (!key2) return fallback;

  try {
    const res = await fetch(`${process.env.LLM_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key2}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'deepseek-flash',
        temperature: 0.7,
        max_tokens: 2500,
        effort: 'low',
        messages: [
          {
            role: 'user',
            content: `下面是今天选的 ${items.length} 篇文章标题。请写一段 100–140 字的开场按语，用在公众号推文开头。\n\n要求：\n- 说清今天这批文章的共同点或选它们的理由\n- 像一个编辑在跟读者说话，不要「本文」「小编」\n- 不要罗列标题，不要用感叹号\n- 只输出这段文字，不要引号\n\n${titles}`,
          },
        ],
        signal: AbortSignal.timeout(60000),
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const text = (j.choices?.[0]?.message?.content ?? '').trim();
      if (text.length >= 40 && text.length <= 400) {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, text);
        return text;
      }
    }
  } catch {
    /* 失败就用兜底 */
  }
  return fallback;
}

function allDay(): string | null {
  const row = getDb()
    .prepare("SELECT MAX(edition) AS d FROM articles WHERE edition <> '0000-00-00'")
    .get() as { d: string | null } | undefined;
  return row?.d ?? null;
}

export async function buildWechatArticle(): Promise<{ title: string; html: string; count: number; order: string[]; theme: string }> {
  // 用内容所在的那一期做日期（跨零点时也不会错位）
  const day = allDay() ?? todayEdition();
  const all = listArticles();
  let picks = all
    .filter((a) => !a.titleOnly && a.status !== 'meta_only')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id));
  const briefs = all.filter((a) => a.titleOnly || a.status === 'meta_only');

  // 出刊时已经生成过主题就用它，保证网页/公众号/邮件顺序一致
  const stored = readThemePlan(getDb(), day) as { title: string; theme: string; order: string[] } | null;
  let plan: { title: string; theme: string; order: string[] };
  let ordered: Article[];

  if (stored) {
    plan = stored;
    const byId = new Map(picks.map((a) => [a.id, a]));
    ordered = plan.order.map((id) => byId.get(id)).filter((x): x is Article => Boolean(x));
    for (const a of picks) if (!ordered.includes(a)) ordered.push(a);
  } else {
    const fresh = await buildThemePlan(getDb(), day, picks.map((a) => ({ id: a.id, title: a.title, hook: a.hook })));
    saveThemePlan(getDb(), day, fresh);
    const byId = new Map(picks.map((a) => [a.id, a]));
    plan = fresh;
    ordered = fresh.order.map((id) => byId.get(id)).filter((x): x is Article => Boolean(x));
    for (const a of picks) if (!ordered.includes(a)) ordered.push(a);
  }
  const intro = (plan as { intro?: string }).intro?.trim() || (await buildIntro(ordered, day));
  const title = plan.title;
  picks = ordered;

  const cover = ordered.find((a) => a.isCover) ?? null;
  const rest = ordered.filter((a) => a.id !== cover?.id);

  const coverBlock = cover
    ? `
  <section style="margin:0 0 30px;padding:0 0 26px;border-bottom:1px solid ${LINE};">
    <p style="margin:0 0 10px;font-size:12px;color:${ACCENT};letter-spacing:0.16em;">本 期 专 题</p>
    <h2 style="margin:0 0 12px;font-size:20px;line-height:1.55;color:${INK};font-weight:600;">${esc(cover.title)}</h2>
    ${cover.hook ? `<p style="margin:0 0 10px;font-size:14.5px;line-height:1.9;color:#44403c;">${esc(cover.hook)}</p>` : ''}
    ${
      cover.questions?.length
        ? `<p style="margin:0 0 10px;font-size:13px;line-height:1.9;color:${ACCENT};">${cover.questions
            .slice(0, 2)
            .map((q) => `· ${esc(q)}`)
            .join('<br/>')}</p>`
        : ''
    }
    <p style="margin:0;font-size:11.5px;color:${MUTED};">${esc(cover.account ?? '')}${cover.wordCount ? ` · ${cover.wordCount} 字` : ''}</p>
  </section>`
    : '';

  const listBlock = rest
    .map(
      (a, i) => `
  <section style="margin:0 0 26px;">
    <p style="margin:0 0 6px;font-size:12px;color:${ACCENT};letter-spacing:0.12em;">0${i + 1}</p>
    <h2 style="margin:0 0 8px;font-size:17px;line-height:1.6;color:${INK};font-weight:600;">${esc(a.title)}</h2>
    <p style="margin:0;font-size:11.5px;color:${MUTED};">${esc(a.account ?? '')}</p>
  </section>`
    )
    .join('');

  const html = `<section style="max-width:677px;margin:0 auto;padding:8px 2px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:${INK};">
  <section style="margin:0 0 26px;padding:16px 18px;background:#faf7f2;border-left:3px solid ${ACCENT};">
    <p style="margin:0;font-size:13px;line-height:1.9;color:#5c5347;">${esc(EPIGRAPH)}</p>
  </section>
  <p style="margin:0 0 18px;font-size:14px;line-height:1.9;color:#44403c;">${esc(intro).replace(/\n+/g, '<br/><br/>')}</p>
  <section style="margin:0 0 30px;padding:16px 18px;background:#faf7f2;border-left:3px solid ${ACCENT};">
    <p style="margin:0;font-size:13.5px;line-height:1.85;color:#44403c;">
      这 ${picks.length} 篇的全文，以及每篇后面都能点开问题、和 AI 接着聊——都在「阅读原文」。
    </p>
  </section>
  ${coverBlock}
  ${cover ? `<p style="margin:0 0 14px;font-size:12px;color:${MUTED};letter-spacing:0.14em;">本 期 其 他</p>` : ''}
  ${listBlock}
  <section style="margin:34px 0 0;padding-top:16px;border-top:1px solid ${LINE};">
    <p style="margin:0 0 8px;font-size:13.5px;line-height:1.85;color:#44403c;">
      如果你也想知道这些文章后面是什么，点「阅读原文」，今天的 ${ordered.length} 篇都在那里。
    </p>
    <p style="margin:0;font-size:13.5px;color:${ACCENT};">点「阅读原文」→</p>
  </section>
</section>`;

  return { title, html, count: picks.length, order: plan.order, theme: plan.theme };
}
