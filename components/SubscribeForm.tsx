'use client';

import { useEffect, useRef, useState } from 'react';
import { track } from '@/lib/track';

type State = 'idle' | 'sending' | 'pending' | 'already' | 'error';

export default function SubscribeForm({ variant = 'card', source = 'home' }: { variant?: 'card' | 'compact'; source?: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');
  const [msg, setMsg] = useState('');
  const seen = useRef(false);

  useEffect(() => {
    if (seen.current) return;
    seen.current = true;
    track('subscribe_view', { variant, source });
  }, [variant, source]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || state === 'sending') return;
    setState('sending');
    setMsg('');
    track('subscribe_submit', { variant, source });

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setState(data.status === 'already' ? 'already' : 'pending');
        setMsg(data.message ?? '');
      } else {
        setState('error');
        setMsg(data.message ?? '没提交成功，再试一次？');
      }
    } catch {
      setState('error');
      setMsg('网络不太好，再试一次？');
    }
  }

  const done = state === 'pending' || state === 'already';

  return (
    <section className={variant === 'card' ? 'sub-card' : 'sub-compact'}>
      {variant === 'card' && (
        <>
          <h2>每周五晚 7 点，8 篇文章发到你邮箱</h2>
          <p className="sub-sub">不用记网址，也不用打开公众号。只发这个，随时退订。</p>
        </>
      )}

      {done ? (
        <p className="sub-done">{msg || (state === 'already' ? '你已经在订阅列表里了。' : '确认邮件已发出，去收件箱点一下。')}</p>
      ) : (
        <form onSubmit={submit} className="sub-form">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="你的邮箱"
            disabled={state === 'sending'}
            aria-label="邮箱"
          />
          <button type="submit" disabled={state === 'sending' || !email.trim()}>
            {state === 'sending' ? '发送中…' : variant === 'card' ? '订阅' : '订阅'}
          </button>
        </form>
      )}

      {state === 'error' && <p className="sub-err">{msg}</p>}
      {variant === 'compact' && !done && <p className="sub-hint">每周五晚 7 点一封，随时退订</p>}
    </section>
  );
}
