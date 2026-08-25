# Office Enterprise — Playbook de tests

Document reproductible pour valider le runtime HQ (projets, équipes, tâches, handoffs, panneau Réception).

**Date campagne :** 2026-08-25 (màj orchestration PM)  
**Environnement :** Master panel (`/agents`) + SQLite + bridge Mac OpenClaw  
**APIs :** `/api/office/tasks`, `/api/office/teams`, `/api/office/profiles`, `/api/office/projects`, `/api/office/act`  
**CDC orchestration PM :** `docs/CDC-ORCHESTRATION-PM-2026-08-25.md` (**Phases 0–2 livrées** 2026-08-25)  
**Scénarios multi-tours Vitest :** `lib/office/orchestration-scenarios.test.ts` (OS-01..10 verts)  
**Orchestrateur :** `lib/office/project-orchestrator.ts` + `project-plan.ts` + `pm-intent.ts`

---

## Findings (2026-08-24 — intégration QA session)

### Résultats automatisés

| Suite | Fichiers | Tests | Verdict |
|-------|----------|-------|---------|
| `apps/master-web` (`npm test -- --run`) | 27 | **177 pass / 0 fail** | OK |
| `apps/openclaw-office-bridge` (`npm test -- --run`) | 5 | **26 pass / 0 fail** | OK |
| **Total** | **32** | **203 pass / 0 fail** | OK |

Nouveaux tests ajoutés cette session :
- `lib/office/integration.test.ts` — statut réunion factuel, sentinelle via speech, stopRequested + ingest idle
- `lib/office/ingest-merge.test.ts` — branches stop (stopRequested + liveCommand)
- `apps/openclaw-office-bridge/src/office-run.test.ts` — cancelActiveRun / SIGTERM sur run suivi
- `lib/db/sqlite.ts` — getDb() path-aware (fix pollution parallèle Vitest)

### Déploiement & bridge

| Étape | Verdict | Notes |
|-------|---------|-------|
| Deploy VPS `yaki@100.100.148.121` | OK | Conflit Docker résolu (`docker rm -f` + `compose up -d`) ; `master-web` + `master-orchestrator` Up |
| Bridge LaunchAgent | OK | `launchctl kickstart -k com.pixelbrain.openclaw-office-bridge` — state running |
| Spot-check T01 (worker API) | PARTIEL | `GET /api/office/commands` → 200 ; ingest → ok ; `/api/office/act` requiert session navigateur |
| Spot-check T13 (meeting) | OK (Vitest) | `integration.test.ts` + `meeting.test.ts` — réponse factuelle sans hallucination |
| Spot-check T41 (sentinelle) | OK (Vitest) | `integration.test.ts` — projet récurrent « Sentinelle 4090 » + `validateSentinelProject` |

### Pause/stop bridge (amélioration)

- `office-run.ts` : suivi PID (`runOpenclawTracked`) + `cancelActiveRun()` SIGTERM/SIGKILL
- `index.ts` : pause/stop tente d'abord SIGTERM sur run suivi ; ack honnête (« run non abortable si claimed gateway »)
- Limite connue : runs OpenClaw déjà claimed côté gateway ne sont pas garantis abortables — meta `stopRequested`/`pauseRequested` sync via ingest

### État fonctionnel

| Zone | Verdict | Notes |
|------|---------|--------|
| CRUD projets enrichis | OK | brief, goals, teamId, board UI |
| CRUD équipes + chaîne handoff | OK | Vitest `resolveHandoffChain` |
| Profils / persona | OK | injectés dans payload commande |
| Tâches + phases | OK | meeting→plan→decision→execution |
| Handoff auto worker→mgr→lead→user | OK | Vitest idempotent |
| Panneau Réception swimlanes | OK | UI Bureau |
| Onglets Projets / Organisation | OK | |
| Bridge status thinking/working | OK | patch tasks + events |
| Meeting all-hands + synthèse | OK | Vitest + integration status factual |
| Speech projet (create/pause/update) | OK | Vitest + integration sentinelle |
| Projets récurrents + next_run_at | OK (DB) | `listDueRecurringProjects` ; **pas de cron runtime** |
| Veille produit / sentinelle | PARTIEL | helpers parse brief ; pas de trigger auto |
| Mail / inbox | MANUEL | scénarios T47–T52 documentés API/brief |
| Pause/stop abort run claimed | PARTIEL | SIGTERM si PID suivi ; gateway claimed = best-effort |
| Campagne live multi-agent OpenClaw | PARTIEL | dépend Mac online ; rejouer T13–T62 manuellement |

