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
  const title = `今天值得读的 ${picks.length} 篇 · ${fmtCN(day)}`;

  // 主推 1 篇 + 其余只给标题和钩子，目的是让人点「阅读原文」
  const lead = picks[0];
  const rest = picks.slice(1);

  const leadBlock = lead
    ? `
  <section style="margin:0 0 30px;padding:0 0 26px;border-bottom:1px solid ${LINE};">
    <p style="margin:0 0 10px;font-size:12px;color:${ACCENT};letter-spacing:0.14em;">今 日 主 推</p>
    <h2 style="margin:0 0 10px;font-size:18px;line-height:1.6;color:${INK};font-weight:600;">${esc(lead.title)}</h2>
    ${
      lead.hook
        ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.9;color:#44403c;">${esc(lead.hook)}</p>`
        : ''
    }
    ${
      lead.questions?.length
        ? `<p style="margin:0 0 12px;font-size:13px;line-height:1.9;color:${ACCENT};">${lead.questions
            .slice(0, 2)
            .map((q) => `· ${esc(q)}`)
            .join('<br/>')}</p>`
        : ''
    }
    <p style="margin:0;font-size:12px;color:${MUTED};">${esc(lead.account ?? '')}${lead.wordCount ? ` · ${lead.wordCount} 字` : ''}</p>
  </section>`
    : '';

  const restBlock = rest.length
    ? `
  <section style="margin:26px 0 0;">
    <p style="margin:0 0 16px;font-size:12px;color:${MUTED};letter-spacing:0.14em;">今 天 还 有 ${rest.length} 篇</p>
    ${rest
      .map(
        (a, i) => `<section style="margin:0 0 20px;">
      <p style="margin:0 0 4px;font-size:15px;line-height:1.7;color:${INK};font-weight:600;">
        <span style="color:${ACCENT};font-size:12px;margin-right:6px;">0${i + 2}</span>${esc(a.title)}
      </p>
      ${a.hook ? `<p style="margin:0 0 2px;font-size:13.5px;line-height:1.8;color:#6b6257;">${esc(a.hook)}</p>` : ''}
      <p style="margin:0;font-size:11.5px;color:${MUTED};">${esc(a.account ?? '')}</p>
    </section>`
      )
      .join('')}
  </section>`
    : '';

  const briefBlock = briefs.length
    ? `
  <section style="margin:30px 0 0;padding-top:18px;border-top:1px solid ${LINE};">
    <p style="margin:0 0 12px;font-size:12px;color:${MUTED};letter-spacing:0.2em;">今 日 速 览</p>
    ${briefs
      .slice(0, 6)
      .map(
        (b) => `<p style="margin:0 0 9px;font-size:13px;line-height:1.7;color:#44403c;">
      <span style="color:${ACCENT};">·</span> ${esc(b.title)}
    </p>`
      )
      .join('')}
  </section>`
    : '';

  const html = `<section style="max-width:677px;margin:0 auto;padding:8px 2px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:${INK};">
  <p style="margin:0 0 24px;font-size:14px;line-height:1.9;color:#44403c;">${esc(intro)}</p>
  ${leadBlock}
  <section style="margin:0 0 26px;padding:16px 18px;background:#faf7f2;border-left:3px solid ${ACCENT};">
    <p style="margin:0;font-size:13.5px;line-height:1.8;color:#44403c;">
      这 ${picks.length} 篇的全文，以及每篇后面都能点开问题、和 AI 接着聊——都在「阅读原文」。
    </p>
  </section>
  ${restBlock}
  ${briefBlock}
  <section style="margin:34px 0 0;padding-top:16px;border-top:1px solid ${LINE};">
    <p style="margin:0 0 6px;font-size:13px;line-height:1.8;color:#44403c;">
      每篇都能点开问题，和 AI 聊这篇；每天下午 5 点更新。
    </p>
    <p style="margin:0;font-size:13.5px;color:${ACCENT};">点「阅读原文」，读今天的 ${picks.length} 篇 →</p>
  </section>
</section>`;

  return { title, html, count: picks.length };
}
