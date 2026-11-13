'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Article } from '@/lib/store';
import ChatPanel from '@/components/ChatPanel';

type Hint = { kind: 'ok' | 'err' | 'info'; text: string } | null;
type Ask = { article: Article; question: string } | null;

function today() {
  const d = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${week}`;
}

export default function Home() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [readonly, setReadonly] = useState(false);
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [titleOnly, setTitleOnly] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [enriching, setEnriching] = useState<Record<string, boolean>>({});
  const [hint, setHint] = useState<Hint>(null);
  const [pendingAsk, setPendingAsk] = useState<Ask>(null);
  const [chat, setChat] = useState<Ask>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/articles', { cache: 'no-store' });
      const data = await res.json();
      setArticles(data.articles ?? []);
      setReadonly(Boolean(data.readonly));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { picks, briefs } = useMemo(() => {
    const byScore = (a: Article, b: Article) => (b.score ?? 0) - (a.score ?? 0);
    const full = articles
      .filter((a) => !a.titleOnly && a.status !== 'meta_only')
      .sort(byScore);
    const short = articles
      .filter((a) => a.titleOnly || a.status === 'meta_only')
      .sort(byScore);
    return { picks: full, briefs: short };
  }, [articles]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = url.trim();
    if (!value || adding) return;
    setAdding(true);
    setHint({ kind: 'info', text: titleOnly ? '只抓标题和字数…' : '抓正文、写摘要、出三个问题…' });
    try {
      const res = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value, titleOnly }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || data.reason === 'duplicate') {
        setHint({ kind: 'info', text: data.message ?? '没加成功' });
        return;
      }
      setArticles((prev) => [data.article, ...prev]);
      setUrl('');
      setShowAdd(false);
      setHint({ kind: 'ok', text: `已添加：${data.article.title.slice(0, 20)}` });
    } catch {
      setHint({ kind: 'err', text: '网络错误' });
    } finally {
      setAdding(false);
    }
  }

  async function regenerate(article: Article) {
    setEnriching((s) => ({ ...s, [article.id]: true }));
    try {
      const res = await fetch(`/api/articles/${article.id}/enrich`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setArticles((prev) => prev.map((a) => (a.id === article.id ? data.article : a)));
      } else {
        setHint({ kind: 'err', text: data.message ?? '生成失败' });
      }
    } finally {
      setEnriching((s) => ({ ...s, [article.id]: false }));
    }
  }

  return (
    <div className={`layout ${chat ? 'with-chat' : ''}`}>
      <main className="wrap">
        <header className="masthead">
          <h1>Deepread</h1>
          <p className="dateline">{today()}</p>
        </header>

        {!readonly && (
          <div className="edition-tools">
            <button className="ghost" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? '收起' : '＋ 添加文章'}
            </button>
            <Link href="/recall" className="ghost">
              召回池
            </Link>
          </div>
        )}

        {showAdd && !readonly && (
          <>
            <form className="paste" onSubmit={submit}>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="粘贴文章链接"
                disabled={adding}
                autoFocus
              />
              <button type="submit" disabled={adding || !url.trim()}>
                {adding ? '处理中…' : '添加'}
              </button>
            </form>
            <label className="title-only-opt">
              <input type="checkbox" checked={titleOnly} onChange={(e) => setTitleOnly(e.target.checked)} />
              只收标题（不生成摘要和问题）
            </label>
          </>
        )}

        {hint && <div className={`hint ${hint.kind}`}>{hint.text}</div>}

        {loading ? (
          <p className="empty">加载中…</p>
        ) : (
          <>
            <section className="picks">
              {picks.map((a) => (
                <article className="pick" key={a.id}>
                  <h2>
                    <a href={a.url} target="_blank" rel="noreferrer noopener">
                      {a.title}
                    </a>
                  </h2>

                  {a.summary && <p className="pick-summary">{a.summary}</p>}

                  {a.questions && a.questions.length > 0 ? (
                    <div className="pick-qs">
                      {a.questions.map((q) => (
                        <button key={q} onClick={() => setPendingAsk({ article: a, question: q })}>
                          {q}
                        </button>
                      ))}
                    </div>
                  ) : (
                    !readonly &&
                    !a.summary && (
                      <button
                        className="ghost small"
                        disabled={enriching[a.id]}
                        onClick={() => regenerate(a)}
                      >
                        {enriching[a.id] ? '生成中…' : '生成摘要和问题'}
                      </button>
                    )
                  )}

                  {pendingAsk?.article.id === a.id && (
                    <div className="ask-confirm">
                      <span>要不要让 DeepSeek 帮你想想这个问题？</span>
                      <div className="ask-actions">
                        <button
                          className="yes"
                          onClick={() => {
                            setChat(pendingAsk);
                            setPendingAsk(null);
                          }}
                        >
                          好，问一下
                        </button>
                        <button className="no" onClick={() => setPendingAsk(null)}>
                          不用，我去读原文
                        </button>
                      </div>
                    </div>
                  )}

                  <p className="pick-meta">
                    {a.account && <span>{a.account}</span>}
                    {a.wordCount > 0 && <span>{a.wordCount} 字</span>}
                  </p>
                </article>
              ))}
            </section>

            {briefs.length > 0 && (
              <section className="briefs">
                <h2>今日速览</h2>
                <ul>
                  {briefs.map((b) => (
                    <li key={b.id}>
                      <a href={b.url} target="_blank" rel="noreferrer noopener">
                        {b.title}
                      </a>
                      {b.account && <span>{b.account}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {picks.length === 0 && briefs.length === 0 && (
              <p className="empty">
                今天还没有内容。
                <br />
                去召回池挑几篇。
              </p>
            )}
          </>
        )}

        <footer className="colophon">Deepread · 每天读点好的</footer>
      </main>

      {chat && (
        <ChatPanel article={chat.article} initialQuestion={chat.question} onClose={() => setChat(null)} />
      )}
    </div>
  );
}
