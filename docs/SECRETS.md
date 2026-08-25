# Architecture secrets — projet Master

Hub central Infisical pour toutes tes apps et VPS.

## Projet Infisical

| Champ | Valeur |
|-------|--------|
| Nom | `master` |
| ID | `7f4d0504-fb70-495d-9275-ec62a2b91ae4` |
| URL | https://secrets.pixelbrain.fr/project/master/secrets/overview |
| Environnements | `dev`, `staging`, `prod` |

## Organisation recommandée des secrets

Utilise des **dossiers** par app / infra dans chaque environnement :

```
master/
├── /pixelbraincard/     → app PixelbrainCard
├── /echowork/           → app EchoWork
├── /ratus/              → app Ratus
├── /vps-main/           → VPS 51.210.11.46 (infra partagée)
│   ├── OVH_API_*
│   └── STRIPE_*
└── /shared/             → clés communes (SMTP, etc.)
```

## Workers PC / Cursor / Bureau

Secrets typiques dans `/master/prod` :

- `WORKER_TOKEN` (Master + pc-worker + openclaw-office-bridge)
- `CURSOR_API_KEY`, `CURSOR_CLOUD_REPOS`, `CURSOR_MODEL`

Canal chat : **Telegram (OpenClaw)** + console `/agents`. WhatsApp a été retiré.

## Fichiers locaux (repo Master)

```
Master/
├── .cursor/
│   ├── mcp.json              → MCP Stripe + Infisical + OVH (projet)
│   └── secrets/mcp.env       → credentials MCP (gitignored)
├── deploy/                   → Infisical self-hosted sur VPS
└── docs/
    ├── INFISICAL.md          → ops Infisical
    └── SECRETS.md            → ce fichier
```

## Sync Cursor global

Cursor lit aussi `~/.cursor/mcp.json` global. Deux options :

**Option A — symlink (recommandée)**

```bash
ln -sf /Users/yaki/Documents/code/Master/.cursor/secrets/mcp.env ~/.cursor/secrets/mcp.env
```

**Option B — source dans ~/.zshrc**

```bash
source /Users/yaki/Documents/code/Master/.cursor/secrets/mcp.env
```

Puis redémarrer Cursor :

```bash
open -a Cursor
```

## Usage CLI

```bash
infisical login --domain=https://secrets.pixelbrain.fr
infisical secrets set DATABASE_URL=postgres://... \
  --projectId=7f4d0504-fb70-495d-9275-ec62a2b91ae4 \
  --env=dev \
  --path=/pixelbraincard
```

## Ce que je peux faire depuis Cursor

Une fois MCP connecté :

- Lister / créer / modifier secrets dans `master`
- Organiser par dossier (`/pixelbraincard`, `/vps-main`, etc.)
- Vue globale : « montre tous les secrets prod de pixelbraincard »
- Combiner avec OVH (DNS) et Stripe (produits)
