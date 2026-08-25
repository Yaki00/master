"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { useMetricsContext } from "@/components/MetricsProvider";
import type { NotificationRecord } from "@/lib/types";

const SEVERITY_STYLES = {
  critical: "border-red-500/30 bg-red-500/5",
  warning: "border-amber-500/30 bg-amber-500/5",
  info: "border-surface-border bg-surface-raised/40",
};

export default function NotificationsPage() {
  const { data, loading, refresh } = useMetricsContext();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const loadNotifications = useCallback(async () => {
    const qs = filter === "unread" ? "?unread=1" : "";
    const res = await fetch(`/api/notifications${qs}`, { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { items: NotificationRecord[] };
      setItems(json.items);
    }
  }, [filter]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications, data?.collectedAt]);

  const markRead = useCallback(
    async (id: string) => {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await loadNotifications();
      refresh();
    },
    [loadNotifications, refresh],
  );

  const unreadCount = data?.notifications.unreadCount ?? 0;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Historique des alertes majeures · in-app"
      />

      <Card className="mb-6" padding="sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-400">Canal</p>
            <p className="text-white">Alertes Master Panel (Telegram / bureau séparés)</p>
          </div>
          <p className="text-sm text-zinc-500">
            {unreadCount} non lue{unreadCount > 1 ? "s" : ""}
          </p>
        </div>
      </Card>

      <div className="mb-4 flex gap-2">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              filter === f
                ? "bg-blue-600/20 text-blue-300 ring-1 ring-blue-500/30"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {f === "all" ? "Toutes" : "Non lues"}
          </button>
        ))}
      </div>

      {loading && items.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-raised" />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className="space-y-3">
          {items.map((n) => (
            <article
              key={n.id}
              className={`rounded-xl border px-5 py-4 ${
                SEVERITY_STYLES[n.severity] ?? SEVERITY_STYLES.info
              } ${n.read ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-white">{n.title}</p>
                  <p className="mt-1 text-sm text-zinc-400">{n.body}</p>
                  <p className="mt-2 text-xs text-zinc-600">
                    {new Date(n.createdAt).toLocaleString("fr-FR")}
                  </p>
                </div>
                {!n.read && (
                  <button
                    type="button"
                    onClick={() => markRead(n.id)}
                    className="rounded-lg bg-surface px-3 py-1.5 text-xs text-blue-400 hover:bg-surface-raised"
                  >
                    Marquer lu
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Card>
          <p className="text-center text-sm text-zinc-500">
            Aucune alerte enregistrée. Le moteur évalue les règles à chaque collecte (25 s).
          </p>
        </Card>
      )}
    </>
  );
}
