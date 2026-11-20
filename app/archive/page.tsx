import Link from 'next/link';
import { listEditions } from '@/lib/store';

export const dynamic = 'force-dynamic';

function fmt(date: string) {
  const [y, m, d] = date.split('-');
  const week = ['日', '一', '二', '三', '四', '五', '六'][new Date(`${date}T00:00:00+08:00`).getDay()];
  return { main: `${Number(m)} 月 ${Number(d)} 日`, sub: `${y} · 周${week}` };
}

export default async function ArchivePage() {
  const editions = listEditions().filter((e) => e.picks > 0);

  return (
    <main className="wrap">
      <header className="masthead">
        <div className="brand">
          <h1>往期</h1>
          <span className="brand-sub">已经出过 {editions.length} 期</span>
        </div>
        <p className="dateline">
          <Link href="/" className="nav-link">
            ← 回到今天
          </Link>
        </p>
      </header>
      <div className="rule" aria-hidden="true">
        <span className="rule-dot" />
      </div>

      <ul className="archive-list">
        {editions.map((e) => {
          const f = fmt(e.edition);
          return (
            <li key={e.edition}>
              <Link href={`/archive/${e.edition}`}>
                <span className="arc-date">{f.main}</span>
                <span className="arc-meta">
                  {f.sub} · 正文 {e.picks} 篇{e.count > e.picks ? ` · 速览 ${e.count - e.picks} 条` : ''}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {editions.length === 0 && (
        <p className="empty">
          还没有往期。
          <br />
          下一期发布后，这一期就会出现在这里。
        </p>
      )}
      <div className="colophon">DEEPREAD</div>
    </main>
  );
}
