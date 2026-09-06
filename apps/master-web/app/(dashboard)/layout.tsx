"use client";

import { usePathname } from "next/navigation";
import { MetricsProvider } from "@/components/MetricsProvider";
import { Sidebar } from "@/components/layout/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wide = pathname.startsWith("/agents") || pathname.startsWith("/projets");

  return (
    <MetricsProvider>
      <div className={wide ? "flex h-screen min-h-0" : "flex min-h-screen"}>
        <Sidebar />
        <main className={`flex-1 ${wide ? "flex min-h-0 flex-col overflow-hidden" : "overflow-y-auto"}`}>
          <div
            className={
              wide
                ? "flex min-h-0 flex-1 flex-col px-1.5 py-1.5"
                : "mx-auto max-w-5xl px-6 py-8"
            }
          >
            {children}
          </div>
        </main>
      </div>
    </MetricsProvider>
  );
}
