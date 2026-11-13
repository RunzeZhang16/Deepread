#!/usr/bin/env node
// 一键发布：构建 → 打包 → 部署到腾讯云云托管
//
// 用法：npm run publish

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'deepread-d8gkfd01397d4c645';
const SERVICE = 'deepread';
const URL = 'https://deepread-341698-13-1301865008.sh.run.tcloudbase.com';

const CLI_ENV = {
  ...process.env,
  NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS || '/etc/ssl/cert.pem',
  npm_config_registry: 'https://registry.npmmirror.com',
  npm_config_cache: path.join(ROOT, '.npm-cache'),
  HOME: path.join(ROOT, '.tcb-home'),
  CI: '1',
};

function run(cmd, args, { input, cwd = ROOT, env = CLI_ENV } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'inherit', 'inherit'] });
    if (input) child.stdin.end(input);
    else child.stdin.end();
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))));
  });
}

async function readKey() {
  const raw = await fs.readFile(path.join(ROOT, '.env.local'), 'utf8').catch(() => '');
  const m = raw.match(/^DEEPSEEK_API_KEY=(.+)$/m);
  if (!m) throw new Error('.env.local 里没有 DEEPSEEK_API_KEY');
  return m[1].trim();
}

async function stat() {
  const d = JSON.parse(await fs.readFile(path.join(ROOT, 'data/articles.json'), 'utf8'));
  const arts = d.articles ?? [];
  const full = arts.filter((a) => !a.titleOnly).length;
  return { total: arts.length, full, briefs: arts.length - full };
}

function fingerprint(articles) {
  const titles = (articles ?? []).map((a) => a.title).sort().join('|');
  return crypto.createHash('sha1').update(titles).digest('hex').slice(0, 8);
}

/** 轮询线上，直到内容和本地一致 */
async function waitLive(expected, timeoutMs = 15 * 60 * 1000) {
  const started = Date.now();
  console.log('\n④ 等待上线…');
  while (Date.now() - started < timeoutMs) {
    const mins = Math.round((Date.now() - started) / 60000);
    try {
      const res = await fetch(`${URL}/api/articles`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const j = await res.json();
        if (fingerprint(j.articles) === expected) return true;
      }
    } catch {
      /* 部署过程中可能 502/503，忽略 */
    }
    process.stdout.write(`   已等 ${mins} 分钟…\n`);
    await new Promise((r) => setTimeout(r, 20000));
  }
  return false;
}

async function main() {
  const key = await readKey();
  const s = await stat();
  console.log(`\n准备发布：正文 ${s.full} 篇 · 速览 ${s.briefs} 条\n`);

  console.log('① 构建…');
  await run('npx', ['next', 'build']);

  console.log('\n② 打包…');
  const dist = path.join(ROOT, 'deploy');
  await fs.rm(dist, { recursive: true, force: true });
  await fs.mkdir(path.join(dist, 'data'), { recursive: true });
  for (const dir of ['app', 'components', 'lib', 'config']) {
    await fs.cp(path.join(ROOT, dir), path.join(dist, dir), { recursive: true });
  }
  for (const f of ['package.json', 'package-lock.json', 'next.config.mjs', 'tsconfig.json', 'Dockerfile', '.dockerignore']) {
    await fs.copyFile(path.join(ROOT, f), path.join(dist, f));
  }
  await fs.copyFile(path.join(ROOT, 'data/articles.json'), path.join(dist, 'data/articles.json'));
  console.log('   deploy/ 已生成');

  console.log('\n③ 部署到云托管（约 5–8 分钟）…\n');
  const envParams = JSON.stringify({ DEEPSEEK_API_KEY: key, READONLY: '1' });
  await run('npx', [
    '-p', '@cloudbase/cli', 'tcb', 'cloudrun', 'deploy',
    '--env-id', ENV_ID,
    '--service-name', SERVICE,
    '--source', './deploy',
    '--port', '3000',
    '--env-params', envParams,
    '--force',
  ], { input: '\n' });

  const localFp = fingerprint(JSON.parse(await fs.readFile(path.join(ROOT, 'data/articles.json'), 'utf8')).articles);
  const live = await waitLive(localFp);

  if (live) {
    console.log(`\n✓ 已上线：${URL}\n`);
  } else {
    console.log(`\n⚠ 15 分钟还没等到新版本生效。\n  去控制台看：https://tcb.cloud.tencent.com/dev?envId=${ENV_ID}\n  或查构建日志：tcb cloudrun logs build --env-id ${ENV_ID} --service-name ${SERVICE}\n`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`\n✗ 发布失败：${e.message}\n`);
  process.exit(1);
});
