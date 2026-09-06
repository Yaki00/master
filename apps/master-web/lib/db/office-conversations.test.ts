import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "@/lib/db/sqlite";
import { appendOfficeEvent, clearOfficeEvents, upsertOfficeAgent } from "@/lib/db/office";
import {
  countMeaningfulMessages,
  getOfficeConversationDetail,
  listOfficeConversations,
  titleFromEvents,
} from "@/lib/db/office-conversations";
import type { OfficeEvent } from "@/lib/office/types";

describe("office-conversations", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "master-conv-"));
    process.env.MASTER_DB_PATH = join(dir, "t.db");
    closeDb();
    getDb();
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
  afterEach(() => closeDb());

  it("titleFromEvents prend le premier message user", () => {
    const events: OfficeEvent[] = [
      {
        id: "1",
        agentId: "openclaw:office",
        kind: "user_message",
        payload: { text: "  Mission veille GPU eBay  ", role: "user" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(titleFromEvents(events)).toMatch(/Mission veille GPU/);
    expect(countMeaningfulMessages(events)).toBe(1);
  });

  it("clear archive et isole par agent", () => {
    appendOfficeEvent("openclaw:office", "user_message", { text: "Sujet A research", role: "user" });
    appendOfficeEvent("openclaw:office", "agent_message", { text: "Réponse A détaillée", role: "agent" });
    clearOfficeEvents("openclaw:office");

    const archived = listOfficeConversations("openclaw:office", { status: "archived" });
    expect(archived).toHaveLength(1);
    const detail = getOfficeConversationDetail(archived[0]!.id)!;
    expect(detail.events).toHaveLength(2);
    expect(detail.status).toBe("archived");

    const active = listOfficeConversations("openclaw:office", { status: "active" });
    expect(active).toHaveLength(1);
  });
});
