# Connexion sécurisée MonMac ↔ yaki-pc

## Déjà en place

| Lien | Statut |
|------|--------|
| **Tailscale mesh** | `monmac` `100.124.250.82` ↔ `yaki-pc` `100.77.151.74` (chiffré WireGuard) |
| **SSH Mac → PC** | Alias `ssh yaki-pc` (clé ed25519, Tailscale only) |
| **SSH PC → Mac** | Config prête (`Host monmac`) — **bloque** tant que « Connexion à distance » n’est pas activée sur le Mac |

## Activer SSH inverse (PC → Mac) — 30 s

Sur **MonMac** :

1. Réglages Système → Général → **Partage**
2. Active **Connexion à distance** (Remote Login)
3. Autorise l’utilisateur `yaki`

Test depuis le PC :
```bash
ssh monmac 'hostname'
```

## Services PC en cours

- `pc-worker` — heartbeat / jobs bureau (`office`) + Cursor

Logs :
```bash
ssh yaki-pc 'tail -f ~/logs/pc-worker.log'
```

Chat utilisateur : **Telegram** via OpenClaw (`telegram-pc`) + console `/agents` sur Master.
