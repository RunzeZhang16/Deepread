PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 信息源
CREATE TABLE IF NOT EXISTS sources (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL UNIQUE,
  category    TEXT,
  weight      INTEGER DEFAULT 55,
  enabled     INTEGER DEFAULT 1,
  type        TEXT DEFAULT 'rss',      -- rss | html
  brief_only  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- 候选池
CREATE TABLE IF NOT EXISTS candidates (
  id            TEXT PRIMARY KEY,
  source_id     TEXT REFERENCES sources(id) ON DELETE SET NULL,
  source_name   TEXT,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL UNIQUE,
  summary       TEXT,
  category      TEXT,
  published_at  TEXT,
  fetched_at    TEXT,
  score         INTEGER,
  reason        TEXT,
  status        TEXT DEFAULT 'new'     -- new | promoted | discarded
);
CREATE INDEX IF NOT EXISTS idx_cand_score  ON candidates(score DESC);
CREATE INDEX IF NOT EXISTS idx_cand_status ON candidates(status);

-- 已收录文章
CREATE TABLE IF NOT EXISTS articles (
  id            TEXT PRIMARY KEY,
  url           TEXT NOT NULL UNIQUE,
  title         TEXT,
  account       TEXT,
  site          TEXT,
  status        TEXT DEFAULT 'full',
  word_count    INTEGER DEFAULT 0,
  excerpt       TEXT,
  summary       TEXT,
  questions     TEXT,                  -- JSON 数组
  published_at  TEXT,
  fetched_at    TEXT,
  category      TEXT,
  title_only    INTEGER DEFAULT 0,
  score         INTEGER,
  note          TEXT,
  error         TEXT,
  enrich_error  TEXT,
  edition       TEXT,
  answers       TEXT,  -- 预生成的问题答案 JSON
  hook          TEXT,  -- 公众号钩子句
  is_cover      INTEGER DEFAULT 0  -- 本期专题（封面文章）
);
CREATE INDEX IF NOT EXISTS idx_art_fetched ON articles(fetched_at DESC);

-- 用户（V1 只用于会员）
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  code_hash     TEXT,
  code_expires  TEXT,
  plan          TEXT DEFAULT 'free',   -- free | member | annual
  plan_expires  TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- 订单（前期手动开通也记一笔）
CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  plan        TEXT,
  amount      INTEGER,
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- 埋点
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  aid         TEXT,
  name        TEXT NOT NULL,
  props       TEXT,
  path        TEXT,
  referrer    TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evt_name_time ON events(name, created_at);

-- 对话额度
CREATE TABLE IF NOT EXISTS chat_usage (
  aid   TEXT NOT NULL,
  day   TEXT NOT NULL,                 -- YYYY-MM-DD（北京时间）
  count INTEGER DEFAULT 0,
  PRIMARY KEY (aid, day)
);

-- 运行日志（定时任务用）
CREATE TABLE IF NOT EXISTS job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job         TEXT NOT NULL,
  started_at  TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  ok          INTEGER,
  detail      TEXT
);

-- 键值配置（召回统计、开关等）
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 每篇文章的对话额度（按人按天）
CREATE TABLE IF NOT EXISTS chat_quota (
  aid        TEXT NOT NULL,
  article_id TEXT NOT NULL,
  day        TEXT NOT NULL,
  count      INTEGER DEFAULT 0,
  PRIMARY KEY (aid, article_id, day)
);

-- 邮件订阅（双重确认）
CREATE TABLE IF NOT EXISTS subscribers (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | unsubscribed
  source          TEXT,
  confirm_token   TEXT,
  unsub_token     TEXT,
  created_at      TEXT NOT NULL,
  confirmed_at    TEXT,
  unsubscribed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
