/**
 * 列表页抓标题：给一个栏目页/首页地址，把里面的文章链接捞出来。
 * 适用于没有 RSS、但页面能直接打开（不用登录）的站点。
 */
import { JSDOM } from 'jsdom';

const NAV = /(\/about|\/login|\/register|\/search|\/tag\/|\/user|\/account|\/download|\/app\b|\/rss\b|\/feed\b)/i;

export function extractArticles(html, baseUrl, { skipNav = true } = {}) {
  let doc;
  try {
    doc = new JSDOM(html, { url: baseUrl }).window.document;
  } catch {
    return [];
  }
  const base = new URL(baseUrl);
  const seenUrl = new Set();
  const seenTitle = new Set();
  const out = [];

  for (const a of doc.querySelectorAll('a[href]')) {
    let u;
    try {
      u = new URL(a.getAttribute('href'), baseUrl);
    } catch {
      continue;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    if (u.host !== base.host) continue;

    const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (title.length < 8 || title.length > 70) continue;
    // 文章页几乎都带数字 id，导航页一般没有
    if (!/\d{4,}/.test(u.pathname + u.search)) continue;
    if (skipNav && NAV.test(u.pathname)) continue;

    const key = u.toString();
    if (seenUrl.has(key) || seenTitle.has(title)) continue;
    seenUrl.add(key);
    seenTitle.add(title);
    out.push({ title, url: key });
  }
  return out;
}

/**
 * 抓网页并正确解码。
 * 有些老站点（中国新闻周刊）是 GB2312，直接 res.text() 会变乱码。
 */
export async function fetchHtml(url, { timeout = 15000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,*/*',
      ...headers,
    },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  return decodeBody(buf, res.headers.get('content-type') ?? '');
}

/** 按 charset 解码（GBK 站点用） */
export function decodeBody(buf, contentType = '') {
  const head = buf.subarray(0, 4096).toString('latin1');
  const sniff =
    (contentType.match(/charset=["']?([\w-]+)/i) ?? head.match(/charset=["']?([\w-]+)/i))?.[1] ?? 'utf-8';
  const charset = /^gb/i.test(sniff) ? 'gbk' : sniff.toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}
