/** 浏览器本地存储：收藏、已读。不需要登录。 */

export interface SavedItem {
  id: string;
  title: string;
  url: string;
  account?: string;
  savedAt: number;
}

const SAVED_KEY = 'dr_saved_v1';
const READ_KEY = 'dr_read_v1';
export const SAVED_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 无痕模式或超限，忽略 */
  }
}

/** 收藏（自动清掉超过 7 天的） */
export function getSaved(): SavedItem[] {
  const all = readJson<SavedItem[]>(SAVED_KEY, []);
  const now = Date.now();
  const alive = all.filter((x) => x && now - x.savedAt < SAVED_TTL);
  if (alive.length !== all.length) writeJson(SAVED_KEY, alive);
  return alive.sort((a, b) => b.savedAt - a.savedAt);
}

export function isSaved(id: string): boolean {
  return getSaved().some((x) => x.id === id);
}

/** 切换收藏，返回切换后是否已收藏 */
export function toggleSaved(item: Omit<SavedItem, 'savedAt'>): boolean {
  const all = getSaved();
  const idx = all.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    all.splice(idx, 1);
    writeJson(SAVED_KEY, all);
    return false;
  }
  all.unshift({ ...item, savedAt: Date.now() });
  writeJson(SAVED_KEY, all);
  return true;
}

export function removeSaved(id: string) {
  writeJson(
    SAVED_KEY,
    getSaved().filter((x) => x.id !== id)
  );
}

/** 已读记录 */
export function getRead(): Record<string, number> {
  return readJson<Record<string, number>>(READ_KEY, {});
}

export function markRead(id: string) {
  const map = getRead();
  map[id] = Date.now();
  writeJson(READ_KEY, map);
}

export function isRead(id: string): boolean {
  return Boolean(getRead()[id]);
}

/** 最近读过的一篇（用于「继续上次」） */
export function lastReadId(): string | null {
  const map = getRead();
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? null;
}
