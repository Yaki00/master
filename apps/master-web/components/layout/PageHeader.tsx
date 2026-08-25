"use client";

import { useMetricsContext } from "@/components/MetricsProvider";

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const { data: metrics, error, loading } = useMetricsContext();

  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-white">{title}</h2>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      <div className="text-right text-xs text-zinc-600">
        {loading && !metrics ? (
          <span className="text-zinc-500">Collecte en cours…</span>
        ) : metrics ? (
          <span>
            Dernière mise à jour ·{" "}
            {new Date(metrics.collectedAt).toLocaleTimeString("fr-FR")}
          </span>
        ) : null}
        {error && <p className="mt-1 text-red-400">{error}</p>}
      </div>
    </header>
  );
}
