'use client';

import { useEffect, useRef, useState } from 'react';
import type { Article } from '@/lib/store';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPanel({
  article,
  initialQuestion,
  onClose,
}: {
  article: Article;
  initialQuestion: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;

    const next: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError('');

    try {
      const res = await fetch(`/api/articles/${article.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessages([...next, { role: 'assistant', content: data.answer }]);
      } else {
        setError(data.message ?? '对话失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialQuestion) send(initialQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  return (
    <aside className="chat" aria-label="和 DeepSeek 对话">
      <div className="chat-head">
        <span className="chat-title">和 DeepSeek 聊这篇</span>
        <button className="chat-close" onClick={onClose} title="收起">
          收起
        </button>
      </div>

      <div className="chat-article">{article.title}</div>

      <div className="chat-body">
        {messages.length === 0 && !busy && (
          <p className="chat-tip">点下面的问题开始，或者直接输入你想问的。</p>
        )}

        {messages.map((m, i) => (
          <div className={`bubble ${m.role}`} key={i}>
            {m.content}
          </div>
        ))}

        {busy && <div className="bubble assistant thinking">思考中…</div>}
        {error && <div className="chat-error">{error}</div>}
        <div ref={endRef} />
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="继续追问…"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          问
        </button>
      </form>

      <div className="chat-foot">
        回答只基于这篇文章，可能不完整。原文更准，记得回去核对。
      </div>
    </aside>
  );
}
