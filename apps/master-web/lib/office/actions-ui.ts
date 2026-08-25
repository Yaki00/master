import type { OfficeAgent, OfficeCommandKind, OfficeSources } from "./types";

export type UiAction = {
  kind: OfficeCommandKind;
  label: string;
  primary?: boolean;
  danger?: boolean;
  needsConfirm?: boolean;
  disabledReason?: string;
};

function isAwaiting(agent: OfficeAgent): boolean {
  return agent.status === "waiting" || agent.status === "error";
}

/**
 * Actions selon kind + statut.
 * Pas de bouton « Reprendre » séparé : le champ message fait office de réponse / reprise.
 */
export function availableActions(
  agent: OfficeAgent | null,
  sources: Pick<OfficeSources, "mac" | "pc">,
): UiAction[] {
  if (!agent) return [];

  if (agent.kind === "openclaw") {
    if (agent.status === "offline") {
      return [
        {
          kind: "message",
          label: "Envoyer",
          primary: true,
          disabledReason: sources.mac.online ? "Agent hors ligne" : "Mac hors ligne",
        },
      ];
    }
    const label = isAwaiting(agent) ? "Répondre" : "Envoyer";
    const actions: UiAction[] = [{ kind: "message", label, primary: true }];
    if (agent.status === "working") {
      actions.push({ kind: "pause", label: "Pause" });
      actions.push({ kind: "stop", label: "Stop", danger: true, needsConfirm: true });
    } else if (isAwaiting(agent)) {
      actions.push({ kind: "stop", label: "Stop", danger: true, needsConfirm: true });
    }
    return actions;
  }

  if (agent.kind === "pc") {
    if (!sources.pc.online || agent.status === "offline") {
      return [
        {
          kind: "message",
          label: "Envoyer",
          primary: true,
          disabledReason: "PC hors ligne",
        },
      ];
    }
    const paused = Number(agent.meta.pausedJobCount ?? 0);
    const awaiting = isAwaiting(agent) || paused > 0;
    const label = awaiting ? "Répondre" : "Envoyer";
    const actions: UiAction[] = [{ kind: "message", label, primary: true }];
    if (agent.status === "working") {
      actions.push({ kind: "pause", label: "Pause" });
      actions.push({ kind: "stop", label: "Stop", danger: true, needsConfirm: true });
    } else if (awaiting) {
      actions.push({ kind: "stop", label: "Stop", danger: true, needsConfirm: true });
    }
    return actions;
  }

  // job
  if (isAwaiting(agent)) {
    return [
      {
        kind: "message",
        label: "Répondre",
        primary: true,
        disabledReason: sources.pc.online ? undefined : "PC hors ligne",
      },
      { kind: "stop", label: "Annuler", danger: true, needsConfirm: true },
    ];
  }
  if (agent.status === "working") {
    return [
      { kind: "message", label: "Envoyer", primary: true },
      { kind: "pause", label: "Pause" },
      { kind: "stop", label: "Stop", danger: true, needsConfirm: true },
    ];
  }
  return [{ kind: "message", label: "Envoyer", primary: true }];
}

export function messagePlaceholder(agent: OfficeAgent | null): string {
  if (!agent) return "Message…";
  if (isAwaiting(agent)) return "Ta réponse…";
  return "Message…";
}

/**
 * Envoi principal : texte → message ; attente sans texte → resume (sauf job).
 */
export function resolvePrimarySend(
  agent: OfficeAgent | null,
  draft: string,
): { kind: OfficeCommandKind; text?: string } | null {
  if (!agent) return null;
  const text = draft.trim();
  if (isAwaiting(agent)) {
    if (text) return { kind: "message", text };
    if (agent.kind === "job") return null;
    return { kind: "resume", text: "reprendre" };
  }
  if (!text) return null;
  return { kind: "message", text };
}

export function primarySendLabel(agent: OfficeAgent | null, draft: string): string {
  if (!agent) return "Envoyer";
  if (isAwaiting(agent) && !draft.trim() && agent.kind !== "job") return "Reprendre";
  if (isAwaiting(agent)) return "Répondre";
  return "Envoyer";
}
