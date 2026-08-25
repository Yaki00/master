# Cahier des charges — Orchestration PM (secrétaire → équipe → livraison)

**Date :** 25 août 2026  
**Demandeur :** Yaki (Pixel Brain)  
**Périmètre :** `apps/master-web` (office) + `apps/openclaw-office-bridge` + UI `/agents`  
**Référence produit :** https://master.pixelbrain.fr/agents

---

## 1. Contexte et objectif

### Vision utilisateur

> « Je confie une tâche complexe ou un projet à la secrétaire ou à un manager. L’agent crée une équipe adaptée, distribue les sous-tâches au fur et à mesure, coordonne les échanges entre agents et avec moi, jusqu’à livraison complète. »

### Objectif du CDC

Définir une architecture **exigeante, testable et production-ready** pour cette vision — sans remplacer l’écosystème existant (OpenClaw, bridge Mac, SQLite, UI bureau) par un framework externe complet.

### Décision d’architecture (recommandée)

| Option | Verdict | Justification |
|--------|---------|---------------|
| **Migration totale CrewAI** | ❌ Non retenu | Python, pas de bridge OpenClaw, pas d’UI bureau, pas de persistance SQLite existante → réécriture ~70 % du produit |
| **Migration LangGraph** | ❌ Non retenu (même raison) | Meilleur pour greenfield ; coût d’intégration > bénéfice vs stack TS déjà en prod |
| **CrewAI / LangGraph en sidecar prototype** | ⚠️ Optionnel | Utile pour **prototyper** des prompts de planification sur Mac ; pas le runtime prod |
| **Étendre Master (orchestrateur TS déterministe)** | ✅ Retenu | Réutilise `office_tasks`, `office_commands`, handoffs, réunions, bridge, tests Vitest |

**Conclusion :** CrewAI ne fera **pas** gagner du temps en prod. Il fera gagner du temps si on l’utilise comme **labo de prompts/plans** pendant 1–2 jours, puis on porte le contrat JSON dans Master. Le moteur prod reste **TypeScript + état SQLite + LLM en sous-traitant**.

---

## 2. État des lieux (AS-IS)

### Déjà en place (~40 % de la vision)

| Capacité | Fichiers | Maturité |
|----------|----------|----------|
| Réception / routing intents | `actions.ts`, `fast-chat.ts` | OK |
| Réunion all-hands (4 agents parallèles) | `meeting.ts` | OK |
| Handoff séquentiel worker→mgr→lead→user | `handoff.ts`, `agent-teams.ts` | OK |
| Tâches + phases | `office-tasks.ts` | OK |
| Projets AI (brief, goals, recurring) | `ai-projects.ts` | OK |
| Wizard mail multi-tours HITL | `setup-session.ts` | OK |
| File commandes + bridge OpenClaw | `office.ts`, bridge | OK |

### Manques critiques (~60 %)

| Manque | Impact |
|--------|--------|
| Pas de **PM autonome** (décomposition mission → arbre tâches) | Chef spawn au lieu de piloter |
| `parentTaskId` jamais peuplé | Pas de graphe projet |
| Pas de **parallélisme** sous-tâches (hors réunion) | 1 assignee + chaîne linéaire |
| Pas de **gate humain** plan → exécution | Exécution immédiate ou LLM libre |
| Pas de **critères d’acceptation** machine | `done` = dernier ack, pas validation objectifs |
| Pas de **rollup projet** (% done, blocages) | UI ProjectBoard statique |

---

## 3. Exigences fonctionnelles

### Niveau EX (exigeant) — obligatoire pour « done » du CDC

