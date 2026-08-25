"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { OfficeSnapshot } from "@/hooks/useOffice";

export function OfficeRail() {
  const [data, setData] = useState<OfficeSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/office/agents", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as OfficeSnapshot;
        if (!cancelled) setData(json);
      } catch {
        /* ignore */
      }
    }
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!data) return null;

  const working = data.agents.filter((a) => a.status === "working").length;
  const waiting = data.agents.filter((a) => a.status === "waiting").length + data.sources.waitingJobs.length;
  const online = data.agents.filter((a) => a.status !== "offline").length;
  const mac = data.sources.mac.online;
  const pc = data.sources.pc.online;

  return (
    <Link
      href="/agents"
      className="mt-3 block rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-900/80 hover:text-zinc-100"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-zinc-200">Bureau agents</span>
        <span className={mac ? "text-emerald-400" : "text-amber-400"}>Mac {mac ? "on" : "off"}</span>
        <span className={pc ? "text-emerald-400" : "text-amber-400"}>PC {pc ? "on" : "off"}</span>
        <span className="text-zinc-500">{online} online</span>
        {working > 0 && <span className="text-emerald-300">{working} au travail</span>}
        {waiting > 0 && <span className="text-amber-300">{waiting} en attente</span>}
        <span className="ml-auto text-zinc-500">ouvrir →</span>
      </div>
    </Link>
  );
}
