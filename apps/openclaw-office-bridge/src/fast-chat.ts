/** Chat bureau ultra-court via Ollama local (sans overhead OpenClaw CLI). */

import { DEFAULT_FAST_MODEL } from "./office-run.js";
import {
  formatTurnsForSummary,
  memoryOverQuota,
  splitForCompaction,
  type ChatTurn,
} from "./memory.js";

type OllamaMsg = { role: "system" | "user" | "assistant"; content: string };

function baseSystem(roster: string[]): string {
  const rosterLine =
    roster.length > 0
      ? `Agents présents : ${roster.join(", ")}.`
      : "Agents : Réception, Chef, Mgr Dev, Mgr Lab, Main, Telegram, PC.";
  return `Tu es la RÉCEPTION du bureau Master (Pixel Brain) — secrétaire permanente.
${rosterLine}
Règles dures (non négociables) :
- Français, 1–3 phrases, ton SEC. Interdit : « je serais ravi », « comment puis-je », « quelles options », « n’hésitez pas ».
- Suit le fil : « lesquels ? », « et lui ? », « combien ? » = suite de ta dernière réponse. Réponds avec des FAITS.
- Liste d’agents = noms du roster, jamais une question en retour.
- Tu n’inventes pas. Tu ne codes pas.
Pas de markdown. Pas d’emoji.`;
}

async function ollamaChat(opts: {
  messages: OllamaMsg[];
  baseUrl: string;
  model: string;
  timeoutMs: number;
  numPredict?: number;
  temperature?: number;
}): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`${opts.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        messages: opts.messages,
        options: {
          temperature: opts.temperature ?? 0.25,
          num_predict: opts.numPredict ?? 100,
        },
      }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string }; response?: string };
    const text = (data.message?.content ?? data.response ?? "").trim();
    if (!text) throw new Error("ollama empty");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function summarizeHistory(opts: {
  older: ChatTurn[];
  previousSummary?: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}): Promise<string> {
  const blob = formatTurnsForSummary(opts.older);
  const prev = opts.previousSummary?.trim()
    ? `Résumé déjà connu :\n${opts.previousSummary.trim()}\n\n`
    : "";
  const text = await ollamaChat({
    baseUrl: opts.baseUrl,
    model: opts.model,
    timeoutMs: opts.timeoutMs ?? 25_000,
    numPredict: 180,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "Tu compresses un historique de chat bureau en un résumé factuel français (5–8 phrases max). Garde décisions, noms d’agents, chiffres, missions. Pas de préambule.",
      },
      {
        role: "user",
        content: `${prev}Nouveaux échanges à intégrer :\n${blob}`,
      },
    ],
  });
  return text.slice(0, 1200);
}

export function buildFastChatMessages(opts: {
  message: string;
  history?: ChatTurn[];
  summary?: string;
  roster?: string[];
}): OllamaMsg[] {
  const messages: OllamaMsg[] = [{ role: "system", content: baseSystem(opts.roster ?? []) }];
  if (opts.summary?.trim()) {
    messages.push({
      role: "system",
      content: `Résumé de la conversation antérieure :\n${opts.summary.trim()}`,
    });
  }
  for (const turn of opts.history ?? []) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: "user", content: opts.message });
  return messages;
}

/** Coupe les ouvertures polies / molles (CDC-03). */
export function hardenReply(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^(bonjour|salut|hello|hey|coucou|bonsoir)[!.]?\s*/i, "");
  t = t.replace(/\bje serais ravi[^.!?\n]*[.!?]?\s*/gi, "");
  t = t.replace(/\bje serai[st]? (heureux|enchanté|ravi)[^.!?\n]*[.!?]?\s*/gi, "");
  t = t.replace(/\bavec (grand )?plaisir[^.!?\n]*[.!?]?\s*/gi, "");
  t = t.replace(/\bcomment puis-je (vous |t['’])?aider[^.!?\n]*[.!?]?\s*/gi, "");
  t = t.replace(/\ben quoi puis-je (vous |t['’])?aider[^.!?\n]*[.!?]?\s*/gi, "");
  t = t.replace(/\bquelles options[^.!?\n]*[.!?]?\s*/gi, "");
  t = t.replace(/\bn['’]hésitez pas[^.!?\n]*[.!?]?\s*/gi, "");
  t = t.replace(/\bje suis (là|disponible|à votre disposition) pour[^.!?\n]*[.!?]?\s*/gi, "");
  t = t.replace(/\bbien sûr[!.,]?\s*/gi, "");
  t = t.replace(/\babsolument[!.,]?\s*/gi, "");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return raw.trim().slice(0, 2000);
  return t.slice(0, 2000);
}

export async function ollamaFastChat(opts: {
  message: string;
  history?: ChatTurn[];
  summary?: string;
  roster?: string[];
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{ reply: string; summary?: string }> {
  const base = (opts.baseUrl ?? process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = (opts.model ?? process.env.OFFICE_FAST_MODEL ?? DEFAULT_FAST_MODEL).trim() || DEFAULT_FAST_MODEL;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  let history = [...(opts.history ?? [])].slice(-10);
  if (history.length > 0) {
    const last = history[history.length - 1];
    if (last?.role === "user" && last.content === opts.message.trim()) {
      history = history.slice(0, -1);
    }
  }

  let summary = opts.summary;
  if (memoryOverQuota(history, summary ?? "")) {
    const { older, recent } = splitForCompaction(history);
    if (older.length > 0) {
      try {
        summary = await summarizeHistory({
          older,
          previousSummary: summary,
          baseUrl: base,
          model,
          timeoutMs: Math.min(timeoutMs + 10_000, 35_000),
        });
        history = recent;
        console.log("[office-bridge] memory compact", older.length, "→ summary", summary.length);
      } catch (err) {
        console.warn("[office-bridge] memory compact failed", err);
        history = recent;
      }
    }
  }

  const raw = await ollamaChat({
    baseUrl: base,
    model,
    timeoutMs,
    temperature: 0.2,
    messages: buildFastChatMessages({
      message: opts.message,
      history,
      summary,
      roster: opts.roster,
    }),
  });

  return { reply: hardenReply(raw), summary };
}
