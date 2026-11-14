'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function WechatPage() {
  const [data, setData] = useState<{ title: string; html: string; count: number } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await fetch('/api/wechat', { cache: 'no-store' });
      const json = await res.json();
      if (json.ok) setData(json);
      else setMsg(json.message ?? '生成失败');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function copyHtml() {
    if (!data) return;

    // 首选：现代剪贴板 API（需要 https 或 localhost）
    try {
      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        const blob = new Blob([data.html], { type: 'text/html' });
        const item = new ClipboardItem({
          'text/html': blob,
          'text/plain': new Blob([data.html], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
        setMsg('已复制，去公众号编辑器里直接粘贴（⌘V）');
        return;
      }
    } catch {
      /* 继续走兜底 */
    }

    // 兜底：选中隐藏富文本节点再 execCommand 复制（http 页面也能用）
    try {
      const holder = document.createElement('div');
      holder.contentEditable = 'true';
      holder.innerHTML = data.html;
      holder.style.position = 'fixed';
      holder.style.left = '-9999px';
      holder.style.top = '0';
      document.body.appendChild(holder);

      const range = document.createRange();
      range.selectNodeContents(holder);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const ok = document.execCommand('copy');
      sel?.removeAllRanges();
      document.body.removeChild(holder);

      setMsg(ok ? '已复制，去公众号编辑器里直接粘贴（⌘V）' : '复制失败，请改用「下载 HTML」');
    } catch {
      setMsg('复制失败，请改用「下载 HTML」');
    }
  }

  async function copyTitle() {
    if (!data) return;
    await navigator.clipboard.writeText(data.title);
    setMsg('标题已复制');
  }

  function download() {
    if (!data) return;
    const blob = new Blob(
      [`<!doctype html><meta charset="utf-8"><title>${data.title}</title><body>${data.html}</body>`],
      { type: 'text/html' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `deepread-wechat-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
  }

  return (
    <main className="wrap">
      <header className="masthead">
        <div className="brand">
          <h1>公众号排版</h1>
        </div>
        <p className="dateline">
          <Link href="/" className="nav-link">
            ← 回到今天
          </Link>
        </p>
      </header>

      <div className="edition-tools">
        <button className="ghost" onClick={load} disabled={busy}>
          {busy ? '生成中…' : '重新生成'}
        </button>
      </div>

      {data && (
        <>
          <div className="paste" style={{ marginTop: 18 }}>
            <input value={data.title} readOnly />
            <button type="button" onClick={copyTitle}>
              复制标题
            </button>
          </div>

          <div className="edition-tools" style={{ marginTop: 12 }}>
            <button className="ghost" onClick={copyHtml}>
              ① 复制正文（富文本）
            </button>
            <button className="ghost" onClick={download}>
              ② 下载 HTML
            </button>
          </div>

          {msg && <div className="hint ok">{msg}</div>}

          <div className="wechat-preview" dangerouslySetInnerHTML={{ __html: data.html }} />

          <div className="foot">
            复制后在公众号编辑器里直接粘贴；「阅读原文」记得填成网站首页。
          </div>
        </>
      )}

      {!data && !busy && <p className="empty">还没有生成。</p>}
    </main>
  );
}
