import { getDb } from "./db/sqlite";

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number; reason: string };

type RateLimitOpts = {
  maxAttempts: number;
  windowMs: number;
  blockMs?: number;
};

function ensureRateLimitTable() {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      reset_at INTEGER NOT NULL,
      blocked_until INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
  `);
}

let ready = false;
function db() {
  if (!ready) {
    ensureRateLimitTable();
    ready = true;
  }
  return getDb();
}

/** Rate-limit persistant (SQLite) — survit aux restarts Docker. */
export function checkRateLimit(key: string, opts: RateLimitOpts): RateLimitResult {
  const database = db();
  const now = Date.now();

  // Purge occasionnelle des buckets expirés
  if (Math.random() < 0.02) {
    database
      .prepare(
        `DELETE FROM rate_limits
         WHERE reset_at < ? AND (blocked_until IS NULL OR blocked_until < ?)`,
      )
      .run(now - opts.windowMs, now);
  }

  const row = database
    .prepare(`SELECT count, reset_at, blocked_until FROM rate_limits WHERE key = ?`)
    .get(key) as { count: number; reset_at: number; blocked_until: number | null } | undefined;

  if (row?.blocked_until && row.blocked_until > now) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((row.blocked_until - now) / 1000),
      reason: "Trop de tentatives. Réessayez plus tard.",
    };
  }

  if (!row || row.reset_at <= now) {
    database
      .prepare(
        `INSERT INTO rate_limits (key, count, reset_at, blocked_until)
         VALUES (?, 1, ?, NULL)
         ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at, blocked_until = NULL`,
      )
      .run(key, now + opts.windowMs);
    return { ok: true, remaining: opts.maxAttempts - 1 };
  }

  const nextCount = row.count + 1;
  if (nextCount > opts.maxAttempts) {
    const blockedUntil = now + (opts.blockMs ?? opts.windowMs);
    database
      .prepare(`UPDATE rate_limits SET count = ?, blocked_until = ? WHERE key = ?`)
      .run(nextCount, blockedUntil, key);
    return {
      ok: false,
      retryAfterSec: Math.ceil((blockedUntil - now) / 1000),
      reason: "Limite atteinte. Compte temporairement bloqué.",
    };
  }

  database.prepare(`UPDATE rate_limits SET count = ? WHERE key = ?`).run(nextCount, key);
  return { ok: true, remaining: opts.maxAttempts - nextCount };
}

export function resetRateLimit(key: string) {
  db().prepare(`DELETE FROM rate_limits WHERE key = ?`).run(key);
}

export const LOGIN_LIMIT = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  blockMs: 30 * 60 * 1000,
} as const;

export const METRICS_LIMIT = {
  maxAttempts: 120,
  windowMs: 60 * 1000,
} as const;

export const BRIDGE_LIMIT = {
  maxAttempts: 180,
  windowMs: 60 * 1000,
} as const;

export const OFFICE_LIMIT = {
  maxAttempts: 120,
  windowMs: 60 * 1000,
} as const;
