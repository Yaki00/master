import { getDb } from "./sqlite";

function ensureSnoozeTable() {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_snooze (
      app_id TEXT PRIMARY KEY,
      snoozed INTEGER NOT NULL DEFAULT 1,
      reason TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}

let ready = false;
function db() {
  if (!ready) {
    ensureSnoozeTable();
    ready = true;
  }
  return getDb();
}

export function listSnoozedAppIds(): Set<string> {
  const rows = db()
    .prepare(`SELECT app_id FROM app_snooze WHERE snoozed = 1`)
    .all() as { app_id: string }[];
  return new Set(rows.map((r) => r.app_id));
}

export function isAppSnoozedInDb(appId: string): boolean {
  const row = db()
    .prepare(`SELECT snoozed FROM app_snooze WHERE app_id = ?`)
    .get(appId) as { snoozed: number } | undefined;
  return Boolean(row?.snoozed);
}

/** null = pas d'override DB (fallback code). */
export function getAppSnoozeOverride(appId: string): boolean | null {
  const row = db()
    .prepare(`SELECT snoozed FROM app_snooze WHERE app_id = ?`)
    .get(appId) as { snoozed: number } | undefined;
  if (!row) return null;
  return Boolean(row.snoozed);
}

export function setAppSnooze(appId: string, snoozed: boolean, reason?: string) {
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO app_snooze (app_id, snoozed, reason, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(app_id) DO UPDATE SET
         snoozed = excluded.snoozed,
         reason = excluded.reason,
         updated_at = excluded.updated_at`,
    )
    .run(appId, snoozed ? 1 : 0, reason ?? null, now);
  return { appId, snoozed, updatedAt: now };
}

export function listAppSnoozes(): { appId: string; snoozed: boolean; reason: string | null; updatedAt: string }[] {
  return (
    db()
      .prepare(`SELECT app_id, snoozed, reason, updated_at FROM app_snooze ORDER BY app_id`)
      .all() as { app_id: string; snoozed: number; reason: string | null; updated_at: string }[]
  ).map((r) => ({
    appId: r.app_id,
    snoozed: Boolean(r.snoozed),
    reason: r.reason,
    updatedAt: r.updated_at,
  }));
}
