// 正文抓取与清洗：给一个 URL + HTML，返回标题/账号/字数/摘录
//
// 设计原则：只产出元数据和 ≤300 字摘录，**不保留正文**。
// 正文只在内存里活一次，用完即弃 —— 这是这个产品的合规底线。

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const EXCERPT_LEN = 300;
const MIN_BODY = 120;

// 站点 → 账号名。Readability 拿到的 byline 往往是作者，不是媒体，这里纠正。
const SITE_NAMES = {
  'qbitai.com': '量子位',
  'sspai.com': '少数派',
  'infoq.cn': 'InfoQ 中文',
  'oschina.net': '开源中国',
  'tmtpost.com': '钛媒体',
  'eeo.com.cn': '经济观察报',
  'jiemian.com': '界面新闻',
  '36kr.com': '36氪',
  'huxiu.com': '虎嗅',
  'spaces.ac.cn': '科学空间',
  'mp.weixin.qq.com': '微信公众号',
};

export function detectSite(url) {
  try {
    const host = new URL(url).hostname;
    if (host.endsWith('mp.weixin.qq.com')) return 'wechat';
    if (host.endsWith('zhihu.com')) return 'zhihu';
    if (host.endsWith('douban.com')) return 'douban';
    return 'generic';
  } catch {
    return 'generic';
  }
}

export function countWords(text = '') {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[a-zA-Z0-9]+/g) ?? []).length;
  return cjk + latin;
}

function squash(text = '') {
  return text.replace(/\s+/g, ' ').trim();
}

/** 去掉残留标签、HTML 实体、以及常见的站点头部样板 */
function cleanBody(text = '') {
  let t = squash(
    text
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
  );

  // "Matrix精选 2026年10月28日 16 分钟阅读 作者名 …" 这类头部
  const m = t.slice(0, 80).match(/分钟阅读/);
  if (m) t = t.slice(m.index + 4).trim();

  return t;
}

function pickText(doc, selectors = []) {
  for (const sel of selectors) {
    const text = squash(doc.querySelector(sel)?.textContent ?? '');
    if (text) return text;
  }
  return '';
}

function metaContent(doc, selectors = []) {
  for (const sel of selectors) {
    const v = squash(doc.querySelector(sel)?.getAttribute('content') ?? '');
    if (v) return v;
  }
  return '';
}

/** 公众号文章页有稳定结构，优先用它 */
function extractWechat(doc) {
  return {
    title: pickText(doc, ['#activity-name', 'h1.rich_media_title', 'h1']),
    account: pickText(doc, ['#js_name', '.account_nickname_inner', '.rich_media_meta_nickname']),
    body: squash(doc.querySelector('#js_content')?.textContent ?? ''),
    publishedAt: pickText(doc, ['#publish_time', 'em#publish_time']),
  };
}

/** 风控/验证页不能当正文 */
function looksBlocked(doc, body) {
  const title = squash(doc.querySelector('title')?.textContent ?? '');
  const signals = ['环境异常', '安全验证', '访问异常', '请输入验证码', 'Just a moment', 'Access denied'];
  if (signals.some((s) => title.includes(s))) return title;
  if (body.length > 0 && body.length < 80) {
    const t = squash(doc.body?.textContent ?? '');
    if (signals.some((s) => t.includes(s))) return title || '风控页';
  }
  return '';
}

