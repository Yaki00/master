import { describe, expect, it } from "vitest";
import {
  parsePmCancelProject,
  parsePmPlanGateReply,
  parsePmProjectStart,
  parsePmStatusQuery,
} from "./pm-intent";

describe("pm-intent", () => {
  it("détecte démarrage PM", () => {
    expect(
      parsePmProjectStart(
        "Lance un projet surveillance eBay GPU avec une équipe adaptée",
      ),
    ).toBeTruthy();
    expect(
      parsePmProjectStart("Organise une équipe pour connecteur prix eBay"),
    ).toBeTruthy();
    expect(parsePmProjectStart("projet complexe alerte quotidienne")).toBeTruthy();
  });

  it("ignore sentinelle simple et chat banal", () => {
    expect(parsePmProjectStart("surveille RTX 4090 toutes les 15 min")).toBeNull();
    expect(
      parsePmProjectStart('Crée un projet « Sentinelle 4090 » récurrent pour surveiller RTX'),
    ).toBeNull();
    expect(parsePmProjectStart("salut")).toBeNull();
  });

  it("gate plan", () => {
    expect(parsePmPlanGateReply("ok go")).toBe("approve");
    expect(parsePmPlanGateReply("approuvé")).toBe("approve");
    expect(parsePmPlanGateReply("rejette")).toBe("reject");
    expect(parsePmPlanGateReply("révision ajoute mgr-lab")).toBe("revise");
    expect(parsePmPlanGateReply("bonjour tout le monde")).toBeNull();
  });

  it("status et cancel", () => {
    expect(parsePmStatusQuery("où en est-on ?")).toBe(true);
    expect(parsePmStatusQuery("statut du projet")).toBe(true);
    expect(parsePmStatusQuery("salut")).toBe(false);
    expect(parsePmCancelProject("annule le projet GPU eBay")?.titleQuery).toMatch(/GPU|eBay/i);
    expect(parsePmCancelProject("salut")).toBeNull();
  });
});