### Correctifs P0 appliqués dans cette livraison

- Bridge : tracking PID + SIGTERM pause/stop + ack honnête
- `mergeIngestStatus` : stopRequested persiste mid-flight
- `getDb()` path-aware pour tests parallèles fiables
- Integration tests meeting/sentinel/stop
- Deploy VPS avec résolution conflit containers

---

## Findings (2026-08-24 — audit session)

### Résultats automatisés

| Suite | Fichiers | Tests | Verdict |
|-------|----------|-------|---------|
| `apps/master-web` (`npm test -- --run`) | 23 | **157 pass / 0 fail** | OK |
| `apps/openclaw-office-bridge` (`npm test -- --run`) | 5 | **24 pass / 0 fail** | OK |
| **Total** | **28** | **181 pass / 0 fail** | OK |

Nouveaux tests ajoutés cette session :
- `lib/office/scenario-helpers.test.ts` — parseMonitorInterval, parseProductWatchBrief, validateSentinelProject
- `lib/db/projects-logs.test.ts` — `listDueRecurringProjects`

### État fonctionnel

| Zone | Verdict | Notes |
|------|---------|--------|
| CRUD projets enrichis | OK | brief, goals, teamId, board UI |
| CRUD équipes + chaîne handoff | OK | Vitest `resolveHandoffChain` |
| Profils / persona | OK | injectés dans payload commande |
| Tâches + phases | OK | meeting→plan→decision→execution |
| Handoff auto worker→mgr→lead→user | OK | Vitest idempotent |
| Panneau Réception swimlanes | OK | UI Bureau |
| Onglets Projets / Organisation | OK | |
| Bridge status thinking/working | OK | patch tasks + events |
| Meeting all-hands + synthèse | OK | Vitest `meeting.test.ts` |
| Speech projet (create/pause/update) | OK | Vitest `project-intent.test.ts` |
| Projets récurrents + next_run_at | OK (DB) | `listDueRecurringProjects` ; **pas de cron runtime** |
| Veille produit / sentinelle | PARTIEL | helpers parse brief ; pas de trigger auto |
| Mail / inbox | MANUEL | scénarios T47–T52 documentés API/brief |
| Pause/stop abort run claimed | KO connu | hors scope v1 — documenté |
| Campagne live multi-agent OpenClaw | PARTIEL | dépend Mac online ; rejouer T13–T62 manuellement |

### Correctifs P0 appliqués dans cette livraison

- Tables `office_tasks`, `agent_teams`, `agent_profiles` + colonnes projet
- `processTaskAfterCommand` + enqueue handoff
- UI HQ 3 onglets + Réception
- Helpers scénarios veille : `lib/office/scenario-helpers.ts`

---

## Prérequis communs

1. Session Master ouverte sur `/agents`
2. Mac bridge online (pastille Mac)
3. Agents `office`, `chef`, `mgr-dev`, `mgr-lab`, `main` visibles
4. Variable `MASTER` = URL panel (ex. `https://master.example.com` ou `http://localhost:3000`)
5. Optionnel : `WORKER_TOKEN` pour curl worker

```bash
# Exemple session cookie / navigateur — préférer UI
# Vitest (automatisé) :
cd apps/master-web && npm test -- --run lib/office/handoff.test.ts
```

---

## A — Smoke / 1 agent (T01–T06)

