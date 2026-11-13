/**
 * 导读生成：一句话推荐 + 摘要 + 一个问题
 *
 * 用的是 DeepSeek 的 OpenAI 兼容接口。没有 key 时返回错误，调用方自己决定降级。
 * 正文只在这里的内存里经过一次，不落库。
 */

export interface Brief {
  summary: string;
  questions: string[];
}

export type GenerateResult =
  | { ok: true; brief: Brief; model: string }
  | { ok: false; error: string };

const BASE = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.LLM_MODEL || 'deepseek-flash';
// 推理模型会先花 token 思考，输出预算要留够
const KEY = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || '';

export function hasLLM(): boolean {
  return Boolean(KEY) || process.env.LLM_MOCK === '1';
}

function buildPrompt(title: string, account: string, body: string): string {
  return `你在给一个「每日精选」栏目写导读。读者是普通中文读者，可能完全不懂这篇文章所在的行业。

【标题】${title}
【来源】${account || '未知'}
【正文】（可能被截断）
${body.slice(0, 6000)}

只输出 JSON，不要任何解释：
{
  "summary": "100–120 字，讲清这篇文章说了什么、最有价值的那一点是什么。只陈述，不评价",
  "questions": ["问题一", "问题二", "问题三"]
}

问题数量：**1–3 个，服从质量**。如果这篇文章只撑得起一个问题，就给一个；如果问不出好问题，给空数组 []。宁可少问，也不要凑数。

问题的硬性要求（最重要，请严格遵守）：
1. 正好三个问题，每个不超过 25 个字
2. 站在一个**完全不懂行**的读者角度提问，用大白话。必须用术语时，把解释写进问题里（例如「什么是 A 股？」）
3. 三个问题都要围绕这篇文章的**主题**，不要问文中的枝节
   —— 比如一篇讲具身智能的文章，问题应该围绕具身智能，而不是里面顺带提到的「世界模型」
4. 由浅入深：第一个最基础（这是什么 / 为什么会有），后面问原因、机制或影响
5. 必须是完整的疑问句，读起来通顺，不能是陈述句
6. 答案必须能在正文里找到
7. **不要问正文没涉及的内容**。比如一篇讲陆游和唐琬的文章，问「为什么这故事不如《罗密欧与朱丽叶》出名」就是废话——正文根本没比较过
8. 不要用「启示」「意义」「怎么看」这类空泛问法

好例子（一篇讲 A 股三季报的文章）：
["什么是 A 股？", "为什么材料的利润在涨？", "为什么房地产在亏钱？"]

坏例子：
- 术语堆砌、还在陈述：「材料板块净利大增 54%，为何其中含低基数与锂价 Q3 回落的风险？」
- 拿正文没提的东西做比较：「为什么这个故事不如《罗密欧与朱丽叶》出名？」
- 空泛：「这篇文章对我们有什么启示？」

summary 要求：
- 不要以「本文」「这篇文章」「作者」开头
- 遇到行业术语，先用一句大白话带过，再往下说`;
}

/** 去掉 ```json 包裹，截取第一个完整的 {...} */
function parseJson(raw: string): unknown {
  const text = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('返回里没有 JSON');
  return JSON.parse(text.slice(start, end + 1));
}

function validate(obj: unknown): Brief {
  const o = obj as Record<string, unknown>;
  const summary = String(o.summary ?? '').trim();
  const rawQuestions = Array.isArray(o.questions) ? o.questions : [];

  if (summary.length < 40 || summary.length > 220) throw new Error(`summary 长度不合适（${summary.length}）`);
  if (/^本文|^这篇文章|^作者/.test(summary)) throw new Error('summary 用了「本文」开头');

  const questions = rawQuestions
    .map((q) => String(q ?? '').trim())
    .filter((q) => {
      if (q.length < 4 || q.length > 40) return false;
      // 必须像疑问句
      if (!/[？?]$/.test(q) && !/^(为什么|什么是|怎么|如何|哪|是否|会不会|能不能)/.test(q)) return false;
      return true;
    })
    .slice(0, 3);

  return { summary, questions };
}

function mockBrief(account: string): Brief {
  return {
    summary:
      '（演示摘要）这里会是 100–120 字的正文摘要，讲清文章说了什么、最有价值的那一点是什么。当前没有配置模型 key，所以显示占位文本。',
    questions: ['这篇文章在讲什么？', '为什么会这样？', '这件事会影响谁？'],
  };
}

export async function generateBrief(input: {
  title: string;
  account: string;
  body: string;
}): Promise<GenerateResult> {
  const { title, account, body } = input;

  if (body.trim().length < 300) {
    return { ok: false, error: '正文太短，没法生成导读' };
  }

  if (process.env.LLM_MOCK === '1') {
    return { ok: true, brief: mockBrief(account), model: 'mock' };
  }

  if (!KEY) {
    return { ok: false, error: '没有配置 DEEPSEEK_API_KEY' };
  }

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是一个中文科技与文化栏目的编辑，擅长把专业内容讲给外行听，并且能提出普通人真正会问的问题。你只输出 JSON。',
          },
          { role: 'user', content: buildPrompt(title, account, body) },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return { ok: false, error: `模型返回 ${res.status}：${detail}` };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    const brief = validate(parseJson(content));
    return { ok: true, brief, model: MODEL };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '生成失败' };
  }
}
