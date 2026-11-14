/** 前端埋点：不阻塞页面，失败也不影响使用 */
export function track(name: string, props: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  try {
    let aid = localStorage.getItem('dr_aid');
    if (!aid) {
      aid = crypto.randomUUID();
      localStorage.setItem('dr_aid', aid);
    }
    const payload = JSON.stringify({ name, aid, props, path: location.pathname });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
    }
  } catch {
    /* 忽略 */
  }
}
