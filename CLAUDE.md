# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: CYBER-BREACH: Protocol AM

A single-page, cyberpunk-themed tactical card game used as IT/DevOps/Networking certification prep. The player answers technical questions ("cards") to damage an adversarial AI ("AM"). `PROMPT.md` is the original design spec (in Russian) this was built from.

Plain HTML5/CSS3/vanilla JS, no build step, no framework, no bundler. Every `<script>` is a plain global-scope file loaded in dependency order — there's no module system, so load order in the `<script>` tags matters.

## Files

- `index.html` / `app.js` — the game itself, built around a single `GameState` object (player/am HP, RAM, combo, deck, active question, modifiers, log). See the top of `app.js` for `CONFIG` (damage/RAM/cost constants) and `AM_DIALOGUE` (taunt pools, including `poke`/`blocked` for the avatar Easter egg below).
- **Breach & Deconstruct** (gated questions, `q.amFirewallGated`): distractor Answer Cards start `recon-locked` and can only be purged by holding an Intel Card (a `rationaleCard`, one per wrong option, `pairId`-colored) and clicking its matching distractor — a correct match purges it (`resolveDistractor`), a wrong one permanently corrupts that Intel Card (`corruptIntelCard`) without unlocking anything. Once every Intel Card is matched-or-corrupted, `checkFirewallFallback` drops the firewall and unlocks whatever's left for a direct final pick. `finalizeAnswer`/`expireQuestion` both strip lingering `recon-locked`/`core-unlocked` classes so nothing stays visually stuck once the round ends, and `triggerRoundReview` retroactively color/badge-links every pair (`LINK #N`, shared `--match-color`) so the connection is visible in review even for pairs never actually resolved.
- **AM avatar Easter egg**: clicking `#amAvatar` (`handleAvatarClick`) gets a dismissive in-character reaction (`speak('poke', ...)`); poking again within `CONFIG.AVATAR_POKE_COOLDOWN_MS` (400ms) triggers a 5s click lockout (`data-state="blocked"`, red pulsing) with its own taunt (`speak('blocked', ...)`) instead of reacting normally. Purely cosmetic, no game-state effect.
- `editor.html` / `editor.js` — a CRUD UI for the question bank (list/add/edit/delete), sharing `styles.css` with the game.
- `questions-data.js` — `DEFAULT_QUESTIONS`, the seed deck. Shared by both pages.
- `api.js` — `Api`, a stub data layer (`getQuestions`/`createQuestion`/`updateQuestion`/`deleteQuestion`) currently backed by `localStorage`. Every method already returns the Promise shape a real `fetch()` client would, so when a real backend exists, only the bodies in `api.js` need to change — call sites in `app.js`/`editor.js` don't. The game loads its deck via `Api.getQuestions()` on start/restart, so edits made in the deck editor immediately affect gameplay on the next session.
- `styles.css` — shared cyberpunk theme (CSS custom properties for the palette), used by both pages.

## Gotcha: `hidden` attribute vs. CSS classes

Several elements are toggled via the `hidden` DOM property (modals, empty states). If you give an element's class its own `display: ...` rule, it silently overrides `[hidden]` in the cascade (author CSS beats the UA stylesheet's `[hidden] { display: none }` regardless of specificity ties) and the element stays visible. Any class with `display` that can end up on a `hidden`-toggled element needs a matching `.that-class[hidden] { display: none }` rule — see `.modal-overlay[hidden]` and `.empty-state[hidden]` in `styles.css` for the pattern.

## Local Kubernetes deployment

The app runs permanently on a local `kind` (Kubernetes-in-Docker) cluster, separate from this host's other Docker workloads (n8n/traefik/ollama/open-webui — traefik owns host ports 80/443, so this deliberately uses 8081).

- Cluster name: `memoq` (context `kind-memoq`), config at `k8s/kind-cluster.yaml`. Its `extraPortMappings` maps host port **8081** → NodePort **30080**.
- App manifests: `k8s/deployment.yaml` (namespace `memoq`, Deployment `memoq-ui` w/ 2 replicas, Service `memoq-ui` NodePort 30080). Image is `memoq-ui:latest`, built from the repo's `Dockerfile` (nginx:alpine serving the static files) and side-loaded into the kind node with `kind load docker-image` — there's no registry involved, `imagePullPolicy: Never`.
- **Public URL (HTTPS, works from anywhere including mobile): https://am.neuromancerdream.com** — real Let's Encrypt cert, HTTP auto-redirects to HTTPS.
- **Local URL: http://localhost:8081** (game) and `/editor.html` (deck editor) — also reachable via LAN at `http://<host-LAN-IP>:8081`, unauthenticated over plain HTTP transport (use the HTTPS domain instead when off-LAN).
- Both entry points sit behind the same nginx HTTP Basic Auth (username `admin`) — see below.
- The kind node container (`memoq-control-plane`) has `--restart unless-stopped` set via `docker update`, so it survives Docker daemon/host restarts and the cluster comes back on its own (kubelet inside the node reboots via systemd and the Deployment self-heals).

