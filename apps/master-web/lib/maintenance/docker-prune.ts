import { execFile } from "child_process";
import { promisify } from "util";
import { getDb } from "../db/sqlite";
import { insertSecurityEvent } from "../db/security-events";

const execFileAsync = promisify(execFile);

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function ensureMaintenanceTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS maintenance_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function getState(key: string): string | null {
  ensureMaintenanceTable();
  const row = getDb()
    .prepare(`SELECT value FROM maintenance_state WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setState(key: string, value: string) {
  ensureMaintenanceTable();
  getDb()
    .prepare(
      `INSERT INTO maintenance_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, new Date().toISOString());
}

export type PruneResult = {
  ran: boolean;
  skipped?: string;
  diskBefore?: string;
  diskAfter?: string;
  builderOut?: string;
  imageOut?: string;
  error?: string;
};

async function dfRoot(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("df", ["-h", "/"], { timeout: 10_000 });
    return stdout.trim().split("\n").pop() ?? stdout.trim();
  } catch {
    return "n/a";
  }
}

/** Prune Docker safe (pas de volumes). Utilise le socket monté dans master-web. */
export async function runDockerPrune(force = false): Promise<PruneResult> {
  const last = getState("docker_prune_last");
  if (!force && last && Date.now() - new Date(last).getTime() < WEEK_MS) {
    return { ran: false, skipped: `Dernier prune ${last} (< 7 jours)` };
  }

  const diskBefore = await dfRoot();
  try {
    const builder = await execFileAsync(
      "docker",
      ["builder", "prune", "-af", "--filter", "until=168h"],
      { timeout: 300_000, maxBuffer: 5 * 1024 * 1024 },
    ).catch(async () => execFileAsync("docker", ["builder", "prune", "-af"], { timeout: 300_000 }));

    const images = await execFileAsync(
      "docker",
      ["image", "prune", "-af", "--filter", "until=168h"],
      { timeout: 300_000, maxBuffer: 5 * 1024 * 1024 },
    );

    await execFileAsync("docker", ["container", "prune", "-f"], { timeout: 60_000 }).catch(() => null);

    const diskAfter = await dfRoot();
    const now = new Date().toISOString();
    setState("docker_prune_last", now);

    insertSecurityEvent({
      kind: "docker_prune",
      title: "Docker prune exécuté",
      detail: `Avant: ${diskBefore} · Après: ${diskAfter}`,
      severity: "info",
      meta: { diskBefore, diskAfter },
    });

    return {
      ran: true,
      diskBefore,
      diskAfter,
      builderOut: builder.stdout?.slice(0, 500),
      imageOut: images.stdout?.slice(0, 500),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ran: false, error: message, diskBefore };
  }
}

/** À appeler depuis la collecte metrics (léger, max 1×/semaine). */
export async function maybeRunWeeklyDockerPrune(): Promise<void> {
  try {
    await runDockerPrune(false);
  } catch (err) {
    console.error("[maintenance] weekly prune failed", err);
  }
}
