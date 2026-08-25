# Infisical self-hosted — Pixel Brain VPS

## URL

**https://secrets.pixelbrain.fr**

## Architecture

```
Cursor (MCP) ──► Infisical MCP ──► secrets.pixelbrain.fr
                                      │
                              infisical-backend:8080
                              infisical-db (Postgres 14)
                              infisical-redis
```

- **VPS** : `51.210.11.46`
- **Répertoire** : `/opt/infisical`
- **Reverse proxy** : nginx `pixelbrain-nginx` → `/opt/reverse-proxy/conf.d/infisical.conf`
- **DNS** : enregistrement A `secrets.pixelbrain.fr` → `51.210.11.46` (OVH)

## Commandes utiles

```bash
# Redéployer
./deploy/scripts/deploy.sh

# Logs
ssh yaki@51.210.11.46 "docker logs infisical-backend -f --tail 50"

# Restart
ssh yaki@51.210.11.46 "cd /opt/infisical && docker compose restart"

# Backup Postgres
ssh yaki@51.210.11.46 "docker exec infisical-db pg_dump -U infisical infisical | gzip" > infisical-backup-$(date +%Y%m%d).sql.gz
```

## Première configuration (à faire une fois)

### 1. Créer ton compte admin

1. Ouvre **https://secrets.pixelbrain.fr**
2. Inscris-toi (premier utilisateur = admin de l'organisation)
3. Crée ton organisation

### 2. Créer une Machine Identity pour Cursor

1. **Organization Settings** → **Machine Identities**
2. **Create** → nom : `cursor-agent`
3. Rôle : **Admin** (lecture + écriture des secrets)
4. Auth : **Universal Auth**
5. Copie **Client ID** et **Client Secret** dans `~/.cursor/secrets/mcp.env` :

```bash
export INFISICAL_UNIVERSAL_AUTH_CLIENT_ID="..."
export INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET="..."
source ~/.cursor/secrets/mcp.env
```

6. Redémarre Cursor

### 3. Migrer tes `.env`

Dans le dashboard Infisical :
- **New Project** par app (ex. `pixelbraincard`, `master`, etc.)
- Environnements : `dev`, `staging`, `prod`
- **Import** → colle le contenu de chaque `.env`

Ou via CLI :

```bash
brew install infisical/get-cli/infisical
infisical login --domain=https://secrets.pixelbrain.fr
infisical export --env=dev --format=dotenv > .env.backup
```

## MCP Cursor

Config globale : `~/.cursor/mcp.json`

Secrets shell : `~/.cursor/secrets/mcp.env` (chmod 600, jamais commité)

Ajouter au `~/.zshrc` :

```bash
source ~/.cursor/secrets/mcp.env
```

## Limites self-hosted

- **Projets illimités** (pas de plafond Cloud)
- Pas de versioning / RBAC avancé sans licence Pro (non nécessaire pour ton usage)
- SMTP non configuré (erreur port 587 dans les logs — sans impact)
