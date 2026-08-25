import { metricThresholdColor } from "@/lib/types";

export function MetricRing({
  value,
  label,
  sub,
  size = 88,
}: {
  value: number | null;
  label: string;
  sub?: string;
  size?: number;
}) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const display = value != null ? `${value}%` : "—";
  const offset = value != null ? circumference - (value / 100) * circumference : circumference;
  const color = value != null ? metricThresholdColor(value) : "#52525b";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#27272a"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums text-white">{display}</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-medium text-zinc-400">{label}</p>
        {sub && <p className="mt-0.5 text-[10px] text-zinc-600">{sub}</p>}
      </div>
    </div>
  );
}

export function MetricRingRow({
  metrics,
}: {
  metrics: { value: number | null; label: string; sub?: string }[];
}) {
  return (
    <div className="flex flex-wrap items-start justify-around gap-6">
      {metrics.map((m) => (
        <MetricRing key={m.label} value={m.value} label={m.label} sub={m.sub} size={72} />
      ))}
    </div>
  );
}
