/**
 * 跨源去重：把讲同一件事的标题交给模型分组，只保留分数最高的那条。
 *
 * 为什么用模型而不是字符串相似度：
 * 不同媒体写同一件事，措辞可能完全不同（「英伟达没了黄仁勋」vs「英伟达第一次没有黄仁勋」），
 * 字符相似度会漏；中文 2-gram 又会误判。模型按语义分组更准，且每天只调 1-2 次，成本可忽略。
 */

const BASE = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.LLM_MODEL || 'deepseek-flash';
const KEY = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || '';

/**
 * @param {{id:string,title:string,sourceName:string}[]} items 已按分数降序
 * @returns {Promise<Set<string>>} 需要丢弃的 id
 */
export async function findDuplicates(items) {
  const drop = new Set();
  if (items.length < 2 || !KEY) return drop;

  // 太多就不问了（成本），只处理前 30 条
  const list = items.slice(0, 30).map((it, i) => `${i}. [${it.sourceName}] ${it.title}`).join('\n');

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 6000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你判断哪些标题在讲同一件事。只输出 JSON。' },
          {
            role: 'user',
            content: `下面的标题来自不同媒体，请找出讲**同一件事**的组。

${list}

判断标准：
- 同一事件、同一篇被多方转载的文章 → 算重复
- 同一个领域、但说的是不同的事 → 不算重复
- 同一个人、不同的事件 → 不算重复

输出 {"groups":[[0,3],[5,9]]}，没有重复就输出 {"groups":[]}`,
          },
        ],
        signal: AbortSignal.timeout(90000),
      }),
    });

    if (!res.ok) return drop;
    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content ?? '';
    const text = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const obj = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

    for (const group of obj.groups ?? []) {
      if (!Array.isArray(group) || group.length < 2) continue;
      // 组内保留第一条（分数最高的），其余丢掉
      const idxs = group.filter((i) => Number.isInteger(i) && items[i]);
      for (const i of idxs.slice(1)) drop.add(items[i].id);
    }
  } catch {
    /* 模型失败就不去重，不影响出刊 */
  }

  return drop;
}