### T01 — Ping réception
- **Précond :** focus `openclaw:office`
- **Actions :** message `ping`
- **Attendu :** réponse chat, pas de handoff
- **Pass si :** bulle agent + status idle/working→idle
- **Résultat 2026-08-24 :** OK worker API (commands 200, ingest ok) ; live UI _à remplir_

### T02 — Message idle court
- **Actions :** `salut, tu es là ?`
- **Attendu :** fast-chat possible, pas de tâche mission
- **Pass si :** pas de carte Réception créée (message non-mission)
- **Résultat :** _

### T03 — Nouvelle demande
- **Actions :** bouton Nouvelle demande
- **Attendu :** chat vidé, message système keep/drop résumé
- **Pass si :** events reset
- **Résultat :** _

### T04 — Pause UI
- **Actions :** Pause pendant working
- **Attendu :** status waiting / file annulée
- **Pass si :** pending cleared ; **KO connu** si run OpenClaw déjà claimed non aborté
- **Résultat :** _

### T05 — Stop UI
- **Actions :** Stop
- **Attendu :** idle
- **Résultat :** _

### T06 — Résumé keep/drop + log réflexion
- **Actions :** mission longue puis Nouvelle demande ; ouvrir LOGS RÉFLEXION
- **Attendu :** log summary + reflection
- **Résultat :** _

---

## B — Simple mono-agent (T07–T12)

### T07 — Question courte sans handoff
- **Actions :** `@chef quelle heure est-il conceptuellement ?`
- **Pass si :** réponse directe, panneau Réception sans nouvelle tâche (ou tâche execution seule si looksLikeMission false)
- **Résultat :** _

### T08 — Petite tâche tools → working → done
- **Actions :** mission courte avec mot `cherche` / `code`
- **Attendu :** interim thinking, progress working, done
- **Pass si :** TaskStrip ou lane Exécution puis disparition active
- **Résultat :** _

### T09 — Mauvais @mention
- **Actions :** `@inexistant hello`
- **Attendu :** reste sur agent courant ou erreur soft
- **Résultat :** _

### T10 — Agent offline
- **Actions :** message vers agent offline (afficher offline)
- **Attendu :** commande queued ou erreur claire
- **Résultat :** _

### T11 — Projet ponctuel Continuer sans équipe
- **Précond :** onglet Projets → créer projet sans équipe
- **Actions :** Lancer mission
- **Attendu :** tâche + commande lead/chef
- **Résultat :** _

### T12 — Profil persona
- **Précond :** Organisation → persona « Réponds en 1 phrase »
- **Actions :** message à cet agent
- **Attendu :** payload `personaHint` (bridge logs)
- **Résultat :** _

---

## C — Multi-agents organisation (T13–T20) — enrichi

> **Chaîne type veille eBay :** office/chef (réunion) → mgr-dev (plan) → main (scan) → mgr-dev (synthèse) → chef (livraison user).

### T13 — Mission → réunion visible Réception
- **Précond :** équipe lead=chef, mgr=mgr-dev, worker=main ; Mac online
- **Actions :** `@office mission organise une réunion pour scanner eBay GPU RTX 4090 et délègue au mgr-dev`
- **Attendu :** lane **Réunion**, status thinking ; 4 commandes meeting (Vitest meeting.test.ts)
- **Pass si :** carte Réunion + events `meetingRound` ; pas de réponse inventée avant collecte
- **Résultat 2026-08-24 :** OK (Vitest meeting + integration) ; live curl act _session requise_

### T14 — Plan produit après réunion
- **Précond :** T13 lancé ou PATCH manuel
- **Actions :** laisser run ; ou `curl PATCH phase=plan` sur taskId
- **Attendu :** carte passe en **Plan** ; brief contient critères (GPU, prix max, sites)
- **Pass si :** phase=plan visible panneau + DB
- **Résultat :** _

### T15 — Décision puis exécution mgr-dev
- **Actions :** handoff auto ou `@mgr-dev exécute le plan de scan eBay`
- **Attendu :** lane **Exécution**, assignee mgr-dev ; interim « je délègue »
- **Pass si :** commande OpenClaw forceOpenClaw sur mgr-dev
- **Résultat :** _

