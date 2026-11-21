#!/usr/bin/env node
// 生成当期公众号封面图（900×383，2.35:1）
// 文字全部转成路径再栅格化：容器里没有任何字体也能出图。

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

const fontPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSansSC-Regular.otf');
const font = opentype.loadSync(fontPath);

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

const cover = db
  .prepare('SELECT title FROM articles WHERE edition = ? AND is_cover = 1')
  .get(edition);
const theme = (() => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`theme_${edition}`);
  try {
    return row ? JSON.parse(row.value).title : null;
  } catch {
    return null;
  }
})();

const headline = (theme || cover?.title || 'Deepread').replace(/《|》/g, '').trim();

/** 按宽度断行（中文逐字测量） */
function wrap(text, size, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (font.getAdvanceWidth(test, size) > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  // 超出行数时给最后一行加省略号
  const joined = lines.join('');
  if (joined.length < text.length) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
  }
  return lines;
}

function textPath(text, x, y, size, letterSpacing = 0) {
  let cursor = x;
  const parts = [];
  for (const ch of text) {
    const p = font.getPath(ch, cursor, y, size);
    parts.push(p.toPathData(2));
    cursor += font.getAdvanceWidth(ch, size) + letterSpacing;
  }
  return { d: parts.join(' '), width: cursor - x };
}

const [m, d] = edition.split('-').slice(1);
const titleLines = wrap(headline, 40, W - 150, 2);

const svgParts = [];
svgParts.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
svgParts.push(`<rect x="0" y="0" width="8" height="${H}" fill="${ACCENT}"/>`);
// 右上装饰：一个空心菱形 + 一条细线
svgParts.push(`<line x1="${W - 210}" y1="64" x2="${W - 56}" y2="64" stroke="#e0d8ca" stroke-width="1"/>`);
svgParts.push(
  `<rect x="${W - 132}" y="58" width="10" height="10" fill="none" stroke="${ACCENT}" stroke-width="1.2" transform="rotate(45 ${W - 127} 63)"/>`
);

// 顶部小标
const label = textPath('DEEPREAD', 56, 78, 17, 5);
svgParts.push(`<path d="${label.d}" fill="${INK}"/>`);
const issueText = issueNo >= 1 ? `第 ${issueNo} 期` : '试刊';
const issue = textPath(issueText, 56 + label.width + 20, 78, 15);
svgParts.push(`<path d="${issue.d}" fill="${ACCENT}"/>`);

// 主标题
titleLines.forEach((line, i) => {
  const p = textPath(line, 56, 190 + i * 56, 40);
  svgParts.push(`<path d="${p.d}" fill="${INK}"/>`);
});

// 底部信息
const date = textPath(`${Number(m)} 月 ${Number(d)} 日 · 每周五更新`, 56, H - 44, 15);
svgParts.push(`<path d="${date.d}" fill="${MUTED}"/>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svgParts.join('')}</svg>`;

const outDir = path.join(process.cwd(), 'data', 'covers');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${edition}.png`);
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
console.log(out);
