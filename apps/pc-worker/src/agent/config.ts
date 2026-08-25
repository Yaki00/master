import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export type ModelRole = "fast" | "reason" | "vision";

export type AgentConfig = {
  rootDir: string;
  skillsDir: string;
  auditLog: string;
  modelsPath: string;
  ollamaBase: string;
  models: Record<ModelRole, string>;
  maxSteps: number;
  maxMinutes: number;
  display: string;
  appAllowlist: string[];
  shellAllowlist: string[];
  chatgptUrl: string;
};

const DEFAULT_MODELS: Record<ModelRole, string> = {
  fast: "llama3.2:3b",
  reason: "qwen2.5:7b",
  vision: "llava:7b",
};

export function agentRoot(): string {
  return process.env.PC_AGENT_DIR || join(homedir(), ".master-pc-agent");
}

export function loadAgentConfig(): AgentConfig {
  const rootDir = agentRoot();
  mkdirSync(rootDir, { recursive: true });
  mkdirSync(join(rootDir, "skills"), { recursive: true });

  const modelsPath = join(rootDir, "models.json");
  let models = { ...DEFAULT_MODELS };
  if (existsSync(modelsPath)) {
    try {
      const raw = JSON.parse(readFileSync(modelsPath, "utf8")) as Partial<Record<ModelRole, string>>;
      models = { ...models, ...raw };
    } catch {
      /* keep defaults */
    }
  } else {
    writeFileSync(modelsPath, JSON.stringify(DEFAULT_MODELS, null, 2));
  }

  return {
    rootDir,
    skillsDir: join(rootDir, "skills"),
    auditLog: join(rootDir, "audit.log"),
    modelsPath,
    ollamaBase: (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
    models,
    maxSteps: Number(process.env.PC_AGENT_MAX_STEPS ?? "40"),
    maxMinutes: Number(process.env.PC_AGENT_MAX_MINUTES ?? "25"),
    display: process.env.DISPLAY || ":0",
    appAllowlist: (process.env.PC_APP_ALLOWLIST || "cursor,gnome-terminal,x-terminal-emulator,firefox,google-chrome,chromium,chromium-browser,nautilus,code")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    shellAllowlist: (
      process.env.PC_SHELL_ALLOWLIST ||
      "uname,df,uptime,npm,pnpm,node,git,ls,pwd,cat,head,tail,date,whoami,echo,which,curl,wget,python3,pip,ollama"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    chatgptUrl: process.env.CHATGPT_URL || "https://chatgpt.com",
  };
}
