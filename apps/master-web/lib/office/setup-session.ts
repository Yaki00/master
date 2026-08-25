import {
  appendOfficeEvent,
  getAggregatedOfficeAgent,
  upsertOfficeAgent,
} from "@/lib/db/office";
import { loadMailImapConfig, saveMailImapConfig, type MailImapConfig } from "@/lib/db/office-secrets";
import { syncMailSecretsToInfisical } from "@/lib/office/infisical-mail";
import { verifyMailImap } from "@/lib/office/mail-imap";

export type SetupKind = "mail";

export type MailSetupStep =
  | "ask_host"
  | "ask_user"
  | "ask_pass"
  | "ask_port"
  | "verify"
  | "done";

export type MailSetupDraft = {
  host?: string;
  user?: string;
  port?: number;
  secure?: boolean;
  /** Mot de passe JAMAIS persisté dans meta/events — clé mémoire seulement. */
  hasPass?: boolean;
};

export type SetupSession = {
  kind: SetupKind;
  step: MailSetupStep;
  draft: MailSetupDraft;
  pendingAction?: "analyze" | "triage" | null;
  startedAt: string;
};

/** Passwords éphémères hors SQLite / events. */
const passMemory = new Map<string, string>();

const CANCEL_RE = /^(annule|annuler|cancel|stop|oublie|abandonner)\b/i;

export function parseMailConnectIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\b(?:branche|connecter?|connecte|configure|configurer|setup)\b/i.test(t) &&
      /\b(?:mail|mails?|bo[iî]te|imap|inbox|courriel|e-?mail)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function getSetupSession(agentId: string): SetupSession | null {
  const agent = getAggregatedOfficeAgent(agentId);
  const raw = agent?.meta?.setupSession;
  if (!raw || typeof raw !== "object") return null;
  const s = raw as SetupSession;
  if (s.kind !== "mail" || !s.step) return null;
  return s;
}

function persistSession(agentId: string, session: SetupSession | null, extraMeta: Record<string, unknown> = {}): void {
  const agent = getAggregatedOfficeAgent(agentId);
  const meta = { ...(agent?.meta ?? {}), ...extraMeta };
  if (session) meta.setupSession = session;
  else delete meta.setupSession;
  upsertOfficeAgent({
    id: agentId,
    kind: "openclaw",
    name: agent?.name ?? agentId.replace(/^openclaw:/, ""),
    status: session ? "waiting" : (agent?.status === "waiting" ? "idle" : (agent?.status ?? "idle")),
    task: session ? "branchement mail" : (agent?.task ?? null),
    currentAction: session ? "setup-mail" : null,
    lastSeenAt: new Date().toISOString(),
    meta,
  });
}

function reply(agentId: string, userText: string, agentText: string, redactUser = false): void {
  appendOfficeEvent(agentId, "user_message", {
    text: redactUser ? "[identifiants mail — masqués]" : userText,
    role: "user",
    setup: true,
  });
  appendOfficeEvent(agentId, "agent_message", {
    text: agentText,
    role: "agent",
    setup: true,
  });
}

export function startMailSetup(
  agentId: string,
  pendingAction: "analyze" | "triage" | null = null,
): { reply: string } {
  const session: SetupSession = {
    kind: "mail",
    step: "ask_host",
    draft: {},
    pendingAction,
    startedAt: new Date().toISOString(),
  };
  passMemory.delete(agentId);
  persistSession(agentId, session);
  const text = [
    "La boîte mail n’est pas branchée.",
    "Je te guide pour la connecter (IMAP).",
    "",
    "1/4 — Indique le serveur IMAP (ex. `imap.mail.ovh.net`, `imap.gmail.com`, `outlook.office365.com`).",
    "Tu peux aussi écrire `annuler` pour abandonner.",
  ].join("\n");
  return { reply: text };
}

function parseHostLine(text: string): string | null {
  const t = text.trim();
  const m = t.match(/(?:imap[^\s]*\.[^\s]+|[a-z0-9.-]+\.[a-z]{2,})/i);
  if (m) return m[0]!.replace(/[.,;]+$/, "");
  if (/^[a-z0-9.-]+$/i.test(t) && t.includes(".")) return t;
  return null;
}

function parseUserLine(text: string): string | null {
  const t = text.trim();
  const m = t.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  if (m) return m[0]!;
  if (t.length >= 3 && !/\s/.test(t)) return t;
  return null;
}

function parsePortLine(text: string): { port: number; secure: boolean } | null {
  const t = text.trim().toLowerCase();
  if (/^(ok|oui|default|défaut|993)$/i.test(t)) return { port: 993, secure: true };
  if (/^143$/.test(t)) return { port: 143, secure: false };
  const m = t.match(/\b(\d{2,5})\b/);
  if (!m) return null;
  const port = Number(m[1]);
  if (port < 1 || port > 65535) return null;
  const secure = port === 993 || /\bssl|tls|secure\b/i.test(t);
  return { port, secure: port === 143 ? false : secure || port === 993 };
}

export type SetupHandleResult = {
  handled: boolean;
  reply?: string;
  completed?: boolean;
  launchMail?: "analyze" | "triage";
  config?: MailImapConfig;
};

