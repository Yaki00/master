"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { useMetricsContext } from "@/components/MetricsProvider";

const NAV = [
  { href: "/", label: "Home", icon: "◈" },
  { href: "/agents", label: "Agents", icon: "♟" },
  { href: "/projets", label: "Projets", icon: "▤" },
  { href: "/vps", label: "VPS", icon: "⬡" },
  { href: "/apps", label: "Applications", icon: "◫" },
  { href: "/n8n", label: "n8n", icon: "⚡" },
  { href: "/notifications", label: "Notifications", icon: "🔔", notifBadge: true },
  { href: "/clients", label: "Projets clients", icon: "◇" },
  { href: "/carriere", label: "Carrière", icon: "⌁" },
  { href: "/sav", label: "SAV", icon: "◎" },
  { href: "/securite", label: "Sécurité", icon: "⛨" },
] as const;

const STORAGE_KEY = "master-sidebar-collapsed-v1";

export function Sidebar() {
  const pathname = usePathname();
  const { secondsUntilRefresh, refresh, loading, data } = useMetricsContext();
  const unread = data?.notifications.unreadCount ?? 0;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <aside
      className={`master-sidebar flex h-full shrink-0 flex-col border-r border-surface-border bg-surface-raised/80 backdrop-blur-xl transition-[width] duration-200 ease-out ${
        collapsed ? "master-sidebar-collapsed w-[68px]" : "w-64"
      }`}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div className={`border-b border-surface-border ${collapsed ? "px-2 py-4" : "px-5 py-6"}`}>
        <div className={`flex items-start ${collapsed ? "flex-col items-center gap-2" : "justify-between gap-2"}`}>
          <div className={collapsed ? "sr-only" : ""}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-400/80">
              Pixel Brain
            </p>
            <h1 className="mt-1 text-lg font-semibold text-white">Master Panel</h1>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-surface text-zinc-300 transition hover:border-blue-500/40 hover:bg-blue-600/10 hover:text-white"
            aria-label={collapsed ? "Déplier la navigation" : "Replier la navigation"}
            aria-expanded={!collapsed}
            title={collapsed ? "Déplier" : "Replier"}
          >
            <span aria-hidden className="text-sm font-semibold tracking-tight">
              {collapsed ? "»" : "«"}
            </span>
          </button>
        </div>
        {!collapsed && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs text-zinc-400">Live · {secondsUntilRefresh}s</span>
            <button
              type="button"
              onClick={() => refresh()}
              disabled={loading}
              className="ml-auto text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40"
            >
              ↻
            </button>
          </div>
        )}
        {collapsed && (
          <button
            type="button"
            onClick={() => refresh()}
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center rounded-lg bg-surface py-2 text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
            title={`Live · ${secondsUntilRefresh}s`}
            aria-label="Rafraîchir"
          >
            ●
          </button>
        )}
      </div>

      <nav className={`flex-1 space-y-1 ${collapsed ? "p-2" : "p-3"}`}>
        {NAV.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              title={item.label}
              className={`relative flex items-center rounded-xl text-sm transition-all ${
                collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
              } ${
                active
                  ? "bg-blue-600/15 text-white ring-1 ring-blue-500/30"
                  : "text-zinc-400 hover:bg-surface hover:text-zinc-200"
              }`}
            >
              <span className="text-base opacity-70">{item.icon}</span>
              {!collapsed && <span className="font-medium">{item.label}</span>}
              {!collapsed && "notifBadge" in item && item.notifBadge && unread > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
              {collapsed && "notifBadge" in item && item.notifBadge && unread > 0 && (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" aria-hidden />
              )}
            </Link>
          );
        })}
      </nav>

      <div className={`border-t border-surface-border ${collapsed ? "p-2" : "p-3"}`}>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Déconnexion"
          className={`w-full rounded-xl text-sm text-zinc-500 transition hover:bg-surface hover:text-zinc-300 ${
            collapsed ? "px-2 py-2.5 text-center" : "px-3 py-2.5 text-left"
          }`}
        >
          {collapsed ? "⏻" : "Déconnexion"}
        </button>
      </div>
    </aside>
  );
}
