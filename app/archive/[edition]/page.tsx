import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listArticlesByEdition } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function EditionPage({ params }: { params: Promise<{ edition: string }> }) {
  const { edition } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(edition)) notFound();

  const all = listArticlesByEdition(edition);
  if (all.length === 0) notFound();

  const picks = all.filter((a) => !a.titleOnly && a.status !== 'meta_only');
  const briefs = all.filter((a) => a.titleOnly || a.status === 'meta_only');
  const [y, m, d] = edition.split('-');

  return (
    <main className="wrap">
      <header className="masthead">
        <div className="brand">
          <h1>{Number(m)} 月 {Number(d)} 日</h1>
          <span className="brand-sub">{y}</span>
        </div>
        <p className="dateline">
          <Link href="/archive" className="nav-link">
            ← 全部往期
          </Link>
        </p>
      </header>
      <div className="rule" aria-hidden="true">
        <span className="rule-dot" />
      </div>

      <div className="picks">
        {picks.map((a) => (
          <article className="pick" key={a.id}>
            <h2>
              <a href={a.url} target="_blank" rel="noreferrer noopener">
                {a.title}
              </a>
            </h2>
            {a.summary && <p className="pick-summary">{a.summary}</p>}
            <p className="pick-meta">
              {a.account && <span>{a.account}</span>}
              {a.wordCount > 0 && <span>{a.wordCount} 字</span>}
            </p>
          </article>
        ))}
      </div>

      {briefs.length > 0 && (
        <section className="briefs">
          <h2>速览</h2>
          <ul>
            {briefs.map((b) => (
              <li key={b.id}>
                <a href={b.url} target="_blank" rel="noreferrer noopener">
                  {b.title}
                </a>
                <span>{b.account}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="colophon">DEEPREAD</div>
    </main>
  );
}