| ID | Exigence | Critère d’acceptation |
|----|----------|----------------------|
| **PM-01** | Brief projet via langage naturel à la secrétaire | Phrase complexe → `ai_projects` + `office_tasks` racine créés en < 2 s sans LLM pour le routing |
| **PM-02** | Plan structuré obligatoire | Le LLM ne peut pas exécuter sans JSON validé `{ subtasks[], teamProposal[], gates[] }` |
| **PM-03** | Composition d’équipe | À partir du plan : création ou sélection `agent_teams` ; rôles `lead/mgr/worker/specialist` assignés |
| **PM-04** | Arbre de tâches | Chaque sous-tâche = `office_tasks` avec `parentTaskId` ; profondeur max 3 |
| **PM-05** | Distribution ordonnée | Orchestrateur code enqueue commandes ; ordre = DAG (dépendances), pas ordre LLM |
| **PM-06** | Parallélisme | Sous-tâches sans dépendance lancées en parallèle (comme réunion, mais généralisé) |
| **PM-07** | Handoff inter-agents | Worker termine → mgr valide → peut renvoyer en `blocked` avec question à un autre agent |
| **PM-08** | HITL — validation plan | Gate `@human_feedback` équivalent : flow pause jusqu’à `approuvé` / `rejeté` / `révision` |
| **PM-09** | HITL — questions bloquantes | Agent peut `blocked` + question structurée ; secrétaire relaie à l’humain ; reprise sur réponse |
| **PM-10** | Statut factuel multi-tours | Humain : « où en est-on ? » → réponse depuis DB/events, **zéro hallucination** |
| **PM-11** | Livraison finale | Toutes feuilles `done` + gate finale → synthèse secrétaire + event `project.delivered` |
| **PM-12** | Idempotence | Double ack, double message humain, reprise crash → pas de double livraison |
| **PM-13** | Timeout / retry | Sous-tâche bloquée > N min → escalade lead ou question humain |
| **PM-14** | Annulation | « annule le projet X » → cascade `cancelled` sur arbre + abort commandes queued |
| **PM-15** | Observabilité | UI Pipeline : arbre tâches, % done, agent actif, dernière interaction humain↔agent |

### Niveau SHOULD — phase 2

| ID | Exigence |
|----|----------|
| PM-16 | Replan automatique si sous-tâche `failed` (max 2 retries) |
| PM-17 | Mémoire corrections humaines (feedbacks plan) |
| PM-18 | Connecteurs outils (mail, eBay, git) via allowlist par type sous-tâche |
| PM-19 | Rollup métriques projet (durée, tokens, coût estimé) |

---

## 4. Exigences non fonctionnelles

| ID | Exigence | Cible |
|----|----------|-------|
| **NFR-01** | Routing intent sans LLM | 100 % des intents PM-01/08/10/14 via regex/état |
| **NFR-02** | Tests automatisés | ≥ 25 scénarios multi-tours Vitest ; 0 régression sur 205+ tests existants |
| **NFR-03** | Latence ack secrétaire | Interim < 2 s (fast-chat) |
| **NFR-04** | Persistance | Crash bridge → reprise depuis SQLite ; pas de perte d’état wizard/plan |
| **NFR-05** | Secrets | Mots de passe jamais dans `office_events` (cf. wizard mail) |
| **NFR-06** | Déterminisme orchestration | Même brief + même état DB → même séquence commandes (LLM = contenu seulement) |

---

## 5. Architecture cible (TO-BE)

```
Humain (/agents chat)
    │
    ▼
Réception (openclaw:office) ──intent──► ProjectOrchestrator (NOUVEAU, TS pur)
    │                                      │
    │                                      ├─ createProjectRoot()
    │                                      ├─ requestPlan() → LLM → JSON schema
    │                                      ├─ validatePlan() → Zod
    │                                      ├─ awaitHumanGate("plan")  ◄── HITL
    │                                      ├─ materializeTeam()
    │                                      ├─ spawnSubtasks(parentTaskId)
    │                                      └─ tick() → enqueue / handoff / escalate
    │
    ▼
office_commands ──► bridge Mac ──► OpenClaw agents
    │
    ▼ ack
processTaskAfterCommand / processMeetingAfterCommand / processPmAfterCommand (NOUVEAU)
    │
    ▼
office_tasks (arbre) + office_events + ai_projects.meta.orchestration
```

### Contrat JSON plan (obligatoire)

```typescript
interface ProjectPlan {
  version: 1;
  title: string;
  brief: string;
  acceptanceCriteria: string[];
  teamProposal: Array<{
    agentId: string;
    role: "lead" | "mgr" | "worker" | "specialist";
    rationale: string;
  }>;
  subtasks: Array<{
    id: string;           // stable slug
    title: string;
    assigneeAgentId: string;
    dependsOn: string[];  // ids subtasks
    kind: "research" | "code" | "review" | "ops" | "human";
    acceptance: string;
  }>;
  gates: Array<{
    afterSubtaskIds: string[];
    type: "human_approval" | "human_input";
    prompt: string;
  }>;
}
```

