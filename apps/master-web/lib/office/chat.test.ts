import { describe, expect, it } from "vitest";
import {
  agentStatusLabel,
  bubbleAlign,
  eventsToBubbles,
  formatBubbleTime,
  formatTimeSeparator,
  needsTimeSeparator,
  resolveBubbleRole,
  rosterTaskLine,
  truncateRosterTask,
} from "./chat";
import type { OfficeCommand, OfficeEvent } from "./types";

function ev(partial: Partial<OfficeEvent> & Pick<OfficeEvent, "id" | "kind">): OfficeEvent {
  return {
    agentId: "openclaw:main",
    payload: {},
    createdAt: "2026-08-24T12:00:00.000Z",
    ...partial,
  };
}

describe("eventsToBubbles", () => {
  it("garde user + agent, ignore le spam command_*", () => {
    const events = [
      ev({ id: "1", kind: "user_message", payload: { text: "salut", role: "user" }, createdAt: "2026-08-24T12:00:01.000Z" }),
      ev({ id: "2", kind: "command_pause", payload: { role: "system" }, createdAt: "2026-08-24T12:00:02.000Z" }),
      ev({ id: "3", kind: "agent_message", payload: { text: "ok", role: "agent" }, createdAt: "2026-08-24T12:00:03.000Z" }),
      ev({
        id: "4",
        kind: "agent_message",
        payload: { text: "best-effort pause: statut local", role: "agent" },
        createdAt: "2026-08-24T12:00:04.000Z",
      }),
    ];
    const bubbles = eventsToBubbles(events);
    expect(bubbles.map((b) => b.text)).toEqual(["salut", "ok"]);
    expect(bubbles.every((b) => b.role !== "system")).toBe(true);
  });

  it("ajoute les messages pending", () => {
    const pending: OfficeCommand[] = [
      {
        id: "c1",
        agentId: "openclaw:main",
        kind: "message",
        payload: { text: "en cours…" },
        status: "claimed",
        claimedBy: "mac",
        result: null,
        createdAt: "2026-08-24T12:00:05.000Z",
        updatedAt: "2026-08-24T12:00:05.000Z",
      },
      {
        id: "c2",
        agentId: "openclaw:main",
        kind: "pause",
        payload: {},
        status: "queued",
        claimedBy: null,
        result: null,
        createdAt: "2026-08-24T12:00:06.000Z",
        updatedAt: "2026-08-24T12:00:06.000Z",
      },
    ];
    const bubbles = eventsToBubbles([], pending);
    expect(bubbles.map((b) => `${b.role}:${b.text}`)).toEqual(["user:en cours…", "agent:…"]);
    expect(bubbles[0]?.pending).toBe(true);
    expect(bubbles[1]?.pending).toBe(true);
  });

  it("montre pause/stop avec texte comme system", () => {
    const bubbles = eventsToBubbles([
      ev({
        id: "p",
        kind: "command_pause",
        payload: { text: "Pause demandée au Mac", role: "system" },
      }),
    ]);
    expect(bubbles).toEqual([
      expect.objectContaining({ role: "system", text: "Pause demandée au Mac" }),
    ]);
  });

  it("montre les échecs comme system", () => {
    const bubbles = eventsToBubbles([
      ev({
        id: "f",
        kind: "command_failed",
        payload: { text: "timeout", role: "system" },
      }),
    ]);
    expect(bubbles).toEqual([
      expect.objectContaining({ role: "system", text: "timeout" }),
    ]);
  });

  it("ne dump pas la ligne CLI openclaw", () => {
    const bubbles = eventsToBubbles([
      ev({
        id: "cli",
        kind: "command_failed",
        payload: {
          text: "Command failed: openclaw agent --agent main --message ping --timeout 90 --json",
          role: "system",
        },
      }),
    ]);
    expect(bubbles[0]?.text).toMatch(/pas pu répondre/i);
    expect(bubbles[0]?.text).not.toMatch(/openclaw agent/);
  });

  it("montre l’interim et masque le … pendant un claimed", () => {
    const pending: OfficeCommand[] = [
      {
        id: "c1",
        agentId: "openclaw:main",
        kind: "message",
        payload: { text: "délègue une mission" },
        status: "claimed",
        claimedBy: "mac",
        result: null,
        createdAt: "2026-08-24T12:00:05.000Z",
        updatedAt: "2026-08-24T12:00:05.000Z",
      },
    ];
    const bubbles = eventsToBubbles(
      [
        ev({
          id: "i1",
          kind: "agent_message",
          payload: {
            text: "Compris — je délègue et je reviens avec la réponse finale.",
            role: "agent",
            interim: true,
            commandId: "c1",
          },
          createdAt: "2026-08-24T12:00:06.000Z",
        }),
      ],
      pending,
    );
    expect(bubbles.some((b) => b.text === "…")).toBe(false);
    expect(bubbles.some((b) => b.pending && /délègue/i.test(b.text))).toBe(true);
  });

  it("dédoublonne optimistic + user_message identiques", () => {
    const bubbles = eventsToBubbles([
      ev({
        id: "optimistic-1",
        kind: "user_message",
        payload: { text: "ping", role: "user" },
        createdAt: "2026-08-24T12:00:01.000Z",
      }),
      ev({
        id: "real",
        kind: "user_message",
        payload: { text: "ping", role: "user" },
        createdAt: "2026-08-24T12:00:02.000Z",
      }),
    ]);
    expect(bubbles.filter((b) => b.text === "ping")).toHaveLength(1);
  });

  it("ignore reprendre auto et command_resume", () => {
    const bubbles = eventsToBubbles([
      ev({
        id: "r",
        kind: "command_resume",
        payload: { text: "reprendre", role: "user" },
      }),
      ev({
        id: "j",
        kind: "resumed",
        payload: { userReply: "ok continue" },
        createdAt: "2026-08-24T12:00:08.000Z",
      }),
    ]);
    expect(bubbles.map((b) => b.text)).toEqual(["ok continue"]);
  });

  it("parse une réponse JSON OpenClaw", () => {
    const bubbles = eventsToBubbles([
      ev({
        id: "a",
        kind: "agent_message",
        payload: {
          role: "agent",
          text: JSON.stringify({ payloads: [{ text: "Le build est vert." }] }),
        },
      }),
    ]);
    expect(bubbles.map((b) => b.text)).toEqual(["Le build est vert."]);
  });

  it("montre completed / progress job comme réponse agent", () => {
    const bubbles = eventsToBubbles([
      ev({
        id: "p",
        kind: "progress",
        payload: { message: "clone repo…" },
        createdAt: "2026-08-24T12:00:01.000Z",
      }),
      ev({
        id: "c",
        kind: "completed",
        payload: { resultText: "tests ok" },
        createdAt: "2026-08-24T12:00:02.000Z",
      }),
      ev({ id: "x", kind: "claimed", payload: { workerId: "pc" }, createdAt: "2026-08-24T12:00:00.000Z" }),
    ]);
    expect(bubbles.map((b) => b.role + ":" + b.text)).toEqual(["agent:clone repo…", "agent:tests ok"]);
  });

  it("ne garde qu’un tick Toujours en cours par commande", () => {
    const bubbles = eventsToBubbles([
      ev({
        id: "p1",
        kind: "progress",
        payload: { text: "Toujours en cours… (15s)", role: "system", progress: true, commandId: "cmd1" },
        createdAt: "2026-08-24T12:00:08.000Z",
      }),
      ev({
        id: "p2",
        kind: "progress",
        payload: { text: "Toujours en cours… (30s)", role: "system", progress: true, commandId: "cmd1" },
        createdAt: "2026-08-24T12:00:09.000Z",
      }),
      ev({
        id: "c",
        kind: "agent_message",
        payload: { text: "fait", role: "agent" },
        createdAt: "2026-08-24T12:00:10.000Z",
      }),
    ]);
    expect(bubbles.filter((b) => /Toujours en cours/.test(b.text))).toHaveLength(1);
    expect(bubbles.some((b) => b.text.includes("30s"))).toBe(true);
    expect(bubbles.some((b) => b.text === "fait")).toBe(true);
  });
});

