import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import type { NotificationRecord, NotificationSeverity } from "../types";

function dbPath(): string {
  return process.env.MASTER_DB_PATH ?? join(process.cwd(), "data", "master.db");
}

let db: Database.Database | null = null;
let dbPathUsed: string | null = null;

export function getDb(): Database.Database {
  const path = dbPath();
  if (db && dbPathUsed !== path) {
    db.close();
    db = null;
    dbPathUsed = null;
  }
  if (db) return db;
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  dbPathUsed = path;
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
}

/** Tests only — close the singleton so MASTER_DB_PATH can be swapped. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    dbPathUsed = null;
  }
}

function initSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      sent_wa INTEGER NOT NULL DEFAULT 0,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alert_state (
      rule_id TEXT PRIMARY KEY,
      last_fired_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt TEXT NOT NULL,
      wa_chat_id TEXT NOT NULL,
      cursor_agent_id TEXT,
      cursor_run_id TEXT,
      parent_job_id TEXT,
      result_text TEXT,
      error TEXT,
      media_url TEXT,
      claimed_by TEXT,
      claimed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wa_messages (
      message_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS worker_heartbeats (
      worker_id TEXT PRIMARY KEY,
      hostname TEXT,
      last_seen_at TEXT NOT NULL,
      meta TEXT
    );
    CREATE TABLE IF NOT EXISTS security_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      ip TEXT,
      user_agent TEXT,
      meta TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read) WHERE read = 0;
    CREATE INDEX IF NOT EXISTS idx_jobs_status_target ON jobs(status, target, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_wa_chat ON jobs(wa_chat_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_security_events_kind ON security_events(kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity, created_at DESC);

    CREATE TABLE IF NOT EXISTS office_agents (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      task TEXT,
      current_action TEXT,
      last_seen_at TEXT NOT NULL,
      meta TEXT
    );
    CREATE TABLE IF NOT EXISTS office_events (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS office_commands (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      claimed_by TEXT,
      result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_office_events_agent ON office_events(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_office_commands_status ON office_commands(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_office_agents_seen ON office_agents(last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS agent_logs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'reflection',
      content TEXT NOT NULL,
      meta TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS ai_projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      schedule TEXT,
      status TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      agent_id TEXT,
      brief TEXT NOT NULL DEFAULT '',
      goals TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0,
      next_run_at TEXT,
      team_id TEXT,
      meta TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_projects_status ON ai_projects(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lead_agent_id TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_team_members (
      team_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      role_in_team TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (team_id, agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_team_members_agent ON agent_team_members(agent_id);

    CREATE TABLE IF NOT EXISTS agent_profiles (
      agent_id TEXT PRIMARY KEY,
      display_name TEXT,
      persona TEXT NOT NULL DEFAULT '',
      preferred_room TEXT,
      tags TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS office_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      team_id TEXT,
      title TEXT NOT NULL,
      brief TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      assignee_agent_id TEXT,
      reporter_agent_id TEXT,
      deliver_to TEXT,
      parent_task_id TEXT,
      command_id TEXT,
      result_summary TEXT,
      meta TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_office_tasks_status ON office_tasks(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_office_tasks_phase ON office_tasks(phase, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_office_tasks_project ON office_tasks(project_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS office_task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      from_agent TEXT,
      to_agent TEXT,
      text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_office_task_events_task ON office_task_events(task_id, created_at DESC);
  `);
  migrateOfficeSchema(database);
}

function tableColumns(database: Database.Database, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function ensureColumn(database: Database.Database, table: string, name: string, ddl: string) {
  const cols = tableColumns(database, table);
  if (!cols.has(name)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function migrateOfficeSchema(database: Database.Database) {
  ensureColumn(database, "ai_projects", "brief", "brief TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "ai_projects", "goals", "goals TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "ai_projects", "priority", "priority INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "ai_projects", "next_run_at", "next_run_at TEXT");
  ensureColumn(database, "ai_projects", "team_id", "team_id TEXT");
  ensureColumn(database, "ai_projects", "meta", "meta TEXT");
  database.exec(`
    CREATE TABLE IF NOT EXISTS office_secrets (
      key TEXT PRIMARY KEY,
      value_enc TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function rowToNotification(row: Record<string, unknown>): NotificationRecord {
  return {
    id: String(row.id),
    type: String(row.type),
    severity: row.severity as NotificationSeverity,
    title: String(row.title),
    body: String(row.body),
    sentWa: Boolean(row.sent_wa),
    read: Boolean(row.read),
    createdAt: String(row.created_at),
  };
}

export function listNotifications(limit = 50, unreadOnly = false): NotificationRecord[] {
  const database = getDb();
  const sql = unreadOnly
    ? `SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?`;
  return database.prepare(sql).all(limit).map((r) => rowToNotification(r as Record<string, unknown>));
}

export function countUnreadNotifications(): number {
  const database = getDb();
  const row = database.prepare(`SELECT COUNT(*) as c FROM notifications WHERE read = 0`).get() as { c: number };
  return row.c;
}

export function insertNotification(input: Omit<NotificationRecord, "id" | "createdAt"> & { id?: string }) {
  const database = getDb();
  const id = input.id ?? crypto.randomUUID();
  const createdAt = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO notifications (id, type, severity, title, body, sent_wa, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.type, input.severity, input.title, input.body, input.sentWa ? 1 : 0, input.read ? 1 : 0, createdAt);
  return { ...input, id, createdAt, read: input.read ?? false };
}

export function markNotificationRead(id: string): boolean {
  const database = getDb();
  const result = database.prepare(`UPDATE notifications SET read = 1 WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getAlertLastFired(ruleId: string): string | null {
  const database = getDb();
  const row = database.prepare(`SELECT last_fired_at FROM alert_state WHERE rule_id = ?`).get(ruleId) as
    | { last_fired_at: string }
    | undefined;
  return row?.last_fired_at ?? null;
}

export function setAlertLastFired(ruleId: string, at: string) {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO alert_state (rule_id, last_fired_at) VALUES (?, ?)
       ON CONFLICT(rule_id) DO UPDATE SET last_fired_at = excluded.last_fired_at`,
    )
    .run(ruleId, at);
}