/** 标题里常见的 "xxx - 少数派" 尾巴 */
function cleanTitle(title, account) {
  if (!account) return title;
  const re = new RegExp(`\\s*[-|–—]\\s*${account.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  return title.replace(re, '').trim();
}

function resolveAccount(doc, url, readability) {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* ignore */
  }
  // 已知站点优先：og:site_name 常常带副标题，byline 是作者不是媒体
  for (const [key, name] of Object.entries(SITE_NAMES)) {
    if (host === key || host.endsWith(`.${key}`)) return name;
  }
  const og = metaContent(doc, ['meta[property="og:site_name"]']);
  if (og) return og.split(/\s*[-|–—]\s*/)[0].trim();
  return squash(readability?.byline ?? '') || squash(readability?.siteName ?? '') || host;
}

function parseDateFromText(text = '') {
  const m = text.match(/(20\d{2})\s*[-年./]\s*(\d{1,2})\s*[-月./]\s*(\d{1,2})/);
  if (!m) return '';
  const iso = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : iso;
}

/** 从 Readability 的 HTML 里取段落，滤掉作者简介、推荐位、编辑署名这类噪音 */
function bodyFromContent(contentHtml, title) {
  if (!contentHtml) return '';
  try {
    const doc = new JSDOM(`<div id="__r">${contentHtml}</div>`).window.document;
    const lines = [...doc.querySelectorAll('#__r p, #__r h2, #__r h3, #__r li')]
      .map((el) => squash(el.textContent ?? ''))
      .filter((t) => t && t.length >= 25 && t !== title)
      .filter(
        (t) =>
          !/(分钟阅读|首页推荐|点击关注|关注我们|作者[:：]|来源[:：]|编辑[:：]|原标题|本文来自|扫码|微信公众号|责任编辑|写作社区|主张分享|同名|本文共|阅读约|编辑于|代表作者个人观点|仅对标题和排版)/.test(
            t
          )
      );
    return lines.join(' ');
  } catch {
    return '';
  }
}

function normalizeDate(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * @returns {{
 *   status: 'full' | 'meta_only',
 *   site: string, title: string, account: string,
 *   wordCount: number, excerpt: string, publishedAt: string | null, note?: string
 * }}
 */
export function extractFromHtml(url, html) {
  const site = detectSite(url);
  const doc = new JSDOM(html, { url }).window.document;

  let title = '';
  let account = '';
  let body = '';
  let publishedAt = '';

  if (site === 'wechat') {
    ({ title, account, body, publishedAt } = extractWechat(doc));
  }

  let readability = null;
  if (!body || body.length < 200) {
    try {
      readability = new Readability(doc, { charThreshold: 200 }).parse();
      const parsedText = squash(readability?.textContent ?? '');
      const fromParagraphs = bodyFromContent(readability?.content, title);
      const candidate = fromParagraphs.length > 200 ? fromParagraphs : parsedText;
      if (candidate.length > body.length) body = candidate;
      title = title || squash(readability?.title ?? '');
      publishedAt = publishedAt || (readability?.publishedTime ?? '');
    } catch {
      // 解析失败就走降级
    }
  }

  if (!title) {
    title = squash(metaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]'])) ||
      squash(doc.querySelector('title')?.textContent ?? '');
  }
  if (!publishedAt) {
    publishedAt = metaContent(doc, [
      'meta[property="article:published_time"]',
      'meta[name="publishdate"]',
      'meta[name="pubdate"]',
    ]);
  }
  // 最后兜底：从页面开头找 "2026-11-01 21:28" 这类日期
  if (!publishedAt) publishedAt = parseDateFromText(squash(doc.body?.textContent ?? '').slice(0, 500));
  if (!account) account = resolveAccount(doc, url, readability);

  body = cleanBody(body);
  title = cleanTitle(title, account);
  const wordCount = countWords(body);
  const blocked = looksBlocked(doc, body);

  if (!title) {
    return {
      status: 'meta_only', site, title: '', account,
      wordCount: 0, excerpt: '', publishedAt: null, note: '没有拿到标题',
    };
  }

  if (blocked || wordCount < MIN_BODY) {
    return {
      status: 'meta_only', site, title, account, wordCount,
      excerpt: '',
      publishedAt: normalizeDate(publishedAt),
      note: blocked ? `被风控拦截（${blocked}）` : `正文太短（${wordCount} 字）`,
    };
  }

  return {
    status: 'full', site, title, account, wordCount,
    excerpt: body.slice(0, EXCERPT_LEN),
    publishedAt: normalizeDate(publishedAt),
    // 完整正文，只用于当场生成导读；调用方落库前必须用 toStored() 去掉
    body,
  };
}

/** 落库前调用：剥掉正文，只留元数据 */
export function toStored(article) {
  const { body, ...rest } = article;
  return rest;
}

const BROWSER_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/** 把 Set-Cookie 里的 name=value 拼成 Cookie 头 */
function cookieHeaderFrom(res) {
  const list =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const pairs = list
    .map((c) => c.split(';')[0].trim())
    .filter((p) => p.includes('='));
  return pairs.join('; ');
}

/**
 * 抓一个 URL。
 *
 * 有些站点（如 spaces.ac.cn）第一次访问会返回 403 + Set-Cookie + 一段 JS 跳转，
 * 浏览器带 cookie 再请求一次就 200。这里做同样的重试，只重试一次。
 */
export async function fetchArticle(url, { timeoutMs = 15000 } = {}) {
  const started = Date.now();

  let res = await fetch(url, {
    headers: BROWSER_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (res.status === 403) {
    const cookie = cookieHeaderFrom(res);
    if (cookie) {
      res = await fetch(url, {
        headers: { ...BROWSER_HEADERS, Cookie: cookie },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
    }
  }

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const html = await res.text();
  const extracted = extractFromHtml(url, html);
  return { ...extracted, url, fetchedAt: new Date().toISOString(), ms: Date.now() - started };
}
