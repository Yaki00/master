# Bureau Agents — TODO réelle (v2)

État v1 livrée : page `/agents`, ingest Mac, file de commandes, drawer chat/pause/stop.  
Ce fichier liste **ce qui casse ou trompe encore**, dans l’ordre où ça vaut le coup de le faire.

Légende : `P0` = trompeur aujourd’hui · `P1` = contrôle réel · `P2` = confort.

---

## Constat prod (24 août 2026)

Vu après deploy + sidecar LaunchAgent :

- Mac **online**, 2 agents OpenClaw ingestés (`main`, `telegram-pc`)
- Les deux étaient en **Waiting / error** alors qu’ils n’étaient pas en train de planter : dernière session `status: killed` / `abortedLastRun`
- File Waiting : jobs hors canal `office` exclus du hall
- Pause/stop OpenClaw = signal best-effort (pas abort gateway)
- WhatsApp retiré (24 août 2026) — canal = Telegram OpenClaw + `/agents`

---

## P0 — Le bureau ment

### 1. Statut OpenClaw : ignorer les sessions mortes

**Fichier :** `apps/openclaw-office-bridge/src/index.ts` → `statusFromSession` / `latestSessionForAgent`

Aujourd’hui : dernière session `killed` → agent `error` → salle Waiting.

À faire :

- `killed` / `done` / `abortedLastRun` **et** `updatedAt` > 3 min → `idle` (Lounge), pas error
- `error` seulement si la session **récente** (< 3 min) a échoué
- `working` seulement si `status` running/thinking **ou** `updatedAt` < 2 min et pas `done`
- Tests sidecar (ou fonction extraite) avec un fixture `sessions.json`

### 2. Tâche lisible, pas une clé interne

Aujourd’hui `task` = `agent:main:main` / clé de session.

À faire : dernier user message / titre mission / modèle, tronqué. Fallback : nom de l’agent.

### 3. Ne plus dupliquer PC + jobs sur le plancher

**Fichier :** `apps/master-web/lib/db/office.ts` → `listAggregatedOfficeAgents`

Aujourd’hui : carte `pc:pc-main` **et** une carte `job:<uuid>` par job queued/paused.

À faire :

- Plancher : **1 carte par worker vivant** (OpenClaw, PC)
- Jobs pausés : file Waiting **compacte** (badge « 3 jobs en attente ») ou drawer du PC, pas 5 cartes UUID
- Job orphelin (pas de worker) : une carte max, pas la queue entière

### 4. Salles = activité réelle, pas le profil d’outils

**Fichiers :** sidecar ingest `tools` + `lib/office/mapRoom.ts`

Aujourd’hui `main` a toujours `tools: ['coding','browser']` → dès qu’il est `working` il part en Research même s’il code.

À faire : tools **de la session en cours** (dernier tool name dans le jsonl / `currentAction`), pas le profil OpenClaw. Config = fallback.

---

## P1 — Contrôle réel

### 5. Découpler ingest et exécution dans le sidecar

**Fichier :** `apps/openclaw-office-bridge/src/index.ts` → `tick()`

Aujourd’hui un seul `setInterval` : ingest puis `executeCommand` séquentiel. Un message CLI de 90 s **gèle** les heartbeats → Mac « hors ligne » + 502 si le VPS timeout.

À faire :

- Boucle ingest **toutes les 4 s**, jamais bloquée
- Worker commandes **à part** (queue locale, 1 à la fois)
- Timeout / retry ingest (backoff si 502)
- Logs : ack `done`/`failed` + durée, pas seulement `exec message main`

### 6. Pause / stop OpenClaw qui font quelque chose

Aujourd’hui : prompt « arrête-toi » via `openclaw agent -m`.

À faire, dans l’ordre :

1. Chercher CLI/gateway (`sessions`, abort run, interrupt)
2. Si rien : marquer `waiting` **sans** lancer un tour LLM de 90 s
3. Stop = ack immédiat + event `best-effort`, pas un nouveau run
4. UI : désactiver Pause si déjà waiting ; confirmer Stop

### 7. Chat drawer = vrai fil, pas un dump d’events

**Fichiers :** `AgentDrawer.tsx`, `GET /api/office/agents/:id`

Aujourd’hui : `command_message — ping…`, `optimistic`, `command_done` mélangés.

À faire :

- Bulles user / agent / système
- Afficher la **réponse** OpenClaw (stdout JSON du sidecar dans `result`)
- Pending tant que commande `claimed`
- Erreur visible si ack `failed`

### 8. Message PC depuis le bureau sans spammer WhatsApp

**Fichier :** `lib/office/actions.ts` (`waChatId: "office"` déjà filtré au complete)

Vérifier bout en bout : message depuis `/agents` sur `pc:pc-main` → job claimed par `pc-worker` → pas de notif WA.  
Si le PC est offline : message d’erreur clair dans le drawer, pas un job fantôme.

---

## P2 — Produit bureau

### 9. Meeting sans flag magique

Règle du plan : plusieurs agents **actifs** sur le même sujet → Meeting.

À faire : heuristique (même `task` normalisée / même `parentJobId` / tag mission) **uniquement si ≥ 2 working**. Sinon Lounge. Tests `mapRoom`.

### 10. UI plancher

- Mobile : 1 colonne, drawer full-screen, titres `truncate`
- Contraste badges Waiting vs Lounge
- Ping `working` seulement si vraiment working (lié au P0.1)
- Filtre : masquer jobs / hors ligne
- Compteur par salle déjà là — garder après dédoublonnage

### 11. Observabilité sidecar

- Ligne dans `/securite` ou badge Home « Mac office / PC worker »
- Ne plus spammer `ingest 2 agents` toutes les 4 s : log sur **changement** d’état
- Health LaunchAgent dans `docs/OFFICE.md` (`launchctl print`, logs)

### 12. Tests manquants

Déjà là : `mapRoom`, ingest/commandes SQLite, 401 API.

À ajouter :

- Agrégation : PC + jobs → **une** carte PC + waiting compact
- `applyFreshness` : waiting récent reste waiting ; working périmé → offline
- Sidecar `statusFromSession` (sessions killed anciennes)
- Route message OpenClaw → commande `queued` (session mockée)

---

## Hors scope volontaire (ne pas faire maintenant)

- Iframe Pixel Office / canvas pixel
- SSE (polling 2,5 s suffit si ingest n’est plus bloqué)
- Secrets navigateur
- Lire `~/.openclaw` depuis le VPS
- Redémarrer OpenClaw gateway depuis Master

---

## Ordre recommandé

1. P0.1 statut sessions mortes  
2. P0.3 dédoublonner jobs  
3. P1.5 ingest non bloquant  
4. P0.2 + P0.4 texte / salles  
5. P1.6 pause/stop  
6. P1.7 fil de chat  
7. Le reste P2
