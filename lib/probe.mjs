/**
 * 探测一个地址能不能当源用：
 * 1) 先按 RSS/Atom 解析
 * 2) 不行就当列表页，从 HTML 里捞文章链接
 */
import Parser from 'rss-parser';
import { extractArticles, fetchHtml } from './listpage.mjs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

export async function probeFeed(url) {
  if (!/^https?:\/\//.test(url)) return { ok: false, error: '只支持 http / https 地址' };

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, text/html, */*' },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const body = await fetchHtml(url);

    try {
      const parsed = await new Parser({ timeout: 12000 }).parseString(body);
      const items = parsed.items ?? [];
      if (items.length > 0) {
        const dates = items
          .map((i) => new Date(i.isoDate ?? i.pubDate ?? '').getTime())
          .filter((t) => !Number.isNaN(t));
        const latest = dates.length ? new Date(Math.max(...dates)).toISOString() : null;
        return {
          ok: true,
          type: 'rss',
          title: (parsed.title ?? '').trim(),
          items: items.length,
          latest,
          sample: (items[0]?.title ?? '').slice(0, 50),
        };
      }
    } catch {
      /* 不是 RSS，继续试列表页 */
    }

    const links = extractArticles(body, url);
    if (links.length >= 3) {
      return {
        ok: true,
        type: 'html',
        title: '',
        items: links.length,
        latest: null,
        sample: links[0].title.slice(0, 50),
      };
    }

    return { ok: false, error: '既不是 RSS，也没在页面里找到文章链接' };
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : '抓取失败';
    return { ok: false, error: msg };
  }
}
