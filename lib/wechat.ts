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

  const card = (a: Article, idx: number) => `
  <section style="margin:0 0 30px;">
    <p style="margin:0 0 8px;font-size:12px;color:${ACCENT};letter-spacing:0.12em;">0${idx + 1}</p>
    <h2 style="margin:0 0 10px;font-size:17px;line-height:1.6;color:${INK};font-weight:600;">
      ${esc(a.title)}
    </h2>
    ${a.summary ? `<p style="margin:0 0 10px;font-size:14px;line-height:1.9;color:#44403c;">${esc(a.summary)}</p>` : ''}
    ${
      a.questions?.length
        ? `<p style="margin:0 0 8px;font-size:13px;line-height:1.8;color:${ACCENT};">${a.questions
            .slice(0, 2)
            .map((q) => `· ${esc(q)}`)
            .join('<br/>')}</p>`
        : ''
    }
    <p style="margin:0;font-size:12px;color:${MUTED};">${esc(a.account ?? '')}${a.wordCount ? ` · ${a.wordCount} 字` : ''}</p>
  </section>`;

  const briefBlock = briefs.length
    ? `
  <section style="margin:36px 0 0;padding-top:18px;border-top:1px solid ${LINE};">
    <p style="margin:0 0 12px;font-size:12px;color:${MUTED};letter-spacing:0.2em;">今 日 速 览</p>
    ${briefs
      .map(
        (b) => `<p style="margin:0 0 9px;font-size:13px;line-height:1.7;color:#44403c;">
      <span style="color:${ACCENT};">·</span> ${esc(b.title)}
      <span style="color:${MUTED};font-size:11px;">　${esc(b.account ?? '')}</span>
    </p>`
      )
      .join('')}
  </section>`
    : '';

  const html = `<section style="max-width:677px;margin:0 auto;padding:8px 2px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:${INK};">
  <p style="margin:0 0 22px;font-size:14px;line-height:1.9;color:#44403c;">${esc(intro)}</p>
  ${picks.map(card).join('')}
  ${briefBlock}
  <section style="margin:34px 0 0;padding-top:16px;border-top:1px solid ${LINE};">
    <p style="margin:0 0 6px;font-size:13px;line-height:1.8;color:#44403c;">
      每篇都能点开问题，和 AI 聊这篇；每天下午 5 点更新。
    </p>
    <p style="margin:0;font-size:13px;color:${ACCENT};">完整版和对话在「阅读原文」里 →</p>
  </section>
</section>`;

  return { title, html, count: picks.length };
}