### T16 — Spawn employé → parent + enfant
- **Actions :** mission `@mgr-dev spawn un worker pour Leboncoin en parallèle d'eBay`
- **Attendu :** event spawn_tree + 2 branches execution
- **Pass si :** 2 taskIds liés, meta parentId
- **Résultat :** _

### T17 — Handoff worker → mgr → user
- **Précond :** équipe sans lead séparé (mgr puis user)
- **Pass si :** Vitest OK + live messages `→ Handoff`
- **Résultat 2026-08-24 :** OK (Vitest)

### T18 — Handoff worker → mgr → chef → user
- **Actions :** worker termine scan → mgr synthèse prix → chef livraison
- **Pass si :** Vitest chaîne complète + chat user reçoit top 3 annonces (simulé OK)
- **Résultat 2026-08-24 :** OK (Vitest)

### T19 — Deux tâches parallèles phases différentes
- **Actions :**
```bash
curl -sS -X POST "$MASTER/api/office/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"Réunion GPU","phase":"meeting","teamId":"TEAM_ID","launch":false}'
curl -sS -X POST "$MASTER/api/office/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"Exec mail","phase":"execution","assigneeAgentId":"openclaw:mgr-lab","launch":true}'
```
- **Attendu :** lanes Réunion + Exécution peuplées simultanément
- **Pass si :** 2 cartes actives, taskIds distincts
- **Résultat :** _

### T20 — Blocked puis reprise
- **Actions :** PATCH `status=blocked` (worker offline simulé) puis `status=working`
- **Attendu :** carte grisée puis reprise sans double handoff
- **Pass si :** Vitest OK + pas de duplicate delivered
- **Résultat 2026-08-24 :** OK (Vitest)

---

## D — Complexes / stress (T21–T32)

### T21 — Équipe complète multi-étapes
- **Précond :** lead + 2 mgr + workers sur un projet
- **Actions :** Lancer mission depuis fiche projet
- **Attendu :** timeline handoffs multiples
- **Résultat :** _

### T22 — Deux projets actifs, agents partagés
- **Actions :** 2 projets, 2 missions
- **Attendu :** taskIds distincts, pas de collision delivered
- **Résultat :** _

### T23 — Mission longue interim sans re-ping
- **Attendu :** progress ticks, livraison auto via handoff
- **Résultat :** _

### T24 — Échec worker → failed
- **Actions :** simuler ack failed
- **Attendu :** phase failed
- **Résultat :** _

### T25 — Récurrence next_run_at
- **Actions :** projet recurring avec nextRunAt passé
- **Attendu :** listDueRecurringProjects non vide (API/script)
- **Résultat :** _

### T26 — Clear chat pendant tâche active
- **Attendu :** tâche reste en DB ; chat reset
- **Résultat :** _

### T27 — Double complete idempotent
- **Pass si :** Vitest `delivered` stable
- **Résultat 2026-08-24 :** OK (Vitest)

### T28 — Changement équipe mid-flight
- **Actions :** PATCH team pendant tâche
- **Attendu :** chaîne suivante inchangée (meta figée) — documenter comportement
- **Résultat :** _

### T29 — Rapport agrégé N sous-tâches
- **Actions :** plusieurs handoffs vers mgr
- **Attendu :** synthèse mgr en chat
- **Résultat :** _

### T30 — Chaos agent offline mid-handoff
- **Attendu :** commande queued chez offline ; pas de crash
- **Résultat :** _

### T31 — Spam claim
- **Actions :** claimOfficeCommands deux fois
- **Attendu :** pas de double claim même id
- **Résultat :** _

### T32 — Panneau Réception timeline
- **Actions :** clic carte → events status/handoff/note
- **Attendu :** timeline ordonnée
- **Résultat :** _

---

## E — Automatisé (Vitest)

