# Master Orchestrator — Cursor Cloud worker (VPS)

Poll Master for `cloud` jobs and run them with `@cursor/sdk` (Composer by default).

## Env

See `.env.example`. Required:

- `WORKER_TOKEN`
- `CURSOR_API_KEY`
- `CURSOR_CLOUD_REPOS` — `owner/repo` or full GitHub URLs, comma-separated
- `MASTER_URL` — in Docker: `http://master-web:3040`

## Run local

```bash
npm install
npm start
```

## Docker

Built via `deploy/master-panel/docker-compose.yml` as `master-orchestrator` (`mem_limit: 384m`).
