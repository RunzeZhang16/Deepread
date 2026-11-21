#!/usr/bin/env node
// 生成当期公众号封面图（900×383，2.35:1）
//
// 设计：不放标题，只放品牌。原因有两个：
//   1. 公众号列表里封面缩到 300px 宽，标题根本看不清
//   2. 标题就在封面旁边，重复一遍是浪费
// 居中而不是靠左：分享到聊天时按 1:1 居中裁切，居中构图不会被裁掉。
//
// 文字全部转成路径再栅格化，容器里没有任何系统字体也能出图。

import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import sharp from 'sharp';
import { getDb } from '../lib/db.mjs';

const W = 900;
const H = 383;
const PAPER = '#faf8f4';
const INK = '#1c1917';
const MUTED = '#8a8378';
const ACCENT = '#a8442e';
const LINE = '#e0d8ca';

const serif = opentype.loadSync(path.join(process.cwd(), 'public', 'fonts', 'NotoSerifSC-Regular.otf'));
const sans = opentype.loadSync(path.join(process.cwd(), 'public', 'fonts', 'NotoSansSC-Regular.otf'));

const db = getDb();
const edition = db
  .prepare("SELECT MAX(edition) e FROM articles WHERE edition IS NOT NULL AND edition <> '0000-00-00'")
  .get().e;
if (!edition) {
  console.error('还没有出刊');
  process.exit(1);
}

const start = process.env.ISSUE_START_EDITION || '2026-11-20';
const issueNo = db
  .prepare("SELECT COUNT(DISTINCT edition) n FROM articles WHERE edition >= ? AND edition <= ? AND edition <> '0000-00-00'")
  .get(start, edition).n;

/** 逐字排布，返回 path 数据和总宽度 */
function textPath(text, x, y, size, font, letterSpacing = 0) {
  let cursor = x;
  const parts = [];
  for (const ch of text) {
    parts.push(font.getPath(ch, cursor, y, size).toPathData(2));
    cursor += font.getAdvanceWidth(ch, size) + letterSpacing;
  }
  return { d: parts.join(' '), width: cursor - x - letterSpacing };
}

const [, m, d] = edition.split('-');
const issueText = issueNo >= 1 ? `第 ${issueNo} 期` : '试刊';
const dateText = `${Number(m)} 月 ${Number(d)} 日`;

// 中央竖排构图
const wordSize = 96;
const word = textPath('Deepread', 0, 0, wordSize, serif, -1.5);

const metaSize = 17;
const meta = textPath(`${issueText}　·　${dateText}`, 0, 0, metaSize, sans, 2.5);

const ruleW = 132;
const cx = W / 2;
const baseY = H / 2 + 6;

const parts = [];
parts.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
parts.push(`<rect x="0" y="0" width="8" height="${H}" fill="${ACCENT}"/>`);

// 顶部小菱形
const diamondY = baseY - 118;
parts.push(
  `<rect x="${cx - 6}" y="${diamondY - 6}" width="12" height="12" fill="none" stroke="${ACCENT}" stroke-width="1.3" transform="rotate(45 ${cx} ${diamondY})"/>`
);

// 品牌字（居中）
const wordX = cx - word.width / 2;
const wordY = baseY + 8;
parts.push(`<path d="${textPath('Deepread', wordX, wordY, wordSize, serif, -1.5).d}" fill="${INK}"/>`);

// 细线
const ruleY = wordY + 56;
parts.push(`<line x1="${cx - ruleW / 2}" y1="${ruleY}" x2="${cx + ruleW / 2}" y2="${ruleY}" stroke="${LINE}" stroke-width="1"/>`);

// 期号 + 日期
const metaX = cx - meta.width / 2;
const metaY = ruleY + 36;
parts.push(`<path d="${textPath(`${issueText}　·　${dateText}`, metaX, metaY, metaSize, sans, 2.5).d}" fill="${MUTED}"/>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;

const outDir = path.join(process.cwd(), 'data', 'covers');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${edition}.png`);
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
console.log(out);
