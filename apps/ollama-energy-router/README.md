# ollama-energy-router

Proxy local pour OpenClaw : route chaque requête vers le modèle le plus léger capable de répondre.

| Alias | Modèle | Usage |
|-------|--------|--------|
| `auto` | heuristique | défaut |
| `fast` | `qwen3:8b` | salutations, questions courtes |
| `agent` | `qwen3-coder:30b` | code, outils, calendrier |
| `heavy` | `qwen3.6:27b` | architecture, analyses lourdes |

Écoute : `http://127.0.0.1:11435` → Ollama `11434`.

```bash
npm start
# health
curl -s http://127.0.0.1:11435/health | jq
```
