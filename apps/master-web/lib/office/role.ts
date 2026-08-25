import type { OfficeAgent } from "./types";

export type OfficeRole = "reception" | "chef" | "mgr" | "coder" | "telegram" | "pc" | "job" | "worker";

export function agentRole(agent: Pick<OfficeAgent, "id" | "kind" | "name">): OfficeRole {
  const raw = (agent.id || agent.name || "").toLowerCase();
  const id = raw.replace(/^openclaw:/, "");
  if (id === "office" || id.includes("reception") || id.includes("réception")) return "reception";
  if (id === "chef") return "chef";
  if (id.startsWith("mgr-") || id.includes("manager")) return "mgr";
  if (id === "telegram-pc" || id.includes("telegram")) return "telegram";
  if (agent.kind === "pc" || id.includes("pc-")) return "pc";
  if (agent.kind === "job") return "job";
  if (id === "main") return "coder";
  return agent.kind === "openclaw" ? "worker" : "worker";
}

export function roleLabel(role: OfficeRole): string {
  switch (role) {
    case "reception":
      return "SEC";
    case "chef":
      return "CHEF";
    case "mgr":
      return "MGR";
    case "coder":
      return "DEV";
    case "telegram":
      return "TG";
    case "pc":
      return "PC";
    case "job":
      return "JOB";
    default:
      return "OPS";
  }
}
