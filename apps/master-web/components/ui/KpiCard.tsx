export function KpiCard({
  label,
  value,
  sub,
  alert,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  alert?: boolean;
  accent?: "blue" | "emerald" | "amber" | "red";
}) {
  const accentRing =
    accent === "blue"
      ? "ring-blue-500/20"
      : accent === "emerald"
        ? "ring-emerald-500/20"
        : accent === "amber"
          ? "ring-amber-500/20"
          : "ring-surface-border";

  return (
    <div
      className={`rounded-2xl border bg-gradient-to-br from-surface-raised to-surface p-5 ring-1 ring-inset ${
        alert ? "border-red-500/30 ring-red-500/20" : `border-surface-border ${accentRing}`
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p
        className={`mt-2 text-3xl font-semibold tabular-nums tracking-tight ${
          alert ? "text-red-400" : "text-white"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-2 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

export function ProgressBar({
  value,
  label,
  alert,
}: {
  value: number;
  label?: string;
  alert?: boolean;
}) {
  const color = alert || value >= 85 ? "bg-red-500" : value >= 70 ? "bg-amber-500" : "bg-blue-500";
  return (
    <div>
      {label && (
        <div className="mb-2 flex justify-between text-xs text-zinc-500">
          <span>{label}</span>
          <span className="tabular-nums text-zinc-400">{value}%</span>
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}
