# PC Worker / Agent autonome

Heartbeats Master, claim jobs `agent|pc|screen|continue`, boucle Ollama (vision + souris/clavier + skills).

## Prérequis PC

- Session graphique (`DISPLAY=:0`)
- [Ollama](https://ollama.com) + modèles (voir `models.example.json`)
- `xdotool` (ou `ydotool`), `scrot`/`import`, `xclip` recommandé
- ChatGPT connecté dans Firefox si escalade

```bash
# modèles
ollama pull llama3.2:3b
ollama pull qwen2.5:7b
ollama pull llava:7b

# deps UI
sudo apt install -y xdotool scrot xclip
```

## Run

```bash
cp .env.example .env   # WORKER_TOKEN
npm install
npm start
```

systemd user: `deploy/pc/pc-worker.service`

## Skills

Écrites dans `~/.master-pc-agent/skills/*.md` (auto via outil `save_skill`).
