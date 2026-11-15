'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSaved, removeSaved, SAVED_TTL, type SavedItem } from '@/lib/local';
import { track } from '@/lib/track';

export default function SavedPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setItems(getSaved());
    setReady(true);
  }, []);

  function finish(id: string) {
    track('saved_read_click', { id });
    removeSaved(id);
    setItems(getSaved());
  }

  function drop(id: string) {
    track('unsave_click', { id });
    removeSaved(id);
    setItems(getSaved());
  }

  const days = Math.round(SAVED_TTL / 86400000);

  return (
    <main className="wrap">
      <header className="masthead">
        <div className="brand">
          <h1>收藏</h1>
          <span className="brand-sub">{items.length} 篇</span>
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

      <section className="saved-note">
        <p style={{ margin: 0 }}>
          收藏会保留 <b>{days} 天</b>，到期自动删除。读完了就点一下「已读完」，它会立刻从列表里消失——
          这样这里只留你还没读的。
        </p>
      </section>

      {ready && items.length === 0 && (
        <p className="empty">
          还没有收藏。
          <br />
          在首页点标题右边的书签，就会存到这里。
        </p>
      )}

      <ul className="saved-list">
        {items.map((it) => (
          <li key={it.id}>
            <div className="saved-main">
              <a href={it.url} target="_blank" rel="noreferrer noopener" onClick={() => track('saved_open', { id: it.id })}>
                {it.title}
              </a>
              <p className="saved-meta">
                {it.account ? `${it.account} · ` : ''}
                {new Date(it.savedAt).toLocaleDateString('zh-CN')} 收藏
              </p>
            </div>
            <div className="saved-actions">
              <button type="button" className="done-btn" onClick={() => finish(it.id)}>
                已读完
              </button>
              <button type="button" className="drop-btn" onClick={() => drop(it.id)} aria-label="取消收藏">
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="colophon">DEEPREAD</div>
    </main>
  );
}
