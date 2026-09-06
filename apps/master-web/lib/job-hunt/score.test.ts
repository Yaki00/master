import { describe, expect, it } from "vitest";
import { htmlToPlainText, looksLikeHtml } from "./html-text";
import { scoreListing } from "./score";
import type { JobHuntProfile } from "./types";

const baseProfile: JobHuntProfile = {
  id: "p1",
  fullName: "Yaki",
  email: "a@b.c",
  phone: "",
  location: "France",
  timezone: "Europe/Paris",
  cvBase: "",
  cvFileName: "",
  cvAnalyzedAt: null,
  stack: ["typescript", "react", "node.js", "docker"],
  targetRoles: ["full stack", "software engineer"],
  languages: ["français", "anglais"],
  minSalaryEur: null,
  remoteOnly: true,
  preferredRegions: ["europe", "france"],
  coverLetterTemplate: "",
  platforms: [],
  autoSearchEnabled: true,
  autoApplyEnabled: false,
  minScoreAutoApply: 55,
  maxApplicationsPerDay: 8,
  searchIntervalHours: 4,
  lastSearchAt: null,
  lastAutoRunAt: null,
  updatedAt: new Date().toISOString(),
};

describe("htmlToPlainText", () => {
  it("retire les balises HTML Remotive", () => {
    const raw =
      "<p>Hello <strong>world</strong></p><ul><li>4+ years</li></ul><img src='x.gif'/>";
    expect(looksLikeHtml(raw)).toBe(true);
    const plain = htmlToPlainText(raw);
    expect(plain).not.toMatch(/</);
    expect(plain).toMatch(/Hello/);
    expect(plain).toMatch(/4\+ years/);
  });
});

describe("scoreListing anti-spam", () => {
  it("pénalise Lemon.io / tag soup marketplace", () => {
    const lemon = scoreListing(
      {
        title: "Senior DevOps Engineer",
        company: "Lemon.io",
        description: "marketplace that connects you with startups. Laravel Nuxt Heroku.",
        tags: [
          "react",
          "python",
          "golang",
          "rust",
          "php",
          "wordpress",
          "shopify",
          "unity",
          "blockchain",
          "typescript",
          "node.js",
          "docker",
          "kubernetes",
          "java",
          "swift",
          "android",
          "ios",
          "ruby",
          "scala",
          "C#",
        ],
        location: "LATAM, Europe, USA",
        remoteType: "remote",
      },
      baseProfile,
    );
    const focused = scoreListing(
      {
        title: "Senior Full Stack Engineer",
        company: "Acme",
        description: "Remote Europe. TypeScript React Node.js Docker. Full stack product team.",
        tags: ["typescript", "react", "node.js", "docker"],
        location: "Europe",
        remoteType: "remote",
      },
      baseProfile,
    );
    expect(focused).toBeGreaterThan(lemon);
    expect(lemon).toBeLessThan(70);
  });
});
