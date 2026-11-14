/** http 页面没有 crypto.randomUUID，这里做兜底 */
function newAid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** 前端埋点：不阻塞页面，失败也不影响使用 */
export function track(name: string, props: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  try {
    let aid = localStorage.getItem('dr_aid');
    if (!aid) {
      aid = newAid();
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