### Principe clé

> **Le LLM rédige le plan. Le code exécute le plan. L’humain valide aux gates.**

C’est le pattern LangGraph/CrewAI Flows — **implémenté en TS natif** dans Master, pas importé.

---

## 6. Interactions exigées (humain ↔ agent ↔ agent)

### Scénario type A — Projet complexe eBay (référence)

| Tour | Acteur | Action | État attendu |
|------|--------|--------|--------------|
| 1 | Humain | « Lance un projet surveillance RTX 4090 eBay <400€, alerte quotidienne, équipe adaptée » | Projet racine + tâche plan |
| 2 | Secrétaire | Accuse réception + « je prépare le plan » | interim event |
| 3 | Chef (LLM) | Produit JSON plan | `meta.planDraft` |
| 4 | Orchestrateur | Gate plan → pause | `status=awaiting_human` |
| 5 | Humain | « ok go » ou « ajoute mgr-lab pour veille » | plan validé / révision |
| 6 | Orchestrateur | Crée équipe + 3 sous-tâches | `parentTaskId` peuplé |
| 7 | mgr-lab | Recherche eBay (parallèle) | command queued |
| 8 | mgr-dev | Prépare connecteur alerte (parallèle après 7) | dependsOn |
| 9 | mgr-lab → mgr-dev | Question « API eBay dispo ? » | `blocked` + handoff |
| 10 | Humain | « pas encore, stub d’abord » | reprise + note meta |
| 11 | Chef | Synthèse intermédiaire | event synthèse |
| 12 | Toutes feuilles done | Gate livraison | synthèse secrétaire |
| 13 | Humain | « où en est-on ? » | « 2/3 fait, blocage résolu, livraison demain » factuel |

### Scénario type B — Mail (déjà partiellement implémenté)

| Tour | Acteur | Action |
|------|--------|--------|
| 1 | Humain | « analyse ma boîte mail » |
| 2 | Secrétaire | Wizard IMAP 4 étapes si non connecté |
| 3 | Humain | host / user / pass / port |
| 4 | Secrétaire | verify → délégation mgr-lab |
| 5 | mgr-lab | Analyse inbox réelle |
| 6 | Humain | « annuler » pendant wizard → session effacée |

### Scénario type C — Réunion (déjà implémenté)

| Tour | Acteur | Action |
|------|--------|--------|
| 1 | Humain | « réunion avec tout le monde sur GPU eBay » |
| 2 | Orchestrateur | 4 commandes parallèles |
| 3 | chef, mgr-dev, mgr-lab, main | Répondent |
| 4 | Chef | Synthèse (pas spawn) |
| 5 | Humain | « des nouvelles ? » → statut factuel N/4 |

---

## 7. Stratégie de tests

### Fichiers

| Fichier | Rôle |
|---------|------|
| `lib/office/orchestration-scenarios.test.ts` | **NOUVEAU** — scénarios multi-tours humain↔agent↔agent |
| `lib/office/handoff.test.ts` | Handoff séquentiel (existant) |
| `lib/office/meeting.test.ts` | Réunion parallèle (existant) |
| `lib/office/setup-session.test.ts` | Wizard HITL mail (existant) |
| `lib/office/integration.test.ts` | Intégration dispatch (existant) |
| `docs/OFFICE-ENTERPRISE-TESTS.md` | Playbook manuel T01–T62 |

### Matrice scénarios automatisés (orchestration-scenarios)

| ID | Scénario | Interactions | Statut impl |
|----|----------|--------------|-------------|
| **OS-01** | Réunion → status humain | H→S→4A→H | ✅ Pass |
| **OS-02** | Handoff worker→mgr→lead→user | H→S→A→A→A→H | ✅ Pass |
| **OS-03** | Mail wizard 4 tours + annuler | H↔S×5 | ✅ Pass |
| **OS-04** | Projet sentinelle speech | H→S | ✅ Pass |
| **OS-05** | Question bloquante simulée | A→A→H→A | 🔶 Stub |
| **OS-06** | Plan JSON → gate humain → spawn | H→S→Chef→H→ équipe | ⏳ TODO |
| **OS-07** | Sous-tâches parallèles DAG | A∥A→merge | ⏳ TODO |
| **OS-08** | Rollup % projet | H→ status | ⏳ TODO |
| **OS-09** | Annulation cascade arbre | H→ cancel | ⏳ TODO |
| **OS-10** | Crash reprise orchestrateur | crash→resume | ⏳ TODO |

