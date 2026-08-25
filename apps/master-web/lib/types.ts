export type HealthStatus = "up" | "down" | "degraded" | "snoozed";

export type AppCheck = {
  id: string;
  label: string;
  url: string;
};

export type AppDefinition = {
  id: string;
  name: string;
  checks: AppCheck[];
  /** Si true, l'app est en standby (pas de probes ni d'alertes). */
  snoozed?: boolean;
};

export const APPS: AppDefinition[] = [
  {
    id: "pixelbraincard",
    name: "PixelbrainCard",
    checks: [
      { id: "api", label: "API", url: "https://api.card.pixelbrain.fr/api/health" },
      { id: "web", label: "Site", url: "https://card.pixelbrain.fr" },
      { id: "merchant", label: "Marchand", url: "https://app.card.pixelbrain.fr" },
      { id: "platform", label: "Platform", url: "https://platform.card.pixelbrain.fr" },
    ],
  },
  {
    id: "echowork",
    name: "EchoWork",
    snoozed: true,
    checks: [
      { id: "web", label: "Web", url: "https://echowork.pixelbrain.fr" },
      { id: "api", label: "API", url: "https://api.echowork.pixelbrain.fr" },
    ],
  },
  {
    id: "ratus",
    name: "Ratus",
    checks: [{ id: "web", label: "Web", url: "https://ratus.pixelbrain.fr" }],
  },
  {
    id: "n8n",
    name: "n8n",
    checks: [{ id: "web", label: "Web", url: "https://n8n.pixelbrain.fr" }],
  },
  {
    id: "infisical",
    name: "Infisical",
    checks: [
      { id: "status", label: "API", url: "https://secrets.pixelbrain.fr/api/status" },
    ],
  },
];

export type CheckResult = {
  id: string;
  label: string;
  url: string;
  status: HealthStatus;
  statusCode: number | null;
  responseMs: number | null;
  message?: string;
};

export type AppStats = {
  usersTotal: number | null;
  usersOnline: number | null;
  revenueMrrCents: number | null;
  revenue30dCents: number | null;
  activeSubscriptions: number | null;
  source: "api" | "unavailable";
};

export type AppMetrics = {
  id: string;
  name: string;
  status: HealthStatus;
  checks: CheckResult[];
  uptimeRatio: number;
  stats: AppStats | null;
};

export type ContainerMetrics = {
  name: string;
  state: string;
  status: string;
  health: HealthStatus;
};

export type VpsHostMetrics = {
  id: string;
  name: string;
  ip: string;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  memoryPercent: number | null;
  cpuPercent: number | null;
  diskPercent: number | null;
  diskUsedGb: number | null;
  diskTotalGb: number | null;
  uptimeSeconds: number | null;
  uptimeFormatted: string | null;
  loadAverage: number[] | null;
  containersRunning: number;
  containersUnhealthy: number;
  containers: ContainerMetrics[];
  collectedAt: string;
};

/** @deprecated Use VpsHostMetrics */
export type VpsMetrics = VpsHostMetrics;

export type NotificationSeverity = "info" | "warning" | "critical";

export type NotificationRecord = {
  id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  sentWa: boolean;
  read: boolean;
  createdAt: string;
};

export type N8nSummary = {
  activeWorkflows: number;
  runningExecutions: number;
  failed24h: number;
  workflows: N8nWorkflowSummary[];
};

export type N8nWorkflowSummary = {
  id: string;
  name: string;
  active: boolean;
  aiHost: string | null;
};

export type ClientContact = {
  name: string;
  email: string;
  phone?: string;
};

export type ClientInvoice = {
  label: string;
  url: string;
  stripeInvoiceId?: string;
};

export type ClientDoc = {
  label: string;
  url: string;
};

export type ClientProject = {
  name: string;
  urls: { prod?: string; staging?: string };
  appId?: string;
  contacts: ClientContact[];
  invoices: ClientInvoice[];
  docs: ClientDoc[];
};

export type ClientRecord = {
  id: string;
  name: string;
  projects: ClientProject[];
};

export type DashboardMetrics = {
  vps: VpsHostMetrics;
  apps: AppMetrics[];
  notifications: {
    unreadCount: number;
    recent: NotificationRecord[];
  };
  n8n: N8nSummary | null;
  clients: ClientRecord[];
  collectedAt: string;
};

export type JobTarget = "cloud" | "pc" | "continue" | "screen" | "agent";
export type JobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type PipelineJob = {
  id: string;
  target: JobTarget;
  status: JobStatus;
  prompt: string;
  waChatId: string;
  cursorAgentId: string | null;
  cursorRunId: string | null;
  parentJobId: string | null;
  resultText: string | null;
  error: string | null;
  mediaUrl: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobEvent = {
  id: string;
  jobId: string;
  kind: string;
  payload: string;
  createdAt: string;
};

export type WorkerHeartbeat = {
  workerId: string;
  hostname: string | null;
  lastSeenAt: string;
  meta: string | null;
};

/** Seuils visuels jauges VPS (vert / orange / rouge) */
export function metricThresholdLevel(percent: number): "ok" | "warn" | "critical" {
  if (percent >= 85) return "critical";
  if (percent >= 70) return "warn";
  return "ok";
}

export function metricThresholdColor(percent: number): string {
  const level = metricThresholdLevel(percent);
  if (level === "critical") return "#ef4444";
  if (level === "warn") return "#f59e0b";
  return "#3b82f6";
}
