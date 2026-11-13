'use client';

import { useCallback, useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import type { Candidate, RecallData } from '@/lib/recall';
import type { Feed } from '@/lib/feeds';

const CATEGORIES = ['科技', '经济', '科学', '游戏', '开发', '人文', '艺术', '历史', '法律', '社会'];

type Filter = 'new' | 'all' | 'high' | 'promoted' | 'discarded';

const FILTERS: { id: Filter; name: string }[] = [
  { id: 'new', name: '未处理' },
  { id: 'high', name: '高分 ≥70' },
  { id: 'all', name: '全部' },
  { id: 'promoted', name: '已收录' },
  { id: 'discarded', name: '已丢弃' },
];

function relTime(iso: string | null) {
  if (!iso) return '';
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return '';
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return '刚刚';
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return d === 1 ? '昨天' : `${d} 天前`;
}

export default function RecallPage() {
  const [data, setData] = useState<RecallData | null>(null);
  const [filter, setFilter] = useState<Filter>('new');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [hint, setHint] = useState('');
  const [cat, setCat] = useState('全部');
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [showFeeds, setShowFeeds] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState('人文');
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedMsg, setFeedMsg] = useState('');
  const [visible, setVisible] = useState(60);

  const load = useCallback(async () => {
    const [c, f] = await Promise.all([
      fetch('/api/candidates', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/feeds', { cache: 'no-store' }).then((r) => r.json()),
    ]);
    setData(c);
    setFeeds(f.feeds ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ?sources=1 直接展开源管理（方便分享和截图）
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('sources') === '1') setShowFeeds(true);
  }, []);

  const items = useMemo(() => {
    if (!data) return [];
    let list = filter === 'all' ? data.items : data.items.filter((i) => i.status === filter);
    if (cat !== '全部') list = list.filter((i) => i.category === cat);
    return [...list].sort((a, b) => {
      const sa = typeof a.score === 'number' ? a.score : -1;
      const sb = typeof b.score === 'number' ? b.score : -1;
      if (sb !== sa) return sb - sa;
      return Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? '');
    });
  }, [data, filter, cat]);

  const cats = useMemo(() => {
    const set = new Set<string>();
    for (const i of data?.items ?? []) set.add(i.category);
    return ['全部', ...[...set].sort()];
  }, [data]);

  const counts = useMemo(() => {
    const all = data?.items ?? [];
    return {
      total: all.length,
      new: all.filter((i) => i.status === 'new').length,
      promoted: all.filter((i) => i.status === 'promoted').length,
      discarded: all.filter((i) => i.status === 'discarded').length,
    };
  }, [data]);

  async function promote(c: Candidate) {
    setBusy((b) => ({ ...b, [c.id]: true }));
    setHint('');
    try {
      const res = await fetch(`/api/candidates/${c.id}/promote`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        setData((d) =>
          d ? { ...d, items: d.items.map((i) => (i.id === c.id ? { ...i, status: 'promoted' } : i)) } : d
        );
        setHint(`已收录：${c.title.slice(0, 24)}…（去首页看）`);
      } else {
        setHint(json.message ?? '收录失败');
      }
    } finally {
      setBusy((b) => ({ ...b, [c.id]: false }));
    }
  }

  async function addSource(e: React.FormEvent) {
    e.preventDefault();
    if (!newUrl.trim() || feedBusy) return;
    setFeedBusy(true);
    setFeedMsg('正在测试这个地址…');
    try {
      const res = await fetch('/api/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl.trim(), name: newName.trim(), category: newCat }),
      });
      const json = await res.json();
      if (json.ok) {
        setFeeds((f) => [...f, json.feed]);
        setFeedMsg(`已添加「${json.feed.name}」，这次解析到 ${json.probe.items} 条，最新一条：${(json.probe.latest ?? '').slice(0, 10)}`);
        setNewUrl('');
        setNewName('');
      } else {
        setFeedMsg(json.message ?? '添加失败');
      }
    } finally {
      setFeedBusy(false);
    }
  }

  async function removeSource(f: Feed) {
    if (!confirm(`删掉「${f.name}」？下次召回不再抓它。`)) return;
    await fetch(`/api/feeds/${f.id}`, { method: 'DELETE' });
    setFeeds((list) => list.filter((x) => x.id !== f.id));
  }

  async function toggleSource(f: Feed) {
    const enabled = !f.enabled;
    await fetch(`/api/feeds/${f.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    setFeeds((list) => list.map((x) => (x.id === f.id ? { ...x, enabled } : x)));
  }

  async function discard(c: Candidate) {
    setBusy((b) => ({ ...b, [c.id]: true }));
    try {
      await fetch(`/api/candidates/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'discarded' }),
      });
      setData((d) =>
        d ? { ...d, items: d.items.map((i) => (i.id === c.id ? { ...i, status: 'discarded' } : i)) } : d
      );
    } finally {
      setBusy((b) => ({ ...b, [c.id]: false }));
    }
  }

  return (
    <main className="wrap">
      <header className="top">
        <div className="title-row">
          <h1>召回池</h1>
          <Link href="/" className="nav-link">
            ← 回到今日
          </Link>
        </div>
      </header>

      <div className="pool-stats">
        <span>
          <b>{counts.total}</b> 条候选
        </span>
        <span>未处理 {counts.new}</span>
        <span>已收录 {counts.promoted}</span>
        <span>已丢弃 {counts.discarded}</span>
        {data?.updatedAt && <span className="muted">抓取于 {new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span>}
      </div>

      {data?.dropped && (
        <div className="pool-dropped">
          召回时挡掉：关键词 {data.dropped.blocked} · 过期 {data.dropped.tooOld} · 重复 {data.dropped.duplicate}
        </div>
      )}

      <div className="source-strip">
        <span className="src-chip">
          {data?.sources.length ?? 0} 个源 · {(data?.sources.filter((s) => s.ok).length ?? 0)} 正常
        </span>
        {data?.sources
          .filter((s) => !s.ok)
          .map((s) => (
            <span className="src-chip bad" key={s.id} title={s.error ?? ''}>
              {s.name} 失败
            </span>
          ))}
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`filter ${filter === f.id ? 'on' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.name}
          </button>
        ))}
      </div>

      <div className="filters cat-filters">
        {cats.map((c) => (
          <button
            key={c}
            className={`filter small ${cat === c ? 'on' : ''}`}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="feed-manager">
        <button className="feed-toggle" onClick={() => setShowFeeds((v) => !v)}>
          {showFeeds ? '收起源管理' : `源管理（${feeds.filter((f) => f.enabled).length} / ${feeds.length} 个启用）`}
        </button>

        {showFeeds && (
          <div className="feed-panel">
            <form className="feed-add" onSubmit={addSource}>
              <input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="粘贴 RSS / Atom 地址"
              />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="名字，可留空"
                className="feed-name"
              />
              <select value={newCat} onChange={(e) => setNewCat(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={feedBusy || !newUrl.trim()}>
                {feedBusy ? '测试中…' : '测试并添加'}
              </button>
            </form>

            {feedMsg && <div className="feed-msg">{feedMsg}</div>}

            <ul className="feed-list">
              {feeds.map((f) => (
                <li key={f.id}>
                  <span className={`dot ${f.enabled ? 'on' : ''}`} />
                  <span className="fname">{f.name}</span>
                  <span className="fcat">{f.category}</span>
                  <span className="ftype">{f.type === 'html' ? '列表页' : 'RSS'}</span>
                  <span className="furl">{f.url.replace(/^https?:\/\//, '')}</span>
                  <button onClick={() => toggleSource(f)}>{f.enabled ? '停用' : '启用'}</button>
                  <button className="del" onClick={() => removeSource(f)}>
                    删除
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {hint && <div className="hint ok">{hint}</div>}

      {!data ? (
        <p className="empty">加载中…</p>
      ) : items.length === 0 ? (
        <p className="empty">这个分类下没有条目。</p>
      ) : (
        items.slice(0, visible).map((c) => (
          <article className="pool-item" key={c.id}>
            <div className="pool-meta">
              <span className="src">{c.sourceName}</span>
              <span className="tag">{c.category}</span>
              <span>{relTime(c.publishedAt)}</span>
              {typeof c.score === 'number' && (
                <span className={`score ${c.score >= 80 ? 'high' : c.score >= 60 ? 'mid' : 'low'}`}>
                  {c.score}
                </span>
              )}
              {c.status === 'promoted' && <span className="tag ok-tag">已收录</span>}
              {c.status === 'discarded' && <span className="tag">已丢弃</span>}
            </div>
            <h3>
              <a href={c.url} target="_blank" rel="noreferrer noopener">
                {c.title}
              </a>
            </h3>
            {c.summary && <p className="pool-summary">{c.summary}</p>}
            {c.reason && <p className="pool-reason">{c.reason}</p>}
            <div className="pool-actions">
              {c.status !== 'promoted' ? (
                <button className="promote" disabled={busy[c.id]} onClick={() => promote(c)}>
                  {busy[c.id] ? '处理中…' : '收录（抓正文+生成问题）'}
                </button>
              ) : (
                <Link href="/" className="promote done">
                  去首页看 →
                </Link>
              )}
              {c.status !== 'discarded' && c.status !== 'promoted' && (
                <button className="discard" disabled={busy[c.id]} onClick={() => discard(c)}>
                  丢弃
                </button>
              )}
            </div>
          </article>
        ))
      )}

      {items.length > visible && (
        <button className="more-btn" onClick={() => setVisible((v) => v + 60)}>
          再显示 60 条（共 {items.length} 条）
        </button>
      )}

      <div className="foot">
        召回只负责“捞进来”，收录才会抓正文并生成摘要和问题。数据在 <code>data/candidates.json</code>。
      </div>
    </main>
  );
}
