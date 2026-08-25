export type OfficeAgentKind = "openclaw" | "pc" | "job";
export type OfficeStatus = "working" | "idle" | "waiting" | "error" | "offline";
export type OfficeRoom = "dev" | "research" | "meeting" | "lounge" | "waiting";
export type OfficeCommandKind = "message" | "pause" | "resume" | "stop";
export type OfficeCommandStatus = "queued" | "claimed" | "done" | "failed";

export type OfficeAgent = {
  id: string;
  kind: OfficeAgentKind;
  name: string;
  room: OfficeRoom;
  status: OfficeStatus;
  task: string | null;
  currentAction: string | null;
  lastSeenAt: string;
  meta: Record<string, unknown>;
};

export type OfficeEvent = {
  id: string;
  agentId: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type OfficeCommand = {
  id: string;
  agentId: string;
  kind: OfficeCommandKind;
  payload: Record<string, unknown>;
  status: OfficeCommandStatus;
  claimedBy: string | null;
  result: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OfficeIngestAgent = {
  id: string;
  kind?: OfficeAgentKind;
  name?: string;
  status?: OfficeStatus | string;
  task?: string | null;
  currentAction?: string | null;
  tools?: string[];
  meeting?: boolean;
  meta?: Record<string, unknown>;
};

export type WaitingJobSummary = {
  id: string;
  prompt: string;
  claimedBy: string | null;
  status: string;
  updatedAt: string;
};

export type OfficeSources = {
  mac: { online: boolean; lastSeenAt: string | null };
  pc: { online: boolean; lastSeenAt: string | null };
  waitingJobs: WaitingJobSummary[];
};

/** Hors ligne visuel si aucun heartbeat depuis 2 min. */
export const OFFICE_OFFLINE_MS = 120_000;

/** Commande `claimed` trop vieille → échec (sidecar hang / announce). CDC-01/05. */
export const OFFICE_CLAIM_STALE_MS = 120_000;
