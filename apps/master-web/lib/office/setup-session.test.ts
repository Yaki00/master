import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb } from "@/lib/db/sqlite";
import { listOfficeEvents, upsertOfficeAgent } from "@/lib/db/office";
import { loadMailImapConfig } from "@/lib/db/office-secrets";
import {
  getSetupSession,
  handleSetupMessage,
  parseMailConnectIntent,
  startMailSetup,
  __setPassForTest,
} from "@/lib/office/setup-session";

vi.mock("@/lib/office/mail-imap", () => ({
  verifyMailImap: vi.fn(async () => ({ ok: true, mailbox: "INBOX" })),
  fetchInboxPreview: vi.fn(async () => ({ ok: true, messages: [] })),
  formatInboxBrief: vi.fn(() => ""),
}));

vi.mock("@/lib/office/infisical-mail", () => ({
  syncMailSecretsToInfisical: vi.fn(async () => ({ ok: false, detail: "skip test" })),
  isInfisicalConfigured: vi.fn(() => false),
}));

describe("setup-session mail wizard", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "master-setup-"));
    process.env.MASTER_DB_PATH = join(dir, "t.db");
    process.env.NEXTAUTH_SECRET = "test-secret-for-aes-256-gcm-key!!";
    delete process.env.MAIL_IMAP_HOST;
    delete process.env.MAIL_IMAP_USER;
    delete process.env.MAIL_IMAP_PASS;
    closeDb();
    upsertOfficeAgent({
      id: "openclaw:office",
      kind: "openclaw",
      name: "Réception",
      status: "idle",
      task: null,
      currentAction: null,
      lastSeenAt: new Date().toISOString(),
      meta: {},
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("parseMailConnectIntent", () => {
    expect(parseMailConnectIntent("branche mon mail")).toBe(true);
    expect(parseMailConnectIntent("connecter la boîte mail")).toBe(true);
    expect(parseMailConnectIntent("salut")).toBe(false);
  });

  it("parcours multi-tours jusqu’à verify", async () => {
    const start = startMailSetup("openclaw:office", "analyze");
    expect(start.reply).toMatch(/serveur IMAP/i);
    expect(getSetupSession("openclaw:office")?.step).toBe("ask_host");

    let r = await handleSetupMessage("openclaw:office", "imap.mail.ovh.net");
    expect(r.handled).toBe(true);
    expect(r.reply).toMatch(/2\/4/);
    expect(getSetupSession("openclaw:office")?.draft.host).toBe("imap.mail.ovh.net");

    r = await handleSetupMessage("openclaw:office", "moi@pixelbrain.fr");
    expect(r.reply).toMatch(/3\/4/);

    r = await handleSetupMessage("openclaw:office", "super-secret-pass");
    expect(r.reply).toMatch(/4\/4/);
    const events = listOfficeEvents("openclaw:office");
    expect(events.some((e) => String((e.payload as { text?: string }).text || "").includes("super-secret"))).toBe(
      false,
    );

    r = await handleSetupMessage("openclaw:office", "ok");
    expect(r.completed).toBe(true);
    expect(r.launchMail).toBe("analyze");
    expect(getSetupSession("openclaw:office")).toBeNull();

    const cfg = loadMailImapConfig();
    expect(cfg?.host).toBe("imap.mail.ovh.net");
    expect(cfg?.user).toBe("moi@pixelbrain.fr");
    expect(cfg?.pass).toBe("super-secret-pass");
    expect(cfg?.port).toBe(993);
  });

  it("annuler efface la session", async () => {
    startMailSetup("openclaw:office", null);
    __setPassForTest("openclaw:office", "x");
    const r = await handleSetupMessage("openclaw:office", "annuler");
    expect(r.handled).toBe(true);
    expect(getSetupSession("openclaw:office")).toBeNull();
  });
});
