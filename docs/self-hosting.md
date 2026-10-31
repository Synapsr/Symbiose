# Self-hosting

The Symbiose server is one small Docker image (amd64 and arm64) and one volume. It needs no database server, no mail server and no account anywhere, except at the AI provider you choose.

## Start

```bash
docker run -d --name symbiose -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v symbiose-data:/data \
  ghcr.io/synapsr/symbiose:latest
```

Or with Compose, from a copy of [`docker-compose.yml`](../docker-compose.yml):

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up -d
```

The start-up log says which AI answers, who can sign up and who sees the admin view:

```
Symbiose server v0.1.0 listening on http://0.0.0.0:3000
Data directory: /data
AI: anthropic · claude-opus-5-5
Sign-up: closed, only the first account (SIGNUP=open or request to change)
Admin view off: list admin emails in ADMIN_EMAILS to see how the server is used
```

## Connect the app

Open `http://<your-server>:3000` in a browser: the page shows a QR code. In the app, tap **Scan the server QR code** (or type the address), then create your account. The first account can always be created; after that, `SIGNUP` decides.

The QR code holds the address the page was opened with. Behind a reverse proxy, or if you opened the page on the server itself (`localhost`), set `PUBLIC_URL` to the address phones should use.

On iOS, plain `http://` works on your local network (an IP address or a `.local` name). Anything reachable from the internet needs HTTPS: put the server behind a reverse proxy such as Caddy, Traefik or nginx.

