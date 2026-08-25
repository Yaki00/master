/** Placeholder sparkline — historique Phase 9 */
export function SparklinePlaceholder({ label }: { label?: string }) {
  const bars = [40, 55, 35, 60, 45, 70, 50, 65, 42, 58];

  return (
    <div>
      {label && (
        <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-600">{label}</p>
      )}
      <div className="flex h-8 items-end gap-0.5">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm bg-zinc-800"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <p className="mt-1 text-[10px] text-zinc-600">Historique — bientôt</p>
    </div>
  );
}
