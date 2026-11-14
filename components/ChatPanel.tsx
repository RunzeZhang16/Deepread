'use client';

import { useEffect, useRef, useState } from 'react';
import type { Article } from '@/lib/store';
import { track } from '@/lib/track';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}


function newAid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function aid(): string {
  if (typeof window === 'undefined') return '';
  let v = localStorage.getItem('dr_aid');
  if (!v) {
    v = newAid();
    localStorage.setItem('dr_aid', v);
  }
  return v;
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
  const [remaining, setRemaining] = useState<number | null>(null);
  const [nextQuestion, setNextQuestion] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
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
    setNextQuestion(null);

    try {
      const res = await fetch(`/api/articles/${article.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, aid: aid() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessages([...next, { role: 'assistant', content: data.answer }]);
        setRemaining(typeof data.remaining === 'number' ? data.remaining : null);
        setNextQuestion(data.next ?? null);
      } else if (data.code === 'limit') {
        setBlocked(true);
        setRemaining(0);
        setError(data.message ?? '今天的对话次数用完了');
      } else {
        setError(data.message ?? '对话失败');
      }
    } catch (e) {
      setError(e instanceof Error ? `网络错误：${e.message}` : '网络错误');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    track('chat_open', { id: article.id });
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

        {nextQuestion && !busy && !blocked && (
          <button
            className="next-q"
            onClick={() => {
              track('next_click', { id: article.id, q: nextQuestion });
              send(nextQuestion);
            }}
          >
            <span>接着问</span>
            {nextQuestion}
          </button>
        )}

        {error && <div className={`chat-error ${blocked ? 'blocked' : ''}`}>{error}</div>}
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
          placeholder={blocked ? '今天的次数用完了，明天再来' : '继续追问…'}
          disabled={busy || blocked}
        />
        <button type="submit" disabled={busy || blocked || !input.trim()}>
          问
        </button>
      </form>

      <div className="chat-foot">
        回答只基于这篇文章，可能不完整。
        {remaining !== null && !blocked && ` · 今天还可以问 ${remaining} 轮`}
        {blocked && ' · 更多轮次开发中，敬请期待'}
      </div>
    </aside>
  );
}
