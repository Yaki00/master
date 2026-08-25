"use client";

import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { useMetricsContext } from "@/components/MetricsProvider";

export default function ClientsPage() {
  const { data, loading } = useMetricsContext();
  const clients = data?.clients ?? [];

  return (
    <>
      <PageHeader
        title="Projets clients"
        description="URL, contacts, factures et documents · data/clients.json"
      />

      {clients.length === 0 && !loading && (
        <Card className="mb-6 border-dashed border-surface-border" padding="sm">
          <p className="text-sm text-zinc-400">
            Aucun projet client — crée <code className="text-zinc-300">data/clients.json</code> sur le VPS
            (voir clients.json.example).
          </p>
        </Card>
      )}

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-surface-raised" />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {clients.map((client) => (
            <Link key={client.id} href={`/clients/${client.id}`}>
              <Card className="transition hover:ring-1 hover:ring-blue-500/30">
                <h3 className="font-semibold text-white">{client.name}</h3>
                <p className="mt-1 text-sm text-zinc-500">{client.projects.length} projet(s)</p>
                {client.projects[0]?.urls.prod && (
                  <p className="mt-3 truncate text-xs text-blue-400">{client.projects[0].urls.prod}</p>
                )}
                {client.projects[0]?.contacts[0] && (
                  <p className="mt-1 text-xs text-zinc-600">
                    {client.projects[0].contacts[0].name} · {client.projects[0].contacts[0].email}
                  </p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
