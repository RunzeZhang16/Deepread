// 召回源：只负责"把候选捞进来"，不做质量判断（质量交给精排）
// category 只是给个默认归类，后面由 Jev 重新判

export const feeds = [
  { id: 'qbitai',   name: '量子位',     category: '科技', url: 'https://www.qbitai.com/feed',     weight: 70, enabled: true },
  { id: 'sspai',    name: '少数派',     category: '科技', url: 'https://sspai.com/feed',           weight: 70, enabled: true },
  { id: 'infoq',    name: 'InfoQ 中文', category: '科技', url: 'https://www.infoq.cn/feed',        weight: 75, enabled: true },
  { id: 'tmtpost',  name: '钛媒体',     category: '科技', url: 'https://www.tmtpost.com/rss',      weight: 65, enabled: true },
  { id: 'oschina',  name: '开源中国',   category: '科技', url: 'https://www.oschina.net/news/rss', weight: 60, enabled: true },
  { id: 'geekpark', name: '极客公园',   category: '科技', url: 'https://www.geekpark.net/rss',     weight: 65, enabled: true },
  { id: 'ifanr',    name: '爱范儿',     category: '科技', url: 'https://www.ifanr.com/feed',       weight: 55, enabled: true },
  { id: 'ithome',   name: 'IT之家',     category: '科技', url: 'https://www.ithome.com/rss/',      weight: 50, enabled: true },
  { id: 'eeo',      name: '经济观察报', category: '经济', url: 'http://www.eeo.com.cn/rss.xml',    weight: 80, enabled: true },
];

// 标题里出现就丢掉（召回阶段只挡明显垃圾，别挡太狠）
export const titleBlocklist = [
  '融资', '涨停', '股价', '官宣', '恋情', '热搜',
  '直播带货', '双十一', '优惠券', '促销', '发布会回顾',
  '净利润', '营业收入', '中标', '集采', '答记者问', '辟谣',
  '涨停板', '开盘', '收盘', '涨幅', '跌幅',
  '涨价', '降价', '停产', '优惠', '抽奖', '免费送',
];

// 只要近两周内发布的
export const MAX_AGE_DAYS = 14;

/**
 * 明显不是「可读文章」的链接：播客、电台、音视频页。
 * 这个产品只推荐能读的文字，音频节目直接不收。
 */
const NON_ARTICLE_PATTERNS = [
  /gcores\.com\/radios\//i,        // 机核电台
  /xiaoyuzhoufm\.com\/episode/i,    // 小宇宙
  /podcasts\.apple\.com/i,          // Apple Podcasts
  /ximalaya\.com/i,                 // 喜马拉雅
  /qingting\.fm/i,                  // 蜻蜓 FM
  /lizhi\.fm/i,                     // 荔枝
  /\/podcast\//i,
  /\/episode\//i,
  /\/radios?\//i,
  /\/audio\//i,
];

export function isNonArticleUrl(url) {
  return NON_ARTICLE_PATTERNS.some((re) => re.test(String(url)));
}

// 源级黑名单：命中就不抓（这些站是 AI 生成的二手解读，不是原创内容）
export const blockedSources = [
  { name: /AI\s*解读/i, reason: 'AI 生成的解读站' },
  { name: /听说了吗/, reason: 'AI 生成的解读站' },
  { host: 'anymesgs.com', reason: 'AI 生成的解读站' },
];

export function isBlockedSource(feed) {
  for (const rule of blockedSources) {
    if (rule.name && rule.name.test(feed.name)) return rule.reason;
    if (rule.host) {
      try {
        if (new URL(feed.url).host.endsWith(rule.host)) return rule.reason;
      } catch {}
    }
  }
  return null;
}