```bash
cd apps/master-web
npm test -- --run

# Ciblé :
npm test -- --run \
  lib/office/handoff.test.ts \
  lib/office/meeting.test.ts \
  lib/office/project-intent.test.ts \
  lib/office/scenario-helpers.test.ts \
  lib/db/projects-logs.test.ts \
  lib/office/summary-keep.test.ts
```

```bash
cd apps/openclaw-office-bridge
npm test -- --run
```

Couverture :
- Chaîne handoff + idempotence livraison
- Meeting all-hands + synthèse chef
- Speech projet create/update/delete
- Veille : parseMonitorInterval, parseProductWatchBrief, validateSentinelProject
- Projets récurrents : listDueRecurringProjects
- Phases / blocked / CRUD projets + logs

---

## F — Veille produits / eBay (T33–T40)

> Helpers : `parseProductWatchBrief`, `parseMonitorInterval` (`lib/office/scenario-helpers.ts`).

### T33 — Scan catégorie GPU eBay (mission ponctuelle)
- **Précond :** Mac online, worker=main
- **Actions :** `@main mission cherche RTX 4090 sur eBay catégorie Cartes graphiques, top 5 moins cher`
- **Attendu :** tâche execution, interim working, résultat avec liens/prix (simulé ou réel selon tools)
- **Pass si :** handoff mgr→user avec synthèse ; pas de crash si browser offline (blocked gracieux)
- **Résultat 2026-08-24 :** _

### T34 — Alerte prix sous seuil
- **Précond :** projet « Veille RTX 4090 » actif
- **Actions :** brief `alerte si annonce < 400€` ; lancer mission depuis fiche projet
- **Attendu :** meta/brief contient seuil 400 ; réponse filtre >400€
- **Pass si :** `parseProductWatchBrief(brief).maxPriceEur === 400` (Vitest) ; live liste respecte seuil
- **Résultat 2026-08-24 :** OK (Vitest parse)

### T35 — Agent récurrent toutes les 15 min
- **Précond :** cron/script ou tick manuel (pas de daemon prod)
- **Actions :**
```bash
curl -sS -X POST "$MASTER/api/office/projects" -H 'Content-Type: application/json' \
  -d '{"title":"Veille 4090","kind":"recurring","schedule":"toutes les 15 min","brief":"Surveille RTX 4090 <400€ eBay","nextRunAt":"2020-01-01T00:00:00.000Z","status":"active"}'
# Simuler tick :
# node -e "require('./listDue')" ou appeler listDueRecurringProjects
curl -sS -X POST "$MASTER/api/office/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"Tick veille","brief":"scan ebay RTX 4090","projectId":"PROJECT_ID","launch":true}'
```
- **Attendu :** projet due détecté ; tâche créée ; nextRunAt avancé (+15 min via script)
- **Pass si :** `listDueRecurringProjects` retourne le projet (Vitest OK)
- **Résultat 2026-08-24 :** OK (Vitest DB)

### T36 — Multi-site eBay + Leboncoin
- **Actions :** `@main scan RTX 4090 sur eBay et Leboncoin, compare prix`
- **Attendu :** brief/sites = [ebay, leboncoin] ; 2 passes ou spawn parallèle (T16)
- **Pass si :** synthèse mgr agrège les deux sources
- **Résultat :** _

### T37 — Projet récurrent + handoff mgr→chef
- **Précond :** équipe complète, projet récurrent lié teamId
- **Actions :** Lancer mission depuis projet ; laisser handoff worker→mgr→chef
- **Attendu :** chef livre résumé user ; log réflexion chef
- **Pass si :** delivered idempotent ; message user contient top annonces
- **Résultat :** _

### T38 — Changement seuil via chat sur projet existant
- **Actions :** `Modifie le projet Veille 4090 brief: Surveille RTX 4090 <350€ sur eBay`
- **Attendu :** `parseProjectSpeech` → update patch.brief ; UI projet rafraîchie
- **Pass si :** brief DB mis à jour ; prochain tick utilise 350€
- **Résultat 2026-08-24 :** OK (Vitest project-intent partiel)

