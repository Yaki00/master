/** Fichiers / livrables attachés à un projet IA (workspace type IDE). */
import { getDb } from "@/lib/db/sqlite";

export type ProjectFile = {
  id: string;
  projectId: string;
  path: string;
  mime: string;
  size: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectFileDetail = ProjectFile & {
  content: string;
};

function rowToFile(row: Record<string, unknown>): ProjectFile {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    path: String(row.path),
    mime: String(row.mime ?? "text/plain"),
    size: Number(row.size ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\./g, "")
    .replace(/\/+/g, "/")
    .slice(0, 200);
}

export function listProjectFiles(projectId: string): ProjectFile[] {
  return getDb()
    .prepare(
      `SELECT id, project_id, path, mime, size, created_at, updated_at
       FROM office_project_files WHERE project_id = ? ORDER BY path ASC`,
    )
    .all(projectId)
    .map((r) => rowToFile(r as Record<string, unknown>));
}

export function getProjectFile(id: string): ProjectFileDetail | null {
  const row = getDb()
    .prepare(`SELECT * FROM office_project_files WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...rowToFile(row),
    content: String(row.content ?? ""),
  };
}

export function getProjectFileByPath(projectId: string, path: string): ProjectFileDetail | null {
  const p = normalizePath(path);
  const row = getDb()
    .prepare(`SELECT * FROM office_project_files WHERE project_id = ? AND path = ?`)
    .get(projectId, p) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...rowToFile(row),
    content: String(row.content ?? ""),
  };
}

export function upsertProjectFile(input: {
  projectId: string;
  path: string;
  content: string;
  mime?: string;
}): ProjectFileDetail {
  const path = normalizePath(input.path);
  if (!path) throw new Error("chemin invalide");
  const content = input.content.slice(0, 2_000_000);
  const mime = (input.mime || guessMime(path)).slice(0, 120);
  const now = new Date().toISOString();
  const existing = getProjectFileByPath(input.projectId, path);
  if (existing) {
    getDb()
      .prepare(
        `UPDATE office_project_files
         SET content = ?, mime = ?, size = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(content, mime, content.length, now, existing.id);
    return getProjectFile(existing.id)!;
  }
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO office_project_files
        (id, project_id, path, mime, size, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.projectId, path, mime, content.length, content, now, now);
  return getProjectFile(id)!;
}

export function deleteProjectFile(id: string): boolean {
  const info = getDb().prepare(`DELETE FROM office_project_files WHERE id = ?`).run(id);
  return info.changes > 0;
}

function guessMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".html")) return "text/html";
  if (lower.endsWith(".txt")) return "text/plain";
  return "text/plain";
}
