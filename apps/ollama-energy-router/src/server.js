#!/usr/bin/env node
/**
 * Energy-aware local LLM router (OpenAI + Ollama compatible).
 * Classifies the last user message and forwards to the lightest capable model.
 *
 * Tiers (Mac / Ollama):
 *   fast   → qwen3:8b
 *   agent  → qwen3-coder:30b
 *   heavy  → qwen3.6:27b
 *   auto   → pick tier by heuristics
 */

import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.ROUTER_PORT || 11435);
const OLLAMA = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");

const TIERS = {
  fast: process.env.MODEL_FAST || "qwen2.5-7b-64k:latest",
  agent: process.env.MODEL_AGENT || "qwen3-coder-30b-64k:latest",
  heavy: process.env.MODEL_HEAVY || "qwen2.5-32b-64k:latest",
};

const FALLBACKS = {
  fast: ["qwen2.5-7b-64k:latest", "qwen2.5:7b", "qwen2.5-coder:7b", "qwen2.5-coder-7b-64k:latest"],
  agent: ["qwen3-coder-30b-64k:latest", "qwen3-coder:30b", "qwen2.5-32b-64k:latest", "qwen2.5:32b"],
  heavy: ["qwen2.5-32b-64k:latest", "qwen2.5:32b", "qwen3-coder-30b-64k:latest", "qwen3-coder:30b"],
};

const ALIAS = {
  auto: "auto",
  router: "auto",
  fast: "fast",
  light: "fast",
  simple: "fast",
  agent: "agent",
  code: "agent",
  coder: "agent",
  balanced: "agent",
  medium: "agent",
  heavy: "heavy",
  quality: "heavy",
  complex: "heavy",
  smart: "heavy",
};

const SIMPLE_RE =
  /\b(salut|hello|hi|bonjour|merci|thanks|ok|quoi|c'?est quoi|what is|who is|define|traduis|translate|résume brièvement|tl;dr|yes|no|oui|non)\b/i;
const HEAVY_RE =
  /\b(architecture|refactor|multi[- ]?file|conception|design system|preuve|proof|optimis|benchmark|sécurité|security audit|deep analysis|analyse approfondie|plan détaillé|migration)\b/i;
const AGENT_RE =
  /\b(code|debug|fix|implement|script|shell|terminal|calendrier|calendar|osascript|apple|fichier|file|git|pr |pull request|bug|erreur|error|outil|tool|agent|commande|command)\b/i;

let availableCache = { at: 0, names: new Set() };

async function listAvailable() {
  const now = Date.now();
  if (now - availableCache.at < 30_000 && availableCache.names.size) {
    return availableCache.names;
  }
  try {
    const res = await fetch(`${OLLAMA}/api/tags`);
    if (!res.ok) throw new Error(`tags ${res.status}`);
    const data = await res.json();
    const names = new Set((data.models || []).map((m) => m.name));
    availableCache = { at: now, names };
    return names;
  } catch {
    return availableCache.names;
  }
}

function lastUserText(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages)) {
    if (typeof body?.prompt === "string") return body.prompt;
    if (typeof body?.input === "string") return body.input;
    return "";
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user") {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .map((p) => (typeof p === "string" ? p : p?.text || ""))
          .join(" ");
      }
    }
  }
  return "";
}

function classify(text, tools) {
  const t = (text || "").trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  const hasTools = Array.isArray(tools) && tools.length > 0;

  if (HEAVY_RE.test(t) || words > 220) return "heavy";
  if (hasTools || AGENT_RE.test(t) || /```/.test(t) || words > 40) return "agent";
  if (words <= 25 && (SIMPLE_RE.test(t) || words <= 8)) return "fast";
  if (SIMPLE_RE.test(t) && words <= 40) return "fast";
  return "agent";
}

async function resolveModel(requested, body) {
  const raw = String(requested || "auto").trim();
  const base = raw.includes("/") ? raw.split("/").pop() : raw;
  const lower = base.toLowerCase();

  const available = await listAvailable();
  const pickFirst = (candidates) => {
    for (const c of candidates) {
      if (available.has(c)) return c;
      const prefix = c.split(":")[0];
      const hit = [...available].find(
        (n) => n === c || n === `${c}:latest` || n.startsWith(`${prefix}:`),
      );
      if (hit) return hit;
    }
    return candidates[0];
  };

  if (ALIAS[lower] && ALIAS[lower] !== "auto") {
    const tier = ALIAS[lower];
    return { tier, model: pickFirst([TIERS[tier], ...FALLBACKS[tier]]), reason: `alias:${lower}` };
  }

  if (lower === "auto" || lower === "router" || !raw) {
    const tier = classify(lastUserText(body), body?.tools);
    return { tier, model: pickFirst([TIERS[tier], ...FALLBACKS[tier]]), reason: `auto:${tier}` };
  }

  // Explicit model id — pass through (still prefer available match)
  if (available.has(base) || available.has(raw)) {
    return { tier: "explicit", model: available.has(base) ? base : raw, reason: "explicit" };
  }
  const prefix = base.split(":")[0];
  const hit = [...available].find((n) => n === base || n.startsWith(`${prefix}:`));
  if (hit) return { tier: "explicit", model: hit, reason: "explicit-fuzzy" };

  // Unknown explicit → agent fallback
  return { tier: "agent", model: pickFirst(FALLBACKS.agent), reason: `fallback-from:${base}` };
}

async function proxy(req, res, targetPath, bodyBuf) {
  const target = new URL(targetPath, OLLAMA);
  const headers = { ...req.headers, host: target.host };
  delete headers["content-length"];

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : bodyBuf,
  });

  res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

    if (url.pathname === "/health" || url.pathname === "/router/health") {
      const available = [...(await listAvailable())];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ollama: OLLAMA, tiers: TIERS, available }));
      return;
    }

    if (url.pathname === "/api/tags" || url.pathname === "/v1/models") {
      const available = await listAvailable();
      const synthetic = [
        { name: "auto", model: "auto" },
        { name: "fast", model: "fast" },
        { name: "agent", model: "agent" },
        { name: "heavy", model: "heavy" },
        ...[...available].map((name) => ({ name, model: name })),
      ];
      if (url.pathname === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: synthetic.map((m) => ({ id: m.name, object: "model", owned_by: "ollama-energy-router" })),
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: synthetic.map((m) => ({ name: m.name, model: m.model })) }));
      return;
    }

    const routePaths = ["/api/chat", "/api/generate", "/v1/chat/completions", "/v1/completions"];
    if (routePaths.includes(url.pathname) && req.method === "POST") {
      const buf = await readBody(req);
      let body = {};
      try {
        body = JSON.parse(buf.toString("utf8") || "{}");
      } catch {
        body = {};
      }
      const resolved = await resolveModel(body.model, body);
      const next = { ...body, model: resolved.model };
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          path: url.pathname,
          requested: body.model || null,
          tier: resolved.tier,
          model: resolved.model,
          reason: resolved.reason,
        }),
      );
      await proxy(req, res, url.pathname + url.search, Buffer.from(JSON.stringify(next)));
      return;
    }

    // Pass-through everything else to Ollama
    const buf = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
    await proxy(req, res, url.pathname + url.search, buf);
  } catch (err) {
    console.error(err);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`ollama-energy-router on http://127.0.0.1:${PORT} → ${OLLAMA}`);
  console.log(`tiers: fast=${TIERS.fast} agent=${TIERS.agent} heavy=${TIERS.heavy}`);
});
