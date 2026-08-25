import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { getDb } from "@/lib/db/sqlite";

export type MailImapConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
  verifiedAt: string | null;
};

function secretKey(): Buffer {
  const material = process.env.NEXTAUTH_SECRET || process.env.MASTER_AUTH_PASSWORD || "master-dev-secret";
  return createHash("sha256").update(material).digest();
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

function decrypt(payload: string): string {
  const [ver, ivB64, tagB64, dataB64] = payload.split(":");
  if (ver !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("secret payload invalide");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

export function ensureOfficeSecretsTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS office_secrets (
      key TEXT PRIMARY KEY,
      value_enc TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function setOfficeSecret(key: string, value: string): void {
  ensureOfficeSecretsTable();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO office_secrets (key, value_enc, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`,
    )
    .run(key, encrypt(value), now);
}

export function getOfficeSecret(key: string): string | null {
  ensureOfficeSecretsTable();
  const row = getDb().prepare(`SELECT value_enc FROM office_secrets WHERE key = ?`).get(key) as
    | { value_enc: string }
    | undefined;
  if (!row?.value_enc) return null;
  try {
    return decrypt(row.value_enc);
  } catch {
    return null;
  }
}

export function deleteOfficeSecret(key: string): void {
  ensureOfficeSecretsTable();
  getDb().prepare(`DELETE FROM office_secrets WHERE key = ?`).run(key);
}

const MAIL_KEYS = {
  host: "MAIL_IMAP_HOST",
  port: "MAIL_IMAP_PORT",
  user: "MAIL_IMAP_USER",
  pass: "MAIL_IMAP_PASS",
  secure: "MAIL_IMAP_SECURE",
  verifiedAt: "MAIL_IMAP_VERIFIED_AT",
} as const;

export function saveMailImapConfig(cfg: MailImapConfig): void {
  setOfficeSecret(MAIL_KEYS.host, cfg.host);
  setOfficeSecret(MAIL_KEYS.port, String(cfg.port));
  setOfficeSecret(MAIL_KEYS.user, cfg.user);
  setOfficeSecret(MAIL_KEYS.pass, cfg.pass);
  setOfficeSecret(MAIL_KEYS.secure, cfg.secure ? "1" : "0");
  if (cfg.verifiedAt) setOfficeSecret(MAIL_KEYS.verifiedAt, cfg.verifiedAt);
  // Runtime immediate
  process.env.MAIL_IMAP_HOST = cfg.host;
  process.env.MAIL_IMAP_PORT = String(cfg.port);
  process.env.MAIL_IMAP_USER = cfg.user;
  process.env.MAIL_IMAP_PASS = cfg.pass;
  process.env.MAIL_IMAP_SECURE = cfg.secure ? "1" : "0";
}

export function loadMailImapConfig(): MailImapConfig | null {
  const host = getOfficeSecret(MAIL_KEYS.host) || process.env.MAIL_IMAP_HOST?.trim() || "";
  const user = getOfficeSecret(MAIL_KEYS.user) || process.env.MAIL_IMAP_USER?.trim() || "";
  const pass = getOfficeSecret(MAIL_KEYS.pass) || process.env.MAIL_IMAP_PASS?.trim() || "";
  if (!host || !user || !pass) return null;
  const portRaw = getOfficeSecret(MAIL_KEYS.port) || process.env.MAIL_IMAP_PORT || "993";
  const port = Number(portRaw) || 993;
  const secureRaw = getOfficeSecret(MAIL_KEYS.secure) || process.env.MAIL_IMAP_SECURE || "1";
  const verifiedAt = getOfficeSecret(MAIL_KEYS.verifiedAt);
  return {
    host,
    port,
    user,
    pass,
    secure: secureRaw !== "0" && secureRaw !== "false",
    verifiedAt,
  };
}

export function clearMailImapConfig(): void {
  for (const k of Object.values(MAIL_KEYS)) deleteOfficeSecret(k);
  delete process.env.MAIL_IMAP_HOST;
  delete process.env.MAIL_IMAP_PORT;
  delete process.env.MAIL_IMAP_USER;
  delete process.env.MAIL_IMAP_PASS;
  delete process.env.MAIL_IMAP_SECURE;
}
