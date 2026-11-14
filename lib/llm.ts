/**
 * 导读生成（TS 包装层）
 * 实现在 llm.mjs —— 脚本（rank / build-edition）也要用，所以放在 JS 里共享。
 */

import { generateBrief as gen, hasLLM as has } from './llm.mjs';

export interface Brief {
  summary: string;
  questions: string[];
}

export type GenerateResult =
  | { ok: true; brief: Brief; model: string }
  | { ok: false; error: string };

export function hasLLM(): boolean {
  return has() as boolean;
}

export async function generateBrief(input: {
  title: string;
  account: string;
  body: string;
}): Promise<GenerateResult> {
  return (await gen(input)) as GenerateResult;
}
