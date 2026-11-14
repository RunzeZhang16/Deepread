/**
 * 清掉标题尾巴上媒体自己加的站名后缀，保留有信息量的副标题。
 * 例：
 *   透视A股三季报：…｜看财报-钛媒体官方网站   → 透视A股三季报：…
 *   简单谈谈K3的MoE和Attention - 科学空间|Scientific Spaces → 简单谈谈K3的MoE和Attention
 *   赌具身智能没有未来的人 | 对谈伯克利Allen Yang博士-钛媒体官方网站 → … | 对谈伯克利Allen Yang博士
 */

const SITE_WORDS = /(官方网站|官网|网站|首页|博客|Blog|blog|Spaces|周刊|日报|时报|晚报|网)$/;

function isSiteLike(x, site) {
  const s = x.replace(/\s+/g, '');
  if (!s) return true;
  if (site && (s.includes(site) || site.includes(s))) return true;
  if (SITE_WORDS.test(s) && s.length <= 20) return true;
  if (s.length <= 8 && !/[：:，,。？！?!]/.test(s)) return true;
  return false;
}

const TRAILING_COUNT = /\s+\d{3,7}\s*$/;

export function cleanTitle(raw, account = '') {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const site = String(account || '').replace(/\s+/g, '');

  // 去掉尾巴上的「阅读数 + 相对时间」（第一财经常见：16513 8小时前）
  t = t.replace(/\s+\d+\s*(秒|分钟|小时|天)前\s*$/, '').trim();
  t = t.replace(TRAILING_COUNT, '').trim();

  // 前缀式站名：“科学网-中国空间站…” / “钛媒体 | xxx”
  if (site) {
    const esc = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`^${esc}\\s*[-–—_|｜：:]\\s*`), '');
  }
  t = t.replace(/^([^-–—_|｜：:]{2,10})\s*[-–—_]\s*(?=\S)/, (m, head) =>
    /(网|站|媒体|博客|日报|周刊)$/.test(head) ? '' : m
  );

  // 先把“-钛媒体官方网站”这种尾巴从每一段里削掉
  if (site) {
    const esc = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`\\s*[-–—_]\\s*${esc}(官方)?(网站|官网|首页)?\\s*(?=$|[|｜])`, 'g'), '');
    t = t.replace(new RegExp(`\\s*[|｜]\\s*${esc}(官方)?(网站|官网|首页)?\\s*$`, 'g'), '');
  }
  t = t.replace(/\s*[-–—_]\s*[^-–—_|｜]{0,12}(官方网站|官网)\s*$/g, '').trim();

  // 再按分隔符从右往左，剥掉纯站名段
  const parts = t.split(/\s*[|｜]\s*/).map((p) => p.trim()).filter(Boolean);
  while (parts.length > 1 && isSiteLike(parts[parts.length - 1], site)) parts.pop();

  let out = parts.join(' | ');

  // 最后处理 “标题 - 站名” 的形式
  const dm = out.match(/^(.*?)\s+[-–—_]\s+([^-–—_|｜]{1,24})$/);
  if (dm && isSiteLike(dm[2], site) && dm[1].length >= 6) out = dm[1].trim();

  return out;
}
