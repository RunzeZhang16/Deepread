/**
 * 和文章对话。
 *
 * 正文不落库，所以每次对话按需重新抓取，进程内缓存 30 分钟。
 * 缓存只在内存里，重启即消失。
 */

import { fetchArticle } from './extract.mjs';

const KEY = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || '';
const BASE = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.LLM_MODEL_CHAT || process.env.LLM_MODEL || 'deepseek-flash';

interface CacheEntry {
  body: string;
  title: string;
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const TTL = 30 * 60 * 1000;

async function loadArticle(url: string): Promise<CacheEntry | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < TTL) return hit;

  try {
    const a = (await fetchArticle(url)) as { status?: string; body?: string; title?: string };
    if (a.status !== 'full' || !a.body) return null;
    const entry: CacheEntry = { body: a.body, title: a.title ?? '', ts: Date.now() };
    cache.set(url, entry);
    return entry;
  } catch {
    return null;
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function askAboutArticle(input: {
  url: string;
  title: string;
  messages: ChatMessage[];
}): Promise<{ ok: true; answer: string } | { ok: false; error: string }> {
  if (!KEY) return { ok: false, error: '没有配置 DEEPSEEK_API_KEY' };

  const article = await loadArticle(input.url);
  if (!article) return { ok: false, error: '这篇没抓到正文，暂时没法对话' };

  const system = `你是读者的阅读助手。下面是《${article.title || input.title}》的正文（可能被截断）。

规则：
1. 只根据这篇文章回答；文中没有的，直接说「文章里没提到」
2. 用大白话，避免术语；必须用术语时先解释
3. 回答控制在 150 字以内，先给结论
4. 不要复述问题，不要说「根据文章」

【正文】
${article.body.slice(0, 9000)}`;

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.5,
        max_tokens: 2500,
        messages: [
          { role: 'system', content: system },
          ...input.messages.slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 800) })),
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      return { ok: false, error: `模型返回 ${res.status}：${detail}` };
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = json.choices?.[0]?.message?.content?.trim();
    if (!answer) return { ok: false, error: '模型没有返回内容' };
    return { ok: true, answer };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '对话失败' };
  }
}
