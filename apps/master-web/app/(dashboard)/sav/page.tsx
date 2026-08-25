"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";

const POLL_MS = 20_000;

type SupportStatus = "OPEN" | "IN_PROGRESS" | "WAITING_ON_MERCHANT" | "RESOLVED";

type SupportMessage = {
  id: string;
  body: string;
  authorType: "MERCHANT" | "AGENT" | "SYSTEM";
  authorName: string;
  createdAt: string;
};

type SupportConversation = {
  id: string;
  subject: string;
  category: string;
  status: SupportStatus;
  lastMessageAt: string;
  unreadByMerchant: number;
  merchant?: {
    businessName: string;
    email: string;
    name: string;
  };
  messages?: SupportMessage[];
};

const STATUS_LABEL: Record<SupportStatus, string> = {
  OPEN: "Ouvert",
  IN_PROGRESS: "En cours",
  WAITING_ON_MERCHANT: "Attente commerçant",
  RESOLVED: "Résolu",
};

const STATUS_OPTIONS: SupportStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_ON_MERCHANT",
  "RESOLVED",
];

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SavPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<SupportStatus | "">("");
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<SupportConversation | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const openCount = useMemo(
    () =>
      conversations.filter((c) => c.status === "OPEN" || c.status === "IN_PROGRESS")
        .length,
    [conversations],
  );

  const loadList = useCallback(async () => {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    const res = await fetch(`/api/support/conversations${qs}`, { cache: "no-store" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `Erreur ${res.status}`);
    }
    const list = (await res.json()) as SupportConversation[];
    setConversations(list);
    return list;
  }, [statusFilter]);

  const loadThread = useCallback(async (id: string) => {
    const res = await fetch(`/api/support/conversations/${id}`, { cache: "no-store" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `Erreur ${res.status}`);
    }
    const data = (await res.json()) as SupportConversation;
    setThread(data);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        await loadList();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Chargement impossible");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    void loadThread(selectedId).catch((e) =>
      setError(e instanceof Error ? e.message : "Conversation introuvable"),
    );
  }, [selectedId, loadThread]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadList();
      if (selectedId) void loadThread(selectedId);
    }, POLL_MS);
    return () => window.clearInterval(interval);
  }, [loadList, loadThread, selectedId]);

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Envoi impossible");
      }
      const msg = (await res.json()) as SupportMessage;
      setReply("");
      setThread((prev) =>
        prev ? { ...prev, messages: [...(prev.messages ?? []), msg] } : prev,
      );
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible");
    } finally {
      setSending(false);
    }
  }

  async function handleStatusChange(status: SupportStatus) {
    if (!selectedId) return;
    setUpdatingStatus(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/conversations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Mise à jour impossible");
      }
      const updated = (await res.json()) as SupportConversation;
      setThread((prev) => (prev ? { ...prev, status: updated.status } : prev));
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mise à jour impossible");
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <>
      <PageHeader
        title="SAV PixelbrainCard"
        description={`Support commerçants · ${openCount} conversation(s) active(s)`}
      />

      {error && (
        <Card className="mb-4 border-red-500/30 bg-red-500/5" padding="sm">
          <p className="text-sm text-red-300">{error}</p>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-xs text-zinc-500">Filtrer :</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as SupportStatus | "")}
          className="rounded-lg border border-surface-border bg-surface px-3 py-1.5 text-sm text-zinc-200"
        >
          <option value="">Tous les statuts</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="h-96 animate-pulse rounded-2xl bg-surface-raised" />
          <div className="h-96 animate-pulse rounded-2xl bg-surface-raised" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
          <Card className="flex max-h-[75vh] flex-col overflow-hidden p-0">
            <div className="border-b border-surface-border px-4 py-3">
              <h2 className="text-sm font-semibold text-white">File d&apos;attente</h2>
            </div>
            <div className="flex-1 divide-y divide-surface-border overflow-y-auto">
              {conversations.length === 0 ? (
                <p className="p-4 text-center text-sm text-zinc-500">
                  Aucune conversation.
                </p>
              ) : (
                conversations.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full px-4 py-3 text-left transition hover:bg-surface ${
                      selectedId === c.id ? "bg-blue-600/10" : ""
                    }`}
                  >
                    <p className="text-sm font-medium text-white line-clamp-1">
                      {c.subject}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 line-clamp-1">
                      {c.merchant?.businessName ?? "—"} · {c.merchant?.email}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        {STATUS_LABEL[c.status]}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        {formatTime(c.lastMessageAt)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>

          <Card className="flex min-h-[480px] max-h-[75vh] flex-col p-0">
            {!selectedId || !thread ? (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-zinc-500">
                <p className="text-sm">Sélectionnez une conversation pour répondre.</p>
              </div>
            ) : (
              <>
                <div className="border-b border-surface-border px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-white">{thread.subject}</h2>
                      <p className="mt-1 text-xs text-zinc-500">
                        {thread.merchant?.businessName} · {thread.merchant?.email} ·{" "}
                        {thread.category}
                      </p>
                    </div>
                    <select
                      value={thread.status}
                      disabled={updatingStatus}
                      onChange={(e) =>
                        void handleStatusChange(e.target.value as SupportStatus)
                      }
                      className="rounded-lg border border-surface-border bg-surface px-2 py-1 text-xs text-zinc-200"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                  {(thread.messages ?? []).map((msg) => {
                    const agent = msg.authorType === "AGENT";
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${agent ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                            agent
                              ? "bg-blue-600/20 text-blue-100 ring-1 ring-blue-500/20"
                              : "bg-surface text-zinc-300"
                          }`}
                        >
                          <p className="text-[10px] font-medium opacity-70 mb-0.5">
                            {msg.authorName}
                          </p>
                          <p className="whitespace-pre-wrap">{msg.body}</p>
                          <p className="mt-1 text-[10px] opacity-50">
                            {formatTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {thread.status !== "RESOLVED" ? (
                  <form
                    onSubmit={handleReply}
                    className="flex gap-2 border-t border-surface-border p-4"
                  >
                    <textarea
                      className="min-h-[44px] flex-1 resize-y rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
                      placeholder="Réponse à envoyer au commerçant…"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      rows={2}
                    />
                    <button
                      type="submit"
                      disabled={sending || !reply.trim()}
                      className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                    >
                      {sending ? "…" : "Envoyer"}
                    </button>
                  </form>
                ) : (
                  <p className="border-t border-surface-border p-4 text-center text-sm text-zinc-500">
                    Conversation résolue — changez le statut pour rouvrir si besoin.
                  </p>
                )}
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