### Règle CI

- OS-01 à OS-04 : **must pass** à chaque PR
- OS-05 à OS-10 : `it.todo` ou stub jusqu’à implémentation PM-01..15

---

## 8. Plan de livraison par phases

### Phase 0 — Fondations (1 semaine)

- [ ] Module `lib/office/project-orchestrator.ts` (squelette + types Zod)
- [ ] Peupler `parentTaskId` sur sous-tâches
- [ ] OS-06 test rouge → vert (plan + gate sans OpenClaw live)

### Phase 1 — MVP PM (2 semaines)

- [ ] PM-01 à PM-08, PM-10, PM-12
- [ ] UI Pipeline : arbre tâches
- [ ] OS-06, OS-07 verts

### Phase 2 — Robustesse (1 semaine)

- [ ] PM-11, PM-13, PM-14, PM-15
- [ ] OS-08, OS-09, OS-10 verts

### Phase 3 — Outils métier (continu)

- [ ] PM-18 connecteurs eBay/mail/git par contrat
- [ ] Prototype prompts CrewAI sur Mac (optionnel, non bloquant)

---

## 9. Comparaison frameworks (synthèse recherche août 2026)

| Critère | CrewAI | LangGraph | Master étendu |
|---------|--------|-----------|---------------|
| Time-to-first-demo | ⭐⭐⭐ | ⭐⭐ | ⭐ (déjà demo) |
| HITL natif | Flows 1.8+ | interrupt() | À construire (wizard mail = modèle) |
| Persistance prod | Faible | Forte (Postgres) | SQLite existant |
| Intégration OpenClaw | Aucune | Aucune | Native |
| UI bureau /agents | Aucune | Aucune | Native |
| Coût migration | Élevé | Élevé | Faible (incrémental) |
| Token overhead | ~18 % | ~9 % | ~0 % orchestration |

---

## 10. Verdict final

| Question | Réponse |
|----------|---------|
| CrewAI nous ferait gagner du temps ? | **Non en prod.** Oui en **labo prompts** 1–2 jours max. |
| Solution recommandée ? | **Orchestrateur PM TypeScript** dans Master, patterns empruntés à LangGraph/CrewAI |
| Utopie ? | Non — **implémenté** (Phases 0–2) le 25 août 2026 |

---

## 11. Références code

- Orchestrateur : `apps/master-web/lib/office/project-orchestrator.ts`
- Plan / intents : `project-plan.ts`, `pm-intent.ts`
- Dispatch : `apps/master-web/lib/office/actions.ts`
- UI Pipeline : `components/office/PmOrchestrationBoard.tsx`
- Tests : `project-orchestrator.test.ts`, `orchestration-scenarios.test.ts` (OS-01..10)
- Handoff / réunion / wizard : inchangés, cohabitent

---

## 12. Statut d’implémentation (25 août 2026)

| Phase | Contenu | Statut |
|-------|---------|--------|
| **0** | Plan JSON + materializeTeam + spawnSubtasks | **FAIT** |
| **1** | Intents + dispatch + DAG parallèle + HITL + status | **FAIT** |
| **2** | Livraison, cancel, timeout, UI arbre/%, reprise SQLite | **FAIT** |

**Tests :** 235 pass / 0 fail (`apps/master-web`).

**Usage chat :**
```
Lance un projet surveillance eBay GPU avec une équipe adaptée
→ plan → « ok go » → équipe + sous-tâches
→ « où en est-on ? » → rollup factuel
→ « annule le projet … » → cascade
```

**Hors scope (SHOULD) :** PM-16..19 (replan multi-retry, mémoire feedbacks, connecteurs métier, métriques tokens). Plan v1 = déterministe ; `parsePlanFromAgentText` prêt pour un futur LLM Chef.
