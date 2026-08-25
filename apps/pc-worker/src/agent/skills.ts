import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "./config.js";
import { audit } from "./audit.js";

export type Skill = {
  name: string;
  path: string;
  body: string;
};

export function listSkills(cfg: AgentConfig): Skill[] {
  if (!existsSync(cfg.skillsDir)) return [];
  return readdirSync(cfg.skillsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const path = join(cfg.skillsDir, f);
      return {
        name: f.replace(/\.md$/i, ""),
        path,
        body: readFileSync(path, "utf8"),
      };
    });
}

export function skillsContext(cfg: AgentConfig, maxChars = 6000): string {
  const skills = listSkills(cfg);
  if (!skills.length) return "(aucune skill encore)";
  let out = "";
  for (const s of skills) {
    const chunk = `## skill:${s.name}\n${s.body.trim()}\n\n`;
    if (out.length + chunk.length > maxChars) break;
    out += chunk;
  }
  return out || "(aucune)";
}

export function loadSkill(cfg: AgentConfig, name: string): Skill | null {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const path = join(cfg.skillsDir, `${safe}.md`);
  if (!existsSync(path)) return null;
  return { name: safe, path, body: readFileSync(path, "utf8") };
}

export function saveSkill(cfg: AgentConfig, name: string, body: string): Skill {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || `skill_${Date.now()}`;
  const path = join(cfg.skillsDir, `${safe}.md`);
  const content = body.trim().startsWith("#")
    ? body.trim() + "\n"
    : `# ${safe}\n\n${body.trim()}\n`;
  writeFileSync(path, content, "utf8");
  audit(cfg, "save_skill", { name: safe, path });
  return { name: safe, path, body: content };
}
