#!/usr/bin/env node
// 精排：给召回池里的候选打分（0-100），判断"值不值得一个普通读者花 10 分钟读完"
//
// 用法：npm run rank
// 只处理还没打分的条目，重复跑不会重复花钱。

import fs from 'node:fs/promises';
import path from 'node:path';

const DB = path.join(process.cwd(), 'data', 'candidates.json');
const KEY = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || '';
const BASE = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.LLM_MODEL_RANK || process.env.LLM_MODEL || 'deepseek-flash';
const BATCH = 12;
const CONCURRENCY = 4;

const SYSTEM = `你是一个中文深度阅读栏目的主编，栏目定位是**给普通读者**的每日精选（不是技术社区，不是行业媒体）。

读者画像：受过教育、愿意读长文，但**不写代码、不做技术工作、没有行业背景**。他关心的是"这件事对我意味着什么"，不是"这个系统怎么实现"。

你的判断标准（按重要性排序）：
1. **大众可读**：一个不写代码的人也能读懂，并且觉得跟自己有关
2. 讲清了一个具体问题，有事实、有细节、有因果，不是泛泛而谈
3. 有作者自己的观察或判断，不是通稿、不是资料汇编
4. 读完能让人知道一件原来不知道的事，或者改变一个看法
5. 时长合适：能撑起 10 分钟阅读（大约 2000 字以上）

**明确扣分（重要）**：
- 技术实战类：源码级解析、架构设计、运维部署、性能调优、框架对比、故障排查、工程踩坑——这类文章只有同行能看懂，**一律不超过 55 分**
- 术语密集，需要行业背景才能读懂的
- 快讯、发布会、融资消息、产品上架、销量战报
- 标题党、内容空洞的行业综述
- 纯教程、操作步骤
- 情绪化评论、蹭热点

**加分情形**：
- 技术话题但讲的是"对人的影响"：比如 AI 抢走了哪些工作、某个技术为什么会失败、普通人该担心什么——这类照样可以高分
- 人文、社科、商业、生活中的具体观察

你只输出 JSON。`;

function buildUser(items) {
  const list = items.map((it, i) => ({
    i,
    source: it.sourceName,
    title: it.title,
    summary: (it.summary || '').slice(0, 120),
  }));
  return `下面是 ${items.length} 条候选文章，请逐条打分。

${JSON.stringify(list, null, 1)}

打分区间参考：
- 85-100：今天必读，普通人读完会记住
- 70-84：值得读，有干货但偏专业
- 50-69：可以跳过（技术实战、行业细节）
- 0-49：不值得读（快讯、通稿、水文）

只输出 JSON，不要解释：
{"scores":[{"i":0,"score":86,"reason":"不超过20字的理由"}]}`;
}

function parseScores(raw, n) {
  const text = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const obj = JSON.parse(text.slice(start, end + 1));
  const arr = Array.isArray(obj.scores) ? obj.scores : [];
  const out = new Map();
  for (const s of arr) {
    const i = Number(s.i);
    const score = Number(s.score);
    if (!Number.isInteger(i) || i < 0 || i >= n) continue;
    if (!Number.isFinite(score)) continue;
    out.set(i, {
      score: Math.max(0, Math.min(100, Math.round(score))),
      reason: String(s.reason ?? '').slice(0, 40),
    });
  }
  return out;
}

async function scoreBatch(items) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 4000,
      effort: 'low',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUser(items) },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? '';
  return parseScores(content, items.length);
}

async function main() {
  if (!KEY) {
    console.error('缺少 DEEPSEEK_API_KEY（写在 .env.local 里）');
    process.exit(1);
  }

  const data = JSON.parse(await fs.readFile(DB, 'utf8'));
  const items = data.items ?? [];
  const todo = items.filter((i) => i.status === 'new' && typeof i.score !== 'number');

  if (todo.length === 0) {
    console.log('没有需要打分的条目。');
    return;
  }

  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));

  console.log(`\n待打分 ${todo.length} 条，分 ${batches.length} 批，开始…\n`);

  const scoreById = new Map();
  let done = 0;

  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const batch = batches[cursor++];
      const idx = cursor;
      try {
        const scores = await scoreBatch(batch);
        let hit = 0;
        scores.forEach((v, i) => {
          const target = batch[i];
          if (!target) return;
          scoreById.set(target.id, v);
          hit++;
        });
        done += hit;
        console.log(`[ OK ] 第 ${idx}/${batches.length} 批  ${hit}/${batch.length} 条`);
      } catch (e) {
        console.log(`[FAIL] 第 ${idx}/${batches.length} 批  ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  let updated = 0;
  for (const it of items) {
    const s = scoreById.get(it.id);
    if (s) {
      it.score = s.score;
      it.reason = s.reason;
      updated++;
    }
  }
  data.items = items;
  data.rankedAt = new Date().toISOString();
  await fs.writeFile(DB, JSON.stringify(data, null, 2));

  const ranked = items.filter((i) => typeof i.score === 'number').sort((a, b) => b.score - a.score);
  console.log(`\n—— 完成 —— 本次打分 ${updated} 条，累计已评分 ${ranked.length} 条\n`);
  console.log('前 15 名：');
  for (const it of ranked.slice(0, 15)) {
    console.log(`  ${String(it.score).padStart(3)}  ${it.sourceName.padEnd(10, ' ')} ${it.title.slice(0, 44)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
