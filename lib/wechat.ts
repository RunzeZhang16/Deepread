import { getDb } from './db';
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

/** 用今天的钩子生成一个有吸引力但不标题党的标题 */
async function buildTitle(items: Article[], day: string): Promise<string> {
  const key = `wechat_title_${day}`;
  const hit = cached(key);
  if (hit) return hit;

  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || '';
  const fallback = `今天这 ${items.length} 篇，值得慢慢读`;
  if (!apiKey) return fallback;

  const lines = items
    .map((a) => `- ${a.title}${a.hook ? `（${a.hook}）` : ''}`)
    .join('\n');

  try {
    const res = await fetch(`${process.env.LLM_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'deepseek-flash',
        temperature: 0.8,
        max_tokens: 2000,
        effort: 'low',
        messages: [
          {
            role: 'user',
            content: `给今天的公众号推文起一个标题。\n\n今天的内容：\n${lines}\n\n要求：\n- 12–20 个字\n- 有点好奇心，但不要标题党：不用「震惊」「必看」「99%的人不知道」\n- 不用感叹号，不堆问号\n- 不要罗列数字清单式标题（如「8 篇好文推荐」）\n- 可以概括一个共同的气质或矛盾\n- 只输出标题本身，不要引号\n`,
          },
        ],
        signal: AbortSignal.timeout(60000),
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const text = (j.choices?.[0]?.message?.content ?? '').trim().replace(/^["「『]|["」』]$/g, '');
      if (text.length >= 6 && text.length <= 30) {
        save(key, text);
        return text;
      }
    }
  } catch {
    /* 用兜底 */
  }
  return fallback;
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

export async function buildWechatArticle(): Promise<{ title: string; html: string; count: number }> {
  const day = todayEdition();
  const all = listArticles();
  const picks = all.filter((a) => !a.titleOnly && a.status !== 'meta_only');
  const briefs = all.filter((a) => a.titleOnly || a.status === 'meta_only');

  const intro = await buildIntro(picks, day);
  const title = await buildTitle(picks, day);

  const listBlock = picks
    .map(
      (a, i) => `
  <section style="margin:0 0 26px;">
    <p style="margin:0 0 6px;font-size:12px;color:${ACCENT};letter-spacing:0.12em;">0${i + 1}</p>
    <h2 style="margin:0 0 8px;font-size:17px;line-height:1.6;color:${INK};font-weight:600;">${esc(a.title)}</h2>
    ${a.hook ? `<p style="margin:0 0 6px;font-size:14px;line-height:1.85;color:#44403c;">${esc(a.hook)}</p>` : ''}
    <p style="margin:0;font-size:11.5px;color:${MUTED};">${esc(a.account ?? '')}</p>
  </section>`
    )
    .join('');

  const html = `<section style="max-width:677px;margin:0 auto;padding:8px 2px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:${INK};">
  <section style="margin:0 0 26px;padding:16px 18px;background:#faf7f2;border-left:3px solid ${ACCENT};">
    <p style="margin:0;font-size:13px;line-height:1.9;color:#5c5347;">${esc(EPIGRAPH)}</p>
  </section>
  <p style="margin:0 0 30px;font-size:14px;line-height:1.9;color:#44403c;">${esc(intro)}</p>
  ${listBlock}
  <section style="margin:6px 0 0;padding:16px 18px;background:#faf7f2;border-left:3px solid ${ACCENT};">
    <p style="margin:0;font-size:13.5px;line-height:1.85;color:#44403c;">
      这 ${picks.length} 篇的全文，以及每篇后面都能点开问题、和 AI 接着聊——都在「阅读原文」。
    </p>
  </section>
  <section style="margin:34px 0 0;padding-top:16px;border-top:1px solid ${LINE};">
    <p style="margin:0 0 8px;font-size:13.5px;line-height:1.85;color:#44403c;">
      如果你也想知道这些文章后面是什么，点「阅读原文」，今天的 ${picks.length} 篇都在那里。
    </p>
    <p style="margin:0;font-size:13.5px;color:${ACCENT};">点「阅读原文」→</p>
  </section>
</section>`;

  return { title, html, count: picks.length };
}