### T39 — Veille catégorie sans modèle précis
- **Actions :** `@main surveille catégorie GPU eBay, alerte si RTX 30xx < 250€`
- **Attendu :** brief category + heuristique modèle
- **Pass si :** mission lancée sans erreur validation
- **Résultat :** _

### T40 — Projet récurrent terminé → plus de tick
- **Actions :** `Mets le projet Veille 4090 en pause` puis vérifier listDue
- **Attendu :** status=paused ; absent de listDueRecurringProjects
- **Pass si :** Vitest + PATCH status
- **Résultat :** _

---

## G — Agent sentinelle (T41–T46)

> Sentinelle = projet `kind=recurring` + `meta.watchType=sentinel` + intervalle parseable.

### T41 — Créer sentinelle « RTX 4090 <400€ »
- **Actions (UI) :** Projets → récurrent → brief `Surveille RTX 4090 <400€ eBay toutes les 15 min`
- **Actions (chat) :** `Crée un projet « Sentinelle 4090 » récurrent pour surveiller RTX 4090 <400€ toutes les 15 min`
- **Attendu :** projet recurring ; `validateSentinelProject` ok avec nextRunAt
- **Pass si :** Vitest validateSentinel OK ; fiche projet visible
- **Résultat 2026-08-24 :** OK (Vitest + integration.test.ts speech)

### T42 — Pause / reprise sentinelle
- **Actions :** `Mets le projet Sentinelle 4090 en pause` puis `Reprends le projet Sentinelle 4090`
- **Attendu :** status paused → active ; ticks suspendus puis repris
- **Pass si :** listDue exclut paused
- **Résultat :** _

### T43 — Modification seuil via chat mid-run
- **Précond :** sentinelle active, 1 tick déjà exécuté
- **Actions :** `@office modifie le projet Sentinelle 4090 : seuil 380€`
- **Attendu :** brief patché ; prochain scan utilise 380
- **Pass si :** update DB + pas de double projet
- **Résultat :** _

### T44 — Deux sentinelles parallèles (4090 + 4080)
- **Actions :** créer 2 projets récurrents distincts ; simuler 2 ticks
- **Attendu :** 2 taskIds, pas collision delivered/command claim
- **Pass si :** T22 + listDue retourne 2 si both due
- **Résultat :** _

### T45 — Sentinelle sans nextRunAt → validation KO
- **Actions :** POST projet recurring actif sans nextRunAt ni schedule
- **Attendu :** `validateSentinelProject` → `{ ok: false }` (Vitest)
- **Pass si :** Vitest ; UI devrait avertir (PARTIEL si pas de guard UI)
- **Résultat 2026-08-24 :** OK (Vitest)

### T46 — Tick sentinelle → alerte user seulement si match
- **Actions :** simuler tick avec brief strict ; worker retourne « rien sous seuil »
- **Attendu :** pas de spam user ; log outcome seulement
- **Pass si :** pas de handoff user si brief « aucune annonce »
- **Résultat :** _

---

## H — Mail / inbox (T47–T52)

> **État :** intégration mail non branchée — scénarios manuels / API avec brief simulé.

### T47 — Analyse mail (brief simulé)
- **Précond :** mgr-lab online
- **Actions :** `@mgr-lab mission analyse ce mail : [coller brief] De: vendeur@gpu.fr — RTX 4090 380€ dispo, répondre sous 24h`
- **Attendu :** tâche execution mgr-lab ; synthèse intent + urgence
- **Pass si :** réponse structurée (résumé, action suggérée)
- **Résultat :** _

