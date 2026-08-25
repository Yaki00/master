import { describe, expect, it } from "vitest";
import { parseMeetingIntent, parseMeetingStatusQuery } from "./meeting-intent";

describe("parseMeetingIntent", () => {
  it("détecte les variantes françaises explicites", () => {
    expect(parseMeetingIntent("organise une réunion avec tout le monde pour eBay")).toBe(true);
    expect(parseMeetingIntent("organiser une réunion demain")).toBe(true);
    expect(parseMeetingIntent("réunion avec tout le monde sur les GPUs")).toBe(true);
    expect(parseMeetingIntent("meeting avec tout le monde pour le Q4")).toBe(true);
    expect(parseMeetingIntent("avec tout le monde, trouve le meilleur objet eBay")).toBe(true);
  });

  it("détecte le cas critique pro mode (message utilisateur)", () => {
    const msg =
      "organise une réunion avec tout le monde pour trouver le meilleur objet à vendre sur eBay";
    expect(parseMeetingIntent(msg)).toBe(true);
  });

  it("détecte les variantes anglaises / keywords", () => {
    expect(parseMeetingIntent("fait un meeting avec tout le monde pour ebay")).toBe(true);
    expect(parseMeetingIntent("all-hands sur la stratégie")).toBe(true);
    expect(parseMeetingIntent("convoque l'équipe")).toBe(true);
  });

  it("détecte typos et formulations naturelles", () => {
    expect(
      parseMeetingIntent(
        "fait un meatting avec les gens conserné et trouver un bon objet a vendre en ce moment sur ebay",
      ),
    ).toBe(true);
    expect(parseMeetingIntent("fait une réunion avec l'équipe pour eBay")).toBe(true);
    expect(parseMeetingIntent("lance un meeting — objet eBay")).toBe(true);
  });

  it("ignore le small talk", () => {
    expect(parseMeetingIntent("salut")).toBe(false);
    expect(parseMeetingIntent("tu fais quoi ?")).toBe(false);
    expect(parseMeetingIntent("")).toBe(false);
  });
});

describe("parseMeetingStatusQuery", () => {
  it("détecte les questions de suivi réunion", () => {
    expect(parseMeetingStatusQuery("alors des nouvelles ?")).toBe(true);
    expect(parseMeetingStatusQuery("où en est la réunion ?")).toBe(true);
  });

  it("ignore les messages trop longs", () => {
    expect(parseMeetingStatusQuery("a".repeat(121))).toBe(false);
  });
});