### HTTPS via the existing Traefik stack

`am.neuromancerdream.com` is routed through the **separate** Traefik/Let's Encrypt reverse proxy that already fronts n8n and other services, at `/home/neuromancer/n8n_project/n8n/` (its own docker-compose project — not part of this repo). Traefik can't auto-discover memoq via Docker labels (it's a k8s pod, not a labeled container on Traefik's `web` network), so it's wired up via Traefik's **file provider** instead:

- `n8n_project/n8n/traefik/traefik.yml` — added a `providers.file` block (`directory: /etc/traefik/dynamic`, `watch: true`), alongside the existing `providers.docker` block used by label-discovered services.
- `n8n_project/n8n/traefik/dynamic/memoq.yml` — the actual router/service definition: `Host(\`am.neuromancerdream.com\`)` → `http://172.18.0.1:8081` (the `web` bridge network's gateway IP, which *is* this host — that's how a container on that network reaches memoq's NodePort on the host), TLS via the existing `letsencrypt` cert resolver, plus an HTTP→HTTPS redirect scoped to just this host.
- `n8n_project/n8n/docker-compose.yml` — one added volume line on the `traefik` service to mount that `dynamic/` directory in.
- `n8n_project/n8n/.env` — `am.neuromancerdream.com` appended to `DOMAINS=` so `cloudflare-ddns` keeps its A record pointed at this host.
- Because this routes through the bridge gateway to the host's `0.0.0.0:8081`, that port needs to stay bound openly (not restricted to `127.0.0.1`) for Traefik to reach it — see the note above about it also being reachable directly on the LAN as a result.

If memoq's own `k8s/kind-cluster.yaml` port mapping (currently 8081) ever changes, `traefik/dynamic/memoq.yml`'s backend URL needs updating to match, and Traefik will pick it up automatically (`watch: true`, no restart needed — only the initial `providers.file` addition required restarting the `traefik` container).

### Basic Auth

`k8s/nginx-auth-configmap.yaml` overrides nginx's `default.conf` to require `auth_basic` on every path except `/healthz` (kept open so kubelet's readiness/liveness probes — pointed at `/healthz`, not `/index.html` — don't need credentials). The password hash lives in a Secret named `memoq-basic-auth` (key `.htpasswd`, apr1/MD5 format) applied directly to the cluster with `kubectl create secret ... | kubectl apply -f -` — **it is intentionally not checked into this repo** as a manifest, since that would persist the hash in a plain inspectable file. The plaintext password itself was only ever shown to the user once, never written to disk in this project.

To rotate the password:

```bash
NEW_PW=$(openssl rand -base64 15 | tr -d '/+=' | head -c 20)
HASH=$(openssl passwd -apr1 "$NEW_PW")
kubectl --context kind-memoq -n memoq create secret generic memoq-basic-auth \
  --from-literal=".htpasswd=admin:${HASH}" --dry-run=client -o yaml \
  | kubectl --context kind-memoq apply -f -
kubectl --context kind-memoq -n memoq rollout restart deployment/memoq-ui
echo "$NEW_PW"   # show once, then discard
```

### After editing game files

Static files are baked into the image at build time, not volume-mounted — a code change needs a rebuild + redeploy:

```bash
./deploy.sh
```

This builds `memoq-ui:latest`, loads it into the `memoq` kind cluster, and does a rolling restart of the `memoq-ui` Deployment.

### Useful commands

```bash
kubectl --context kind-memoq -n memoq get pods
kubectl --context kind-memoq -n memoq logs -l app=memoq-ui
kind get clusters                      # confirm the `memoq` cluster exists
kind delete cluster --name memoq       # tear it down entirely
```

`kubectl` and `kind` are installed to `~/.local/bin` (already on `PATH`), not system-wide.
