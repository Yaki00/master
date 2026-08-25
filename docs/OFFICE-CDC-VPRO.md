# Cahier des charges — Bureau Agents (V-pro)

**Date d’audit :** 24 août 2026  
**Dernière exécution CDC :** 24 août 2026  
**Périmètre :** `apps/master-web` (office) + `apps/openclaw-office-bridge` + agents OpenClaw (`~/.openclaw`)

---

## Statut d’accomplissement

| ID | Exigence | Statut | Preuve |
|----|----------|--------|--------|
| CDC-01 | Statuts honnêtes | **FAIT** | `status-truth.ts`, claim stale 2 min, sidecar `statusFromSession` durci, tests |
| CDC-02 | Console Global / @ / pause-stop | **FAIT** | `OfficeConsole` vues Global+bot, `mentions.ts`, `/api/office/feed`, actions pause/stop |
| CDC-03 | Accueil non mou | **FAIT** | Prompt fast-chat durci + `golden.test.ts` (20 cas) |
| CDC-04 | Orga mesurable | **FAIT** | `deploy/scripts/office-orga-playbook.sh` + agents mgr-* |
| CDC-05 | Anti-blocage | **FAIT** | Interim + progress ticks + claim stale 2 min + spawn_tree events |
| CDC-06 | Salles vivantes | **FAIT** | `mapRoom` postes fixes + Réception forcée HALL |
| CDC-07 | Corps pixel | **FAIT** | Poses stand/sit/walk/work + états ready/busy/blocked |
| CDC-08 | Contrôle réel | **FAIT** | Pause/stop envoient signal session bureau (timeout court) + event |
| CDC-09 | Timeline spawn | **FAIT** | Events `spawn_tree` + fil global / bulles system |
| CDC-10 | Qualité | **FAIT** | 99 tests master-web + 23 bridge + `smoke-office.sh` |

---

## Objectif produit

Cockpit `/agents` : vérité des états, console ops, délégation orga, réactivité.

## AS-IS enrichi (post-impl)

Voir sections précédentes + livrables ci-dessus.

## Commandes utiles

```bash
# Tests
cd apps/master-web && npm test
cd apps/openclaw-office-bridge && npm test

# Smoke
./deploy/scripts/smoke-office.sh

# Playbook orga
./deploy/scripts/office-orga-playbook.sh
```

## Critères V-pro — revalidation manuelle recommandée

1. Ouvrir `/agents` → floor + console Global/@chef/@all  
2. Message mission → interim < 2 s puis finale  
3. Working fantôme disparaît < 2 min sans commande live  
4. Chef idle → MEET ; Mgr Dev → DEV ; Réception → HALL  
5. `smoke-office.sh` vert après deploy
