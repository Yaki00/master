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

    CREATE TABLE IF NOT EXISTS job_hunt_profile (
      id TEXT PRIMARY KEY DEFAULT 'default',
      full_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
      cv_base TEXT NOT NULL DEFAULT '',
      stack TEXT NOT NULL DEFAULT '[]',
      languages TEXT NOT NULL DEFAULT '[]',
      min_salary_eur INTEGER,
      remote_only INTEGER NOT NULL DEFAULT 1,
      preferred_regions TEXT NOT NULL DEFAULT '[]',
      cover_letter_template TEXT NOT NULL DEFAULT '',
      platforms TEXT NOT NULL DEFAULT '[]',
      target_roles TEXT NOT NULL DEFAULT '[]',
      cv_file_name TEXT NOT NULL DEFAULT '',
      cv_analyzed_at TEXT,
      auto_search_enabled INTEGER NOT NULL DEFAULT 1,
      auto_apply_enabled INTEGER NOT NULL DEFAULT 1,
      min_score_auto_apply INTEGER NOT NULL DEFAULT 55,
      max_applications_per_day INTEGER NOT NULL DEFAULT 8,
      search_interval_hours INTEGER NOT NULL DEFAULT 4,
      last_search_at TEXT,
      last_auto_run_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_hunt_listings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      apply_url TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      description TEXT NOT NULL DEFAULT '',
      requirements TEXT NOT NULL DEFAULT '',
      benefits TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      salary TEXT NOT NULL DEFAULT '',
      employment_type TEXT NOT NULL DEFAULT '',
      remote_type TEXT NOT NULL DEFAULT 'remote',
      posted_at TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new',
      tailored_cv TEXT NOT NULL DEFAULT '',
      cover_letter TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      agent_result TEXT NOT NULL DEFAULT '',
      agent_error TEXT NOT NULL DEFAULT '',
      meta TEXT NOT NULL DEFAULT '{}',
      pc_job_id TEXT,
      applied_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_hunt_listings_status ON job_hunt_listings(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_job_hunt_listings_score ON job_hunt_listings(score DESC);
    CREATE INDEX IF NOT EXISTS idx_job_hunt_listings_applied ON job_hunt_listings(applied_at DESC);

    CREATE TABLE IF NOT EXISTS job_hunt_events (
      id TEXT PRIMARY KEY,
      listing_id TEXT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_hunt_events_listing ON job_hunt_events(listing_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS job_hunt_search_runs (
      id TEXT PRIMARY KEY,
      sources TEXT NOT NULL DEFAULT '[]',
      min_score INTEGER NOT NULL DEFAULT 40,
      imported_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_hunt_search_runs_created ON job_hunt_search_runs(created_at DESC);

    CREATE TABLE IF NOT EXISTS job_hunt_search_decisions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      score INTEGER,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      listing_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_hunt_search_decisions_run ON job_hunt_search_decisions(run_id, created_at DESC);
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
  ensureColumn(database, "job_hunt_profile", "target_roles", "target_roles TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, "job_hunt_profile", "cv_file_name", "cv_file_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "job_hunt_profile", "cv_analyzed_at", "cv_analyzed_at TEXT");
  ensureColumn(database, "job_hunt_profile", "auto_search_enabled", "auto_search_enabled INTEGER NOT NULL DEFAULT 1");
  ensureColumn(database, "job_hunt_profile", "auto_apply_enabled", "auto_apply_enabled INTEGER NOT NULL DEFAULT 1");
  ensureColumn(database, "job_hunt_profile", "min_score_auto_apply", "min_score_auto_apply INTEGER NOT NULL DEFAULT 55");
  ensureColumn(database, "job_hunt_profile", "max_applications_per_day", "max_applications_per_day INTEGER NOT NULL DEFAULT 8");
  ensureColumn(database, "job_hunt_profile", "search_interval_hours", "search_interval_hours INTEGER NOT NULL DEFAULT 4");
  ensureColumn(database, "job_hunt_profile", "last_search_at", "last_search_at TEXT");
  ensureColumn(database, "job_hunt_profile", "last_auto_run_at", "last_auto_run_at TEXT");
  ensureColumn(database, "job_hunt_listings", "apply_url", "apply_url TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "job_hunt_listings", "requirements", "requirements TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "job_hunt_listings", "benefits", "benefits TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "job_hunt_listings", "employment_type", "employment_type TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "job_hunt_listings", "posted_at", "posted_at TEXT");
  ensureColumn(database, "job_hunt_listings", "agent_result", "agent_result TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "job_hunt_listings", "agent_error", "agent_error TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "job_hunt_listings", "meta", "meta TEXT NOT NULL DEFAULT '{}'");
  database.exec(`
    CREATE TABLE IF NOT EXISTS job_hunt_events (
      id TEXT PRIMARY KEY,
      listing_id TEXT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_hunt_events_listing ON job_hunt_events(listing_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS job_hunt_search_runs (
      id TEXT PRIMARY KEY,
      sources TEXT NOT NULL DEFAULT '[]',
      min_score INTEGER NOT NULL DEFAULT 40,
      imported_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_hunt_search_runs_created ON job_hunt_search_runs(created_at DESC);
    CREATE TABLE IF NOT EXISTS job_hunt_search_decisions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      score INTEGER,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      listing_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_hunt_search_decisions_run ON job_hunt_search_decisions(run_id, created_at DESC);
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS office_secrets (
      key TEXT PRIMARY KEY,
      value_enc TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS office_conversations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      events_json TEXT NOT NULL DEFAULT '[]',
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      archived_at TEXT,
      meta TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_office_conversations_agent
      ON office_conversations(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_office_conversations_archived
      ON office_conversations(agent_id, archived_at DESC);
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS office_project_files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      path TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT 'text/plain',
      size INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_office_project_files_project
      ON office_project_files(project_id, path);
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
