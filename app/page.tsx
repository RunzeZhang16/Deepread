'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Article } from '@/lib/store';
import ChatPanel from '@/components/ChatPanel';
import { track } from '@/lib/track';
import { getRead, getSaved, markRead, toggleSaved } from '@/lib/local';
import SubscribeForm from '@/components/SubscribeForm';

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
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);

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
    track('page_view');
    setSavedIds(getSaved().map((x) => x.id));
    setReadIds(Object.keys(getRead()));
  }, [load]);

  function onSave(a: { id: string; title: string; url: string; account?: string | null }) {
    const now = toggleSaved({ id: a.id, title: a.title, url: a.url, account: a.account ?? undefined });
    track(now ? 'save_click' : 'unsave_click', { id: a.id });
    setSavedIds(getSaved().map((x) => x.id));
  }

  function onOpen(a: { id: string }) {
    markRead(a.id);
    setReadIds(Object.keys(getRead()));
  }

  const { picks, briefs } = useMemo(() => {
    // 保持接口返回的顺序（服务端已按主题贴合度排好），这里再排序就会和前面对不上
    const full = articles.filter((a) => !a.titleOnly && a.status !== 'meta_only');
    const short = articles
      .filter((a) => a.titleOnly || a.status === 'meta_only')
      .sort((a: Article, b: Article) => (b.score ?? 0) - (a.score ?? 0));
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
    <div className="layout">
      <main className="wrap">
        <header className="masthead">
          <div className="brand">
            <h1>Deepread</h1>
            <span className="brand-sub">精选优质媒体文章 · 个人博客</span>
          </div>
          <p className="dateline">
            <Link href="/archive" className="nav-link">
              往期
            </Link>
            <span className="nav-sep">·</span>
            <Link href="/saved" className="nav-link">
              收藏
            </Link>
            <span className="nav-sep">·</span>
            <a href="#subscribe" className="nav-link">
              邮件
            </a>
            <span className="nav-sep">·</span>
            {today()}
          </p>
        </header>
        <div className="rule" aria-hidden="true">
          <span className="rule-dot" />
        </div>

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
            <section className="picks" id="picks">
              {picks.map((a) => (
                <article
                  className={`pick${readIds.includes(a.id) ? ' read' : ''}`}
                  key={a.id}
                  data-cat={a.category ?? ''}
                >
                  <div className="pick-head">
                    <h2>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={() => {
                          track('article_click', { id: a.id, cat: a.category ?? '', score: a.score ?? null });
                          onOpen(a);
                        }}
                      >
                        {a.title}
                      </a>
                      {readIds.includes(a.id) && <span className="read-tag">已读</span>}
                    </h2>
                    <button
                      type="button"
                      className={`save-btn${savedIds.includes(a.id) ? ' on' : ''}`}
                      aria-label={savedIds.includes(a.id) ? '取消收藏' : '收藏'}
                      title={savedIds.includes(a.id) ? '取消收藏' : '收藏，7 天后自动清理'}
                      onClick={() => onSave(a)}
                    >
                      {savedIds.includes(a.id) ? '★' : '☆'}
                    </button>
                  </div>

                  {a.summary && <p className="pick-summary">{a.summary}</p>}

                  {a.questions && a.questions.length > 0 ? (
                    <div className="pick-qs">
                      {a.questions.slice(0, 2).map((q, qi) => (
                        <button
                          key={q}
                          data-n={String(qi + 1).padStart(2, '0')}
                          onClick={() => {
                            track('question_click', { id: a.id, q });
                            setPendingAsk({ article: a, question: q });
                          }}
                        >
                          <span>{q}</span>
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

                  {chat?.article.id === a.id && (
                    <ChatPanel
                      key={chat.question}
                      article={a}
                      initialQuestion={chat.question}
                      onClose={() => setChat(null)}
                    />
                  )}
                </article>
              ))}
            </section>

            <div id="subscribe">
              <SubscribeForm variant="card" source="after_list" />
            </div>

            {briefs.length > 0 && (
              <section className="briefs">
                <h2>今日速览</h2>
                <ul>
                  {briefs.map((b) => (
                    <li key={b.id}>
                      <a
                        href={b.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={() => track('brief_click', { id: b.id, source: b.account ?? '' })}
                      >
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
    </div>
  );
}
