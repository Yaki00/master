import { appendFileSync } from "node:fs";
import type { AgentConfig } from "./config.js";

export function audit(cfg: AgentConfig, event: string, detail: Record<string, unknown> = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...detail,
  });
  try {
    appendFileSync(cfg.auditLog, line + "\n", "utf8");
  } catch {
    /* ignore */
  }
  console.log("[pc-agent]", event, JSON.stringify(detail).slice(0, 300));
}