export async function handleSetupMessage(agentId: string, message: string): Promise<SetupHandleResult> {
  const session = getSetupSession(agentId);
  if (!session || session.kind !== "mail") return { handled: false };

  if (CANCEL_RE.test(message.trim())) {
    passMemory.delete(agentId);
    persistSession(agentId, null);
    const text = "Branchement mail annulé. Tu pourras relancer avec « branche mon mail ».";
    reply(agentId, message, text);
    return { handled: true, reply: text };
  }

  let step = session.step;
  const draft = { ...session.draft };

  if (step === "ask_host") {
    const host = parseHostLine(message);
    if (!host) {
      const text = "Je n’ai pas reconnu le serveur. Exemple : `imap.mail.ovh.net`";
      reply(agentId, message, text);
      return { handled: true, reply: text };
    }
    draft.host = host;
    step = "ask_user";
    persistSession(agentId, { ...session, step, draft });
    const text = `Serveur noté : ${host}\n\n2/4 — Adresse e-mail / identifiant IMAP ?`;
    reply(agentId, message, text);
    return { handled: true, reply: text };
  }

  if (step === "ask_user") {
    const user = parseUserLine(message);
    if (!user) {
      const text = "Identifiant invalide. Envoie ton adresse mail (ex. `toi@pixelbrain.fr`).";
      reply(agentId, message, text);
      return { handled: true, reply: text };
    }
    draft.user = user;
    step = "ask_pass";
    persistSession(agentId, { ...session, step, draft });
    const text =
      `Compte : ${user}\n\n3/4 — Mot de passe IMAP (ou mot de passe d’application Gmail/OVH).\n` +
      `Il ne sera **pas** affiché dans les logs du chat.`;
    reply(agentId, message, text);
    return { handled: true, reply: text };
  }

  if (step === "ask_pass") {
    const pass = message.trim();
    if (pass.length < 3) {
      const text = "Mot de passe trop court. Réessaie, ou `annuler`.";
      reply(agentId, "[mot de passe]", text, true);
      return { handled: true, reply: text };
    }
    passMemory.set(agentId, pass);
    draft.hasPass = true;
    step = "ask_port";
    persistSession(agentId, { ...session, step, draft });
    const text =
      "Mot de passe reçu (masqué).\n\n4/4 — Port IMAP ? Réponds `993` (recommandé SSL) ou `143`, ou simplement `ok` pour 993.";
    reply(agentId, "[mot de passe]", text, true);
    return { handled: true, reply: text };
  }

  if (step === "ask_port" || step === "verify") {
    const parsed = parsePortLine(message) ?? { port: 993, secure: true };
    draft.port = parsed.port;
    draft.secure = parsed.secure;
    const pass = passMemory.get(agentId);
    if (!pass || !draft.host || !draft.user) {
      passMemory.delete(agentId);
      persistSession(agentId, null);
      const text = "Session incomplète — relance avec « branche mon mail ».";
      reply(agentId, message, text);
      return { handled: true, reply: text };
    }

    persistSession(agentId, { ...session, step: "verify", draft });
    reply(
      agentId,
      message,
      `Je teste la connexion IMAP ${draft.host}:${draft.port}…`,
    );

    const verify = await verifyMailImap({
      host: draft.host,
      port: draft.port,
      user: draft.user,
      pass,
      secure: draft.secure ?? true,
    });

    if (!verify.ok) {
      passMemory.delete(agentId);
      const retry: SetupSession = {
        ...session,
        step: "ask_pass",
        draft: { host: draft.host, user: draft.user, port: draft.port, secure: draft.secure },
      };
      persistSession(agentId, retry);
      const text = [
        `Connexion échouée : ${verify.error}`,
        "",
        "Vérifie le mot de passe (souvent un « mot de passe d’application »).",
        "Renvoie le mot de passe, ou `annuler`.",
      ].join("\n");
      appendOfficeEvent(agentId, "agent_message", { text, role: "agent", setup: true });
      return { handled: true, reply: text };
    }

    const cfg: MailImapConfig = {
      host: draft.host,
      port: draft.port!,
      user: draft.user,
      pass,
      secure: draft.secure ?? true,
      verifiedAt: new Date().toISOString(),
    };
    saveMailImapConfig(cfg);
    passMemory.delete(agentId);
    const sync = await syncMailSecretsToInfisical(cfg);
    persistSession(agentId, null);

    const pending = session.pendingAction ?? "analyze";
    const text = [
      `Boîte branchée — INBOX OK (${verify.mailbox}).`,
      sync.ok ? "Secrets aussi poussés vers Infisical." : `Note : ${sync.detail}`,
      "",
      pending ? "Je lance l’analyse de ta boîte maintenant…" : "Tu peux dire « analyse ma boîte mail ».",
    ].join("\n");
    appendOfficeEvent(agentId, "agent_message", { text, role: "agent", setup: true, mailConnected: true });
    return {
      handled: true,
      reply: text,
      completed: true,
      launchMail: pending,
      config: cfg,
    };
  }

  return { handled: false };
}

export function clearSetupPasswords(): void {
  passMemory.clear();
}

/** Test helper */
export function __setPassForTest(agentId: string, pass: string): void {
  passMemory.set(agentId, pass);
}
