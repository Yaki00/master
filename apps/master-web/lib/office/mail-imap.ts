import { ImapFlow } from "imapflow";
import type { MailImapConfig } from "@/lib/db/office-secrets";

export type MailVerifyResult = { ok: true; mailbox: string } | { ok: false; error: string };

export type InboxMessage = {
  uid: number;
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

export async function verifyMailImap(cfg: Omit<MailImapConfig, "verifiedAt">): Promise<MailVerifyResult> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    socketTimeout: 20_000,
    greetingTimeout: 15_000,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const path = typeof client.mailbox === "object" && client.mailbox ? String(client.mailbox.path) : "INBOX";
      return { ok: true, mailbox: path };
    } finally {
      lock.release();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 240) };
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

/** Lit les N derniers messages (enveloppes + extrait texte court). */
export async function fetchInboxPreview(
  cfg: Omit<MailImapConfig, "verifiedAt">,
  limit = 8,
): Promise<{ ok: true; messages: InboxMessage[] } | { ok: false; error: string }> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    socketTimeout: 25_000,
    greetingTimeout: 15_000,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const messages: InboxMessage[] = [];
      const mailbox = client.mailbox;
      const exists = typeof mailbox === "object" && mailbox ? Number(mailbox.exists) : 0;
      if (exists <= 0) return { ok: true, messages: [] };
      const start = Math.max(1, exists - limit + 1);
      for await (const msg of client.fetch(`${start}:*`, { envelope: true, source: false, uid: true })) {
        const env = msg.envelope;
        const from =
          env?.from?.[0]?.address ||
          (env?.from?.[0]?.name ? String(env.from[0].name) : "") ||
          "(inconnu)";
        const subject = env?.subject || "(sans objet)";
        const date = env?.date ? new Date(env.date).toISOString() : new Date().toISOString();
        messages.push({
          uid: msg.uid,
          from,
          subject,
          date,
          snippet: subject.slice(0, 120),
        });
      }
      messages.sort((a, b) => b.uid - a.uid);
      return { ok: true, messages: messages.slice(0, limit) };
    } finally {
      lock.release();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 240) };
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

export function formatInboxBrief(messages: InboxMessage[]): string {
  if (messages.length === 0) return "Boîte vide — aucun message récent.";
  return messages
    .map((m, i) => `${i + 1}. [${m.date.slice(0, 16)}] De: ${m.from}\n   Objet: ${m.subject}`)
    .join("\n");
}
