import Parser from 'rss-parser';
const parser = new Parser({ timeout: 12000 });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const urls = process.argv.slice(2);
const results = [];
let i = 0;
async function worker() {
  while (i < urls.length) {
    const url = urls[i++];
    const started = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
      if (!res.ok) { results.push({ url, ok: false, err: 'HTTP ' + res.status }); continue; }
      const xml = await res.text();
      const p = await parser.parseString(xml);
      const items = p.items ?? [];
      const dates = items.map(it => new Date(it.isoDate ?? it.pubDate ?? '').getTime()).filter(t => !isNaN(t));
      const latest = dates.length ? new Date(Math.max(...dates)) : null;
      const days = latest ? Math.round((Date.now() - latest.getTime()) / 86400000) : null;
      results.push({ url, ok: true, items: items.length, latest: latest ? latest.toISOString().slice(0,10) : null, days, ms: Date.now() - started, sample: (items[0]?.title ?? '').slice(0, 40) });
    } catch (e) {
      results.push({ url, ok: false, err: e.message.slice(0, 40) });
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
for (const r of results) {
  if (r.ok) console.log(`${String(r.items).padStart(3)} 条  最新${String(r.days).padStart(3)}天前  ${r.ms}ms  ${r.url}  | ${r.sample}`);
  else console.log(`  ✗                ${r.err.padEnd(14)}  ${r.url}`);
}
