import type { HealthStatus } from "@/lib/types";

const styles: Record<HealthStatus, string> = {
  up: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/25",
  degraded: "bg-amber-500/15 text-amber-400 ring-amber-500/25",
  down: "bg-red-500/15 text-red-400 ring-red-500/25",
  snoozed: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/25",
};

const labels: Record<HealthStatus, string> = {
  up: "OK",
  degraded: "Dégradé",
  down: "Down",
  snoozed: "Snooze",
};

const dots: Record<HealthStatus, string> = {
  up: "bg-emerald-400",
  degraded: "bg-amber-400",
  down: "bg-red-400",
  snoozed: "bg-zinc-400",
};

export function StatusBadge({ status }: { status: HealthStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dots[status]}`} />
      {labels[status]}
    </span>
  );
}
