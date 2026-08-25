# PC worker (bureau Master / Cursor Cloud)

## Prérequis
- Tailscale vers le VPS Master
- `WORKER_TOKEN` identique à Master

## Setup
```bash
cp .env.example .env   # remplir WORKER_TOKEN
# démarrer pc-worker (systemd user ou npm)
```

## Jobs
Les jobs viennent du bureau `/agents` (canal `office`) ou de l’orchestrator Cursor Cloud.
Telegram passe par OpenClaw (`telegram-pc`), pas par ce worker.
