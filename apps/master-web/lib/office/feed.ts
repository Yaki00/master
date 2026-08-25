import type { OfficeAgent, OfficeEvent } from "./types";
import { eventsToBubbles, type ChatBubble } from "./chat";
import { displayName } from "./labels";
import { agentRole, roleLabel } from "./role";

export type FeedBubble = ChatBubble & {
  agentId: string;
  agentLabel: string;
  roleTag: string;
  spawn?: boolean;
};

/** Bulles globales avec label agent + marqueurs spawn (CDC-02/09). */
export function feedToBubbles(
  events: OfficeEvent[],
  agents: OfficeAgent[],
  limit = 60,
): FeedBubble[] {
  const byAgent = new Map<string, OfficeEvent[]>();
  for (const ev of events) {
    const list = byAgent.get(ev.agentId) ?? [];
    list.push(ev);
    byAgent.set(ev.agentId, list);
  }

  const nameOf = (id: string) => {
    const a = agents.find((x) => x.id === id);
    return a ? displayName(a) : id.replace(/^openclaw:/, "");
  };
  const roleOf = (id: string) => {
    const a = agents.find((x) => x.id === id);
    return a ? roleLabel(agentRole(a)) : "AGT";
  };

  const out: FeedBubble[] = [];

  for (const [agentId, evs] of byAgent) {
    const bubbles = eventsToBubbles(evs, []);
    for (const b of bubbles) {
      out.push({
        ...b,
        id: `${agentId}:${b.id}`,
        agentId,
        agentLabel: nameOf(agentId),
        roleTag: roleOf(agentId),
      });
    }
    for (const ev of evs) {
      if (ev.kind === "spawn_tree" || (ev.payload.spawn === true && ev.kind !== "agent_message")) {
        // déjà rendu via eventsToBubbles si kind spawn_tree
        if (ev.kind === "spawn_tree") continue;
        const child = String(ev.payload.childSessionKey ?? ev.payload.child ?? "");
        const task = String(ev.payload.taskName ?? ev.payload.task ?? "spawn");
        const text = child
          ? `Spawn → ${child.split(":").slice(-1)[0]} · ${task}`
          : `Spawn · ${task}`;
        out.push({
          id: `spawn-${ev.id}`,
          role: "system",
          text,
          at: ev.createdAt,
          agentId,
          agentLabel: nameOf(agentId),
          roleTag: roleOf(agentId),
          spawn: true,
        });
      }
      if (ev.kind === "progress" || ev.payload.progress === true) {
        // progress déjà dans eventsToBubbles comme agent — skip doublon system
        continue;
      }
    }
  }

  return out.sort((a, b) => a.at.localeCompare(b.at)).slice(-limit);
}
