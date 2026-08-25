import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb } from "@/lib/db/sqlite";
import { getOfficeCommand } from "@/lib/db/office";
import {
  buildMeetingStatusReply,
  MEETING_PARTICIPANT_TIMEOUT_MS,
  processMeetingAfterCommand,
  processMeetingTimeouts,
  startAllHandsMeeting,
} from "@/lib/office/meeting";
import { parseMeetingStatusQuery } from "@/lib/office/meeting-intent";

describe("meeting orchestrator", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "master-meet-"));
    process.env.MASTER_DB_PATH = join(dir, "t.db");
    closeDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("détecte status query réunion", () => {
    expect(parseMeetingStatusQuery("alors des nouvelles ?")).toBe(true);
  });

  it("lance N commandes réelles vers les participants", () => {
    const task = startAllHandsMeeting({
      brief: "meilleur objet eBay",
      facilitatorAgentId: "openclaw:office",
    });
    const parts = task.meta.participants as Array<{ agentId: string; commandId: string }>;
    expect(parts.length).toBe(4);
    for (const p of parts) {
      const cmd = getOfficeCommand(p.commandId);
      expect(cmd?.payload.forceOpenClaw).toBe(true);
      expect(cmd?.payload.meetingRound).toBe(true);
      expect(cmd?.agentId).toBe(p.agentId);
    }
  });

  it("collecte réponses puis synthèse chef", () => {
    const task = startAllHandsMeeting({
      brief: "meilleur objet eBay",
      facilitatorAgentId: "openclaw:office",
    });
    const parts = task.meta.participants as Array<{ agentId: string; commandId: string }>;

    for (const p of parts) {
      processMeetingAfterCommand(p.commandId, p.agentId, "done", `Proposition ${p.agentId}: item test`);
    }

    const updated = processMeetingAfterCommand(
      parts[0]!.commandId,
      parts[0]!.agentId,
      "done",
      "again",
    );
    // after all done, synthesis enqueued
    const fresh = buildMeetingStatusReply("openclaw:office");
    expect(fresh).toMatch(/synthèse|Chef|2\/4|3\/4|4\/4/i);
    expect(updated?.meta.synthesisCommandId || task.meta.synthesisCommandId).toBeTruthy();
  });

  it("status reply liste réponses réelles pas inventées", () => {
    const task = startAllHandsMeeting({
      brief: "ebay GPU",
      facilitatorAgentId: "openclaw:office",
    });
    const parts = task.meta.participants as Array<{ agentId: string; commandId: string }>;
    processMeetingAfterCommand(parts[0]!.commandId, parts[0]!.agentId, "done", "RTX 4090 d'occasion");

    const reply = buildMeetingStatusReply("openclaw:office");
    expect(reply).toMatch(/RTX 4090/);
    expect(reply).toMatch(/1\/4|en cours/i);
  });

  it("timeout partiel → synthèse Chef avec réponses disponibles", () => {
    const task = startAllHandsMeeting({
      brief: "ebay GPU",
      facilitatorAgentId: "openclaw:office",
    });
    const parts = task.meta.participants as Array<{ agentId: string; commandId: string }>;
    processMeetingAfterCommand(parts[0]!.commandId, parts[0]!.agentId, "done", "RTX 4090 d'occasion");

    const afterTimeout = processMeetingTimeouts(
      Date.now() + MEETING_PARTICIPANT_TIMEOUT_MS + 1000,
    );
    expect(afterTimeout?.meta.synthesisCommandId).toBeTruthy();
  });
});
