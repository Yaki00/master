import { describe, expect, it } from "vitest";
import {
  computeNextRunAt,
  isMailConnected,
  parseMailBriefIntent,
  parseMonitorInterval,
  parseProductWatchBrief,
  parseWatchSpeechIntent,
  validateSentinelProject,
} from "./scenario-helpers";

describe("parseMonitorInterval", () => {
  it("parse minutes", () => {
    expect(parseMonitorInterval("surveille toutes les 15 min")?.minutes).toBe(15);
    expect(parseMonitorInterval("agent à l'affût toutes les 30 minutes")?.minutes).toBe(30);
  });

  it("parse heures", () => {
    expect(parseMonitorInterval("scan chaque heure")?.minutes).toBe(60);
    expect(parseMonitorInterval("veille toutes les 2h")?.minutes).toBe(120);
  });

  it("ignore invalide", () => {
    expect(parseMonitorInterval("salut")).toBeNull();
    expect(parseMonitorInterval("toutes les 0 min")).toBeNull();
  });
});

describe("parseProductWatchBrief", () => {
  it("extrait GPU, prix et sites", () => {
    const r = parseProductWatchBrief(
      "Surveille RTX 4090 <400€ sur eBay et Leboncoin catégorie Cartes graphiques",
    );
    expect(r?.product).toMatch(/RTX 4090/i);
    expect(r?.maxPriceEur).toBe(400);
    expect(r?.sites).toEqual(expect.arrayContaining(["ebay", "leboncoin"]));
    expect(r?.category).toMatch(/Cartes graphiques/i);
  });

  it("défaut ebay si site absent", () => {
    const r = parseProductWatchBrief("Veille RTX 3080 sous 350 euros");
    expect(r?.sites).toEqual(["ebay"]);
    expect(r?.maxPriceEur).toBe(350);
  });

  it("ignore hors veille", () => {
    expect(parseProductWatchBrief("salut chef")).toBeNull();
  });
});

describe("validateSentinelProject", () => {
  it("accepte sentinelle récurrente valide", () => {
    const r = validateSentinelProject({
      kind: "recurring",
      status: "active",
      brief: "Surveille RTX 4090 <400€ sur eBay",
      schedule: "toutes les 15 min",
      nextRunAt: new Date().toISOString(),
      meta: { watchType: "sentinel" },
    });
    expect(r.ok).toBe(true);
  });

  it("refuse ponctuel", () => {
    const r = validateSentinelProject({
      kind: "punctual",
      status: "active",
      brief: "Surveille RTX 4090",
      nextRunAt: new Date().toISOString(),
    });
    expect(r.ok).toBe(false);
  });

  it("refuse actif sans planning", () => {
    const r = validateSentinelProject({
      kind: "recurring",
      status: "active",
      brief: "Surveille RTX 4090 <400€",
      meta: { watchType: "sentinel" },
    });
    expect(r.ok).toBe(false);
  });
});

describe("computeNextRunAt", () => {
  it("avance de N minutes", () => {
    const from = "2026-08-24T10:00:00.000Z";
    expect(computeNextRunAt(from, 15)).toBe("2026-08-24T10:15:00.000Z");
  });
});

describe("parseWatchSpeechIntent", () => {
  it("combine brief produit et intervalle", () => {
    const r = parseWatchSpeechIntent("surveille RTX 4090 toutes les 15 min sur eBay");
    expect(r?.brief.product).toMatch(/RTX 4090/i);
    expect(r?.interval.minutes).toBe(15);
    expect(r?.schedule).toMatch(/15 min/);
  });
});

describe("parseMailBriefIntent", () => {
  it("détecte analyse boîte mail", () => {
    expect(parseMailBriefIntent("analyse ma boîte mail")?.action).toBe("analyze");
    expect(parseMailBriefIntent("trie mon inbox")?.action).toBe("triage");
    expect(parseMailBriefIntent("salut")).toBeNull();
  });
});

describe("isMailConnected", () => {
  it("false sans MAIL_IMAP_HOST", () => {
    const prev = process.env.MAIL_IMAP_HOST;
    delete process.env.MAIL_IMAP_HOST;
    expect(isMailConnected()).toBe(false);
    if (prev) process.env.MAIL_IMAP_HOST = prev;
  });
});
