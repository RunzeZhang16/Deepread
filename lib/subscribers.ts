import crypto from 'node:crypto';
import { getDb } from './db';

export interface Subscriber {
  id: string;
  email: string;
  status: 'pending' | 'confirmed' | 'unsubscribed';
  source: string | null;
  confirm_token: string | null;
  unsub_token: string | null;
  created_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s);
}

function token() {
  return crypto.randomBytes(18).toString('base64url');
}

export function findByEmail(email: string): Subscriber | undefined {
  return getDb().prepare('SELECT * FROM subscribers WHERE email = ?').get(email) as Subscriber | undefined;
}

/** 建或更新一条待确认订阅，返回 confirm token */
export function upsertPending(email: string, source: string): string {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = findByEmail(email);
  const confirmToken = token();

  if (!existing) {
    db.prepare(
      `INSERT INTO subscribers (id, email, status, source, confirm_token, unsub_token, created_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), email, source, confirmToken, token(), now);
    return confirmToken;
  }

  db.prepare(
    `UPDATE subscribers SET status = 'pending', source = ?, confirm_token = ?, unsub_token = COALESCE(unsub_token, ?) WHERE email = ?`
  ).run(source, confirmToken, token(), email);
  return confirmToken;
}

export function confirmByToken(t: string): Subscriber | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM subscribers WHERE confirm_token = ?').get(t) as Subscriber | undefined;
  if (!row) return undefined;
  if (row.status !== 'confirmed') {
    db.prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      row.id
    );
  }
  return { ...row, status: 'confirmed' };
}

export function unsubscribeByToken(t: string): Subscriber | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM subscribers WHERE unsub_token = ?').get(t) as Subscriber | undefined;
  if (!row) return undefined;
  db.prepare("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    row.id
  );
  return { ...row, status: 'unsubscribed' };
}

export function confirmedSubscribers(): Subscriber[] {
  return getDb().prepare("SELECT * FROM subscribers WHERE status = 'confirmed' ORDER BY created_at").all() as Subscriber[];
}