```
# Caddyfile
symbiose.example.com {
  reverse_proxy localhost:3000
}
```

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | | Enables photo and text analysis, plans, the coach and reviews with Claude. Without any AI, the app still works: barcodes, manual logging, keyword-based plans. |
| `ANTHROPIC_WORKSPACE_ID` | | Only for API keys that aren't scoped to a workspace (Claude Console → Settings → Workspaces). |
| `AI_PROVIDER` | `anthropic` | Another provider: `openai`, `mistral`, `gemini`, `openrouter`, `ollama` or `openai-compatible` ([below](#ai-providers)). |
| `AI_API_KEY` | | The provider's key. Its own variable works too: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MISTRAL_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_API_KEY`. |
| `AI_MODEL` | per provider | Any model id the provider serves. |
| `AI_BASE_URL` | per provider | Where an OpenAI-compatible server listens (Ollama, LM Studio, vLLM…). |
| `AI_VISION` | `true` | `false` for a model that can't read photos: photo meals then ask for a description, text meals work. |
| `AI_PRICES` | | Prices for the admin view's cost estimate, for models other than Claude: `model=input/output[/cacheRead[/cacheWrite]]` in USD per million tokens, comma-separated (`my-model=1.25/10/0.125,gemma4=0/0`). Claude's prices are built in; a dated id (`-2026-09-01`) takes its alias's price. |
| `PUBLIC_URL` | the address the page was opened with | The address in the QR code. Set it behind a reverse proxy. |
| `SIGNUP` | `closed` | Who gets an account after the first one: `closed` (nobody), `request` (anyone can ask, an admin accepts or refuses) or `open` (anyone who can reach the server). The older `ALLOW_SIGNUP=true` still means `open`. |
| `ADMIN_EMAILS` | | Comma-separated emails of the accounts that see the admin view ([below](#accounts-and-the-admin-view)). |
| `CORS_ORIGINS` | `*` | Comma-separated origins allowed to call the API from a browser. Only the app's web build is concerned: the phone and watch apps aren't browsers. The API uses tokens, not cookies, so `*` is safe; narrow it if you prefer, e.g. `https://app.example.com`. |
| `DATA_DIR` | `/data` in the image, `./data` from source | The SQLite database, the photos, the generated token secret and the automatic backups. Back up this folder. |
| `JWT_SECRET` | generated once in `DATA_DIR` | Override the token signing secret. Changing it signs everyone out. |
| `PORT` | `3000` | |
| `AI_MOCK` | `false` | **Development only**: canned AI answers, to work on the app without a key. |

## AI providers

Claude is the default, and the reference: Symbiose's prompts were written and tuned on it. Other models work, but may be less precise on portions and nutrients, and small local models much less so. Photo meals need a model that reads images; the coach's proposals (log a meal, change goals) need one that calls tools, otherwise it answers in plain text. The start-up log says which provider and model answer, or what is missing.

| `AI_PROVIDER` | Default `AI_MODEL` | Key |
| --- | --- | --- |
| `anthropic` | `claude-opus-5-5` | `ANTHROPIC_API_KEY` |
| `openai` | `gpt-6-astra` | `OPENAI_API_KEY` |
| `mistral` | `mistral-large-4` | `MISTRAL_API_KEY` |
| `gemini` | `gemini-3.8-flash` | `GEMINI_API_KEY` |
| `openrouter` | `anthropic/claude-opus-5.5` | `OPENROUTER_API_KEY` |
| `ollama` | `gemma4` | none (`AI_BASE_URL` defaults to `http://localhost:11434/v1`) |
| `openai-compatible` | required | optional (`AI_BASE_URL` required) |

```bash
# OpenAI
docker run -d --name symbiose -p 3000:3000 -v symbiose-data:/data \
  -e AI_PROVIDER=openai -e AI_API_KEY=sk-... ghcr.io/synapsr/symbiose:latest

# Mistral
docker run -d --name symbiose -p 3000:3000 -v symbiose-data:/data \
  -e AI_PROVIDER=mistral -e AI_API_KEY=... ghcr.io/synapsr/symbiose:latest

# Google Gemini
docker run -d --name symbiose -p 3000:3000 -v symbiose-data:/data \
  -e AI_PROVIDER=gemini -e AI_API_KEY=... ghcr.io/synapsr/symbiose:latest

# OpenRouter, here with another model than the default
docker run -d --name symbiose -p 3000:3000 -v symbiose-data:/data \
  -e AI_PROVIDER=openrouter -e AI_API_KEY=sk-or-... -e AI_MODEL=openai/gpt-6.1-sol ghcr.io/synapsr/symbiose:latest

# Ollama on the same machine: `ollama pull gemma4` first (on Linux, start Ollama with OLLAMA_HOST=0.0.0.0)
docker run -d --name symbiose -p 3000:3000 -v symbiose-data:/data --add-host=host.docker.internal:host-gateway \
  -e AI_PROVIDER=ollama -e AI_BASE_URL=http://host.docker.internal:11434/v1 -e AI_MODEL=gemma4 ghcr.io/synapsr/symbiose:latest

# Any OpenAI-compatible server: LM Studio, vLLM, llama.cpp…
docker run -d --name symbiose -p 3000:3000 -v symbiose-data:/data \
  -e AI_PROVIDER=openai-compatible -e AI_BASE_URL=http://192.168.1.20:1234/v1 -e AI_MODEL=my-model ghcr.io/synapsr/symbiose:latest
```

## Accounts and the admin view

**Sign-up.** The first account can always be created. With `SIGNUP=request`, anyone can ask for an account; until an admin accepts, the account reaches neither the AI nor any data. With `SIGNUP=open`, anyone who can reach the server gets one: fine for a family server on your home network.

<img src="screenshots/admin-light.webp#gh-light-mode-only" width="240" align="right" alt="The admin view: the AI's estimated cost over 30 days, calls per feature, response times and errors" />
<img src="screenshots/admin-dark.webp#gh-dark-mode-only" width="240" align="right" alt="The admin view: the AI's estimated cost over 30 days, calls per feature, response times and errors" />

**Admin view.** List your email in `ADMIN_EMAILS` and an « Admin » row shows up in *Me*: a glance at the whole server, with the AI's calls, tokens and estimated cost, how much the app is used, and the server's health. Counts and totals only: never anyone's email, name, meals or notes, and no per-person figure. Each AI call is kept as numbers alone (feature, model, tokens, duration, error code; no account, no content) for 13 months. With `SIGNUP=request`, it also lists the requests to accept or refuse, with only the email, first name and date (refusing deletes the account).

Accounts aren't verified by email, so someone could sign up with a listed email before its owner. On request, that account waits like any other and is no admin until approved. With open sign-up, a listed email is refused unless it is the server's first account: create the account, then list it (the server warns at start-up about listed emails without one).

<br clear="right" />

## Backups

Everything lives in `DATA_DIR` (the `symbiose-data` volume):

```
symbiose.db        the database, with its -wal and -shm files: keep the three together
photos/            meal photos
.jwt-secret        the token signing secret
backups/           automatic copies of the database, made before each update that changes it
```

To back it up, stop the server for a moment and archive the volume:

```bash
docker stop symbiose
docker run --rm -v symbiose-data:/data -v "$PWD":/backup alpine tar czf /backup/symbiose-backup.tgz -C /data .
docker start symbiose
```

With Compose, the volume carries the folder's name as a prefix (`docker volume ls` shows it), and `docker compose stop` / `start` replace the first and last lines.

Each person can also export all their data as JSON from the app (*Me* → *Export my data*).

## Updating

```bash
docker pull ghcr.io/synapsr/symbiose:latest
docker rm -f symbiose
docker run -d --name symbiose ...        # the same command as before
```

With Compose: `docker compose pull && docker compose up -d`.

Migrations run automatically at start-up. Before applying new ones, the server copies the database to `DATA_DIR/backups/` (the last three copies are kept), so an update can always be rolled back: stop the server, put the copy back as `symbiose.db`, delete `symbiose.db-wal` and `symbiose.db-shm`, and start the previous image.

## Without Docker

Node.js 22 and pnpm 10:

```bash
pnpm install
pnpm build:server
cd apps/server && ANTHROPIC_API_KEY=sk-ant-... DATA_DIR=./data node dist/index.js
```

To build the image yourself: `docker build -t symbiose .` at the root of the repository.
