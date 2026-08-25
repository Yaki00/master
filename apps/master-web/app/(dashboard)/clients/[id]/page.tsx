"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { useMetricsContext } from "@/components/MetricsProvider";

export default function ClientDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { data } = useMetricsContext();
  const client = data?.clients.find((c) => c.id === id);

  if (!client) {
    return (
      <>
        <PageHeader title="Client introuvable" />
        <Link href="/clients" className="text-sm text-blue-400 hover:text-blue-300">
          ← Retour aux projets
        </Link>
      </>
    );
  }

  return (
    <>
      <PageHeader title={client.name} description={`ID · ${client.id}`} />

      <Link href="/clients" className="mb-6 inline-block text-sm text-blue-400 hover:text-blue-300">
        ← Retour aux projets
      </Link>

      <div className="space-y-6">
        {client.projects.map((project) => (
          <Card key={project.name}>
            <h3 className="text-lg font-semibold text-white">{project.name}</h3>
            {project.appId && (
              <p className="mt-1 text-xs text-zinc-500">App liée · {project.appId}</p>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {project.urls.prod && (
                <div>
                  <p className="text-xs text-zinc-500">Production</p>
                  <a
                    href={project.urls.prod}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    {project.urls.prod}
                  </a>
                </div>
              )}
              {project.urls.staging && (
                <div>
                  <p className="text-xs text-zinc-500">Staging</p>
                  <a
                    href={project.urls.staging}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    {project.urls.staging}
                  </a>
                </div>
              )}
            </div>

            {project.contacts.length > 0 && (
              <div className="mt-6">
                <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Contacts</h4>
                <ul className="mt-2 space-y-2">
                  {project.contacts.map((c) => (
                    <li key={c.email} className="text-sm text-zinc-300">
                      {c.name} ·{" "}
                      <a href={`mailto:${c.email}`} className="text-blue-400">
                        {c.email}
                      </a>
                      {c.phone && <span className="text-zinc-600"> · {c.phone}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {project.invoices.length > 0 && (
              <div className="mt-6">
                <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Factures</h4>
                <ul className="mt-2 space-y-2">
                  {project.invoices.map((inv) => (
                    <li key={inv.label}>
                      <a
                        href={inv.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:text-blue-300"
                      >
                        {inv.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {project.docs.length > 0 && (
              <div className="mt-6">
                <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Documents</h4>
                <ul className="mt-2 space-y-2">
                  {project.docs.map((doc) => (
                    <li key={doc.label}>
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:text-blue-300"
                      >
                        {doc.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
