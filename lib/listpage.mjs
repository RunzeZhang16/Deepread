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