describe("bubble UI helpers", () => {
  it("aligne user à droite, system au centre, agent à gauche", () => {
    expect(bubbleAlign("user")).toBe("right");
    expect(bubbleAlign("system")).toBe("center");
    expect(bubbleAlign("agent")).toBe("left");
  });

  it("résout le rôle visuel depuis l'agent", () => {
    expect(resolveBubbleRole("user")).toBe("user");
    expect(resolveBubbleRole("system")).toBe("system");
    expect(resolveBubbleRole("agent", { id: "openclaw:chef", kind: "openclaw", name: "chef" })).toBe("chef");
    expect(resolveBubbleRole("agent", null)).toBe("worker");
  });

  it("tronque la tâche roster", () => {
    expect(truncateRosterTask(null)).toBe("—");
    expect(truncateRosterTask("court")).toBe("court");
    expect(truncateRosterTask("x".repeat(40)).length).toBeLessThanOrEqual(28);
  });

  it("masque idle bruit sur roster", () => {
    expect(rosterTaskLine({ status: "idle", task: "idle", currentAction: null })).toBe("—");
    expect(rosterTaskLine({ status: "working", task: null, currentAction: "build api" })).toBe("build api");
  });

  it("libellé status agent", () => {
    expect(agentStatusLabel("working")).toBe("Actif");
    expect(agentStatusLabel("idle")).toBe("Idle");
  });
});

describe("bubble timestamps", () => {
  it("formate l'heure locale HH:MM", () => {
    const t = formatBubbleTime("2026-08-24T14:05:09.123Z");
    expect(t).toMatch(/^\d{2}:\d{2}$/);
  });

  it("affiche un séparateur après 5 min d'écart", () => {
    expect(needsTimeSeparator(null, "2026-08-24T12:00:00.000Z")).toBe(true);
    expect(needsTimeSeparator("2026-08-24T12:00:00.000Z", "2026-08-24T12:04:00.000Z")).toBe(false);
    expect(needsTimeSeparator("2026-08-24T12:00:00.000Z", "2026-08-24T12:06:00.000Z")).toBe(true);
  });

  it("séparateur relatif il y a X min", () => {
    const now = Date.parse("2026-08-24T12:10:00.000Z");
    expect(formatTimeSeparator("2026-08-24T12:08:00.000Z", now)).toBe("Il y a 2 min");
  });
});