### T48 — Action proposée → validation user
- **Actions :** suite T47 ; user `@office oui réponds que je suis intéressé si <400€`
- **Attendu :** nouvelle tâche ou continuation ; draft réponse (pas d'envoi réel sans IMAP)
- **Pass si :** pas d'envoi silencieux ; action explicite dans chat
- **Résultat :** _

### T49 — Délégation mgr-lab → main (recherche produit liée au mail)
- **Actions :** `@mgr-lab délègue à main : vérifie si le prix eBay est cohérent avec le mail`
- **Attendu :** handoff mgr-lab→main ; cross-check prix
- **Pass si :** 2 agents dans timeline Réception
- **Résultat :** _

### T50 — Synthèse chef après tri mail
- **Actions :** `@chef synthétise les mails GPU de la journée` (brief liste 3 mails simulés)
- **Attendu :** chef meeting ou execution ; résumé priorisé
- **Pass si :** message user unique avec priorités
- **Résultat :** _

### T51 — Mail + veille : chaîne complète
- **Actions :** (1) sentinelle trouve annonce (2) forward brief mail (3) mgr-lab compare (4) chef décide
- **Attendu :** enchaînement T33→T47→T49→T18 sans crash
- **Pass si :** 4 phases traçables Réception
- **Résultat :** _

### T52 — Inbox overload — tri sans action
- **Actions :** brief 10 mails spam + 1 urgent ; `@mgr-lab trier sans répondre`
- **Attendu :** classement only ; pas de commandes spawn massives
- **Pass si :** ≤1 tâche active mgr-lab ; réponse < 30s interim
- **Résultat :** _

---

## I — Projets via chat (T53–T56)

### T53 — Créer projet nommé via chat
- **Actions :** `Crée un projet « Site vitrine » pour refonte landing`
- **Attendu :** `parseProjectSpeech` kind=create ; carte onglet Projets
- **Pass si :** Vitest + UI liste
- **Résultat 2026-08-24 :** OK (Vitest)

### T54 — Projet récurrent schedule naturel
- **Actions :** `Ajoute un projet veille GPU récurrent chaque lundi 9h`
- **Attendu :** kind=recurring, schedule=`lundi`
- **Pass si :** Vitest project-intent
- **Résultat 2026-08-24 :** OK (Vitest)

### T55 — Renommer + notes via chat
- **Actions :** `Modifie le projet Scan GPU notes: priorité haute brief: eBay 4080`
- **Attendu :** update patch notes/brief
- **Pass si :** DB updated
- **Résultat :** _

### T56 — Supprimer projet via chat
- **Actions :** `Supprime le projet "Site vitrine"`
- **Attendu :** delete intent ; confirmation soft (PARTIEL si pas de confirm UI)
- **Pass si :** projet absent liste
- **Résultat :** _

---

## J — Robustesse avancée (T57–T60)

### T57 — Idempotence complete ×3
- **Actions :** PATCH task `status=done` 3 fois sur même taskId
- **Attendu :** 1 seul handoff user
- **Pass si :** Vitest handoff delivered stable
- **Résultat 2026-08-24 :** OK (Vitest)

### T58 — Clear chat pendant tâche sentinelle
- **Actions :** tick actif + bouton Nouvelle demande
- **Attendu :** chat reset ; tâche DB intacte ; sentinelle continue
- **Pass si :** task status inchangé
- **Résultat :** _

### T59 — Agent offline mid-handoff (chaîne longue)
- **Actions :** worker done → mgr offline → chef online
- **Attendu :** commande queued mgr ; pas de crash ; reprise quand online
- **Pass si :** queue Mac + status blocked/working
- **Résultat :** _

### T60 — Double meeting simultané
- **Actions :** 2× `fait un meeting avec tout le monde` (briefs différents)
- **Attendu :** 2 taskIds meeting ; 8 commandes distinctes ; synthèses séparées
- **Pass si :** Vitest meeting lance N commandes ×2 sans collision
- **Résultat :** _

---

## K — UI Bureau (T61–T62)

> À rejouer après refactor UI si en cours (library modal, reception panel, movement).

### T61 — Library modal projets
- **Actions :** ouvrir modal bibliothèque → filtrer récurrent → éditer brief
- **Attendu :** CRUD sans quitter /agents
- **Pass si :** PATCH projet reflété board
- **Résultat :** _

### T62 — Mouvement agents / placement salle
- **Actions :** mission longue ; observer sprites/map room
- **Attendu :** agent working se déplace vers salle execution (si refactor actif)
- **Pass si :** pas de flicker ; status-truth cohérent (Vitest status-truth)
- **Résultat :** _

---

## L — Parcours E2E composite (T63–T65)

> Scénarios « bien poussés » enchaînant veille → mail → action.

### T63 — Veille → alerte → analyse mail → réponse
1. Sentinelle T41 active, tick trouve 4090 à 390€
2. User forward brief mail vendeur
3. mgr-lab compare, chef propose réponse
- **Pass si :** 3 lanes Réception ou timeline séquentielle sans duplicate delivered
- **Résultat :** _

### T64 — Réunion équipe → projet récurrent → 1er tick
1. Meeting all-hands « stratégie GPU Q4 »
2. Chat crée projet récurrent
3. Simuler listDue + lancer mission
- **Pass si :** meeting.test + project-intent + listDue OK
- **Résultat :** _

### T65 — Chaos : offline + pause + 2 sentinelles + clear chat
1. 2 sentinelles T44
2. Pause une, offline mgr mid-handoff T59
3. Clear chat T58
- **Pass si :** pas de crash panel ; DB cohérente
- **Résultat :** _

---

## Curl utiles (auth session navigateur ou cookie)

Créer équipe :

```bash
curl -sS -X POST "$MASTER/api/office/teams" -H 'Content-Type: application/json' \
  -d '{"name":"Dev Squad","leadAgentId":"openclaw:chef","members":[
    {"agentId":"openclaw:chef","roleInTeam":"lead"},
    {"agentId":"openclaw:mgr-dev","roleInTeam":"mgr"},
    {"agentId":"openclaw:main","roleInTeam":"worker"}
  ]}'
```

Lancer mission :

```bash
curl -sS -X POST "$MASTER/api/office/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"Scan GPU","brief":"mission organise scan ebay","teamId":"TEAM_ID","assigneeAgentId":"openclaw:main","launch":true}'
```

Lister actives :

```bash
curl -sS "$MASTER/api/office/tasks?status=active"
```

---

## Comment rejouer une campagne

1. Lancer Vitest (section E) — **177 + 26 tests doivent être verts**
2. Déployer panel + kickstart bridge
3. Remplir résultats T01–T65 dans ce fichier (OK / PARTIEL / KO + note)
4. Remonter Findings en tête (section audit datée)
5. Fixer uniquement les P0 avant merge suivant

---

## Features à solidifier (roadmap)

| Feature | État aujourd'hui | Manque / risque |
|---------|------------------|-----------------|
| **Cron sentinelle** | DB `next_run_at` + `listDueRecurringProjects` | Pas de daemon qui tick + enqueue mission auto |
| **Veille multi-site browser** | Brief parse OK ; mission via OpenClaw | Tools browser PC/Mac instables ; pas de cache annonces |
| **Intégration mail IMAP** | Scénarios T47–T52 manuels/brief | Pas de fetch inbox, pas d'envoi SMTP réel |
| **Alertes push user** | Livraison chat handoff | Pas de webhook/email/notification mobile |
| **Pause/Stop abort OpenClaw** | SIGTERM si PID bridge suivi | Run claimed gateway non garanti — meta sync ingest |
| **Validation UI sentinelle** | Vitest `validateSentinelProject` | Guard à l'POST `/api/office/projects` |
| **parseProjectSpeech seuil** | Update brief générique | Pas de patch dédié « seuil 380€ » sans brief complet |
| **Movement / map room** | Vitest placement | Refactor UI en cours — rejouer T62 |
| **Library modal** | Composant existe | Tests E2E UI absents |
| **Idempotence claim** | T31 documenté | Test Vitest claim à ajouter côté bridge |
| **Meta watchType=sentinel** | Convention documentée | Pas injecté auto à la création chat |
| **Synthèse cross-projet** | Chef par tâche | Pas de rollup 2 sentinelles → 1 digest |

**Priorités suggérées :** (1) cron tick sentinelle, (2) guard API sentinelle, (3) stub mail brief→structured, (4) abort run pause/stop.
