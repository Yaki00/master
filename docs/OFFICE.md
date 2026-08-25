# Bureau Agents (Master Panel)

Page native `/agents` : salles Dev / Research / Meeting / Lounge + file Waiting.
Pas d’iframe Pixel Office. Contrôle réel (message, pause, reprise, stop).

## Architecture

```
Navigateur  →  GET/POST /api/office/agents/*  (cookie session)
Sidecar Mac →  POST /api/office/ingest + events + GET/POST /api/office/commands  (WORKER_TOKEN)
PC worker   →  heartbeats / jobs existants
```

Le VPS ne lit pas `~/.openclaw`. Le sidecar `apps/openclaw-office-bridge` tourne sur le Mac.

## Salles

| Statut | Salle |
|--------|--------|
| working + browser/search | Research |
| working + exec/write | Dev |
| paused / besoin humain / erreur | Waiting |
| idle / hors ligne | Lounge |
| `meta.meeting === true` | Meeting |

Hors ligne visuel si `lastSeenAt` > 2 min.

## APIs

### Worker (`Authorization: Bearer WORKER_TOKEN`)

| Route | Rôle |
|-------|------|
| `POST /api/office/ingest` | Snapshot agents OpenClaw |
| `POST /api/office/events` | Interim / progress chat (sans attendre l’ack) |
| `GET /api/office/commands` | Claim file `message\|pause\|resume\|stop` |
| `POST /api/office/commands/:id` | Ack `done` / `failed` |

### Session (cookie Master)

| Route | Rôle |
|-------|------|
| `GET /api/office/agents` | Agrégation OpenClaw + PC + jobs |
| `GET /api/office/agents/:id` | Détail + events |
| `POST /api/office/agents/:id/message` | Chat / reprise job pausé / nouveau job PC |
| `POST /api/office/agents/:id/pause\|resume\|stop` | Contrôle |
| `POST /api/office/act` | Même actions, `agentId` dans le body (évite `:` dans l’URL) |

Jobs PC (canal `office`) : `resumePausedJob` / `pauseJob` / `cancelJob` dans `lib/db/jobs.ts`.
Telegram : agent OpenClaw `telegram-pc` (pas la file jobs WA).
OpenClaw : commandes en file, exécutées par le sidecar.

Chat bureau :
- messages courts → Ollama Mac `qwen2.5:7b` direct (~1 s) **avec historique** du fil (payload `history` + `roster`)
- si le fil dépasse le quota (~12 tours / 4k car.) → résumé Ollama compressé, stocké dans `meta.chatSummary`
- missions / code / spawn → agent OpenClaw `office` (profil minimal) qui peut `sessions_spawn` vers `main` (temporaire) ou `visible: true` (durable)
- pendant un run long : `POST /api/office/events` envoie un **interim** immédiat, puis l’ack final ; le chat analyse si la réponse colle à la demande (`assessReplyFit`)

Env sidecar utiles : `OFFICE_AGENT`, `OFFICE_MODEL`, `OFFICE_FAST_CHAT`, `OLLAMA_URL`.

## Orga agents (OpenClaw)

| Agent | Rôle | Permanent |
|-------|------|-----------|
| `office` | Secrétaire / accueil | oui |
| `chef` | Orchestration | oui |
| `mgr-dev` | Manager code | oui |
| `mgr-lab` | Manager research | oui |
| `main` | Employé polyvalent (spawn) | fallback |
| subagents | Employés temporaires | spawn + archive 30 min |

## Sidecar Mac

```bash
cd apps/openclaw-office-bridge
cp .env.example .env   # WORKER_TOKEN + MASTER_PUBLIC_URL
npm install
./deploy/mac/install-office-bridge.sh
```

LaunchAgent : `com.pixelbrain.openclaw-office-bridge`  
Logs : `~/Library/Logs/openclaw-office-bridge.log`

Pause/stop OpenClaw : best-effort immédiat (pas de tour LLM). Ingest et commandes sont **découplés**.

Health LaunchAgent :

```bash
launchctl print "gui/$(id -u)/com.pixelbrain.openclaw-office-bridge" | head
tail -f ~/Library/Logs/openclaw-office-bridge.log
```

## Secrets

Rien de nouveau dans Infisical si `WORKER_TOKEN` et `MASTER_PUBLIC_URL` existent déjà (`docs/PIPELINE-WA.md`).

## Déploiement Master

```bash
VPS=yaki@100.100.148.121 ./deploy/scripts/deploy-master-panel.sh
```

SQLite : tables `office_agents`, `office_events`, `office_commands` créées au boot (`CREATE TABLE IF NOT EXISTS`) sur le volume `master-data`.

Suite (bugs v1 + v2) : [`docs/OFFICE-TODO.md`](./OFFICE-TODO.md).
