# Self-Hosting Stag

Run your own private Stag with encrypted cloud backup — no GitHub Pages, no AWS.
Everything you need is in the [`selfhost/`](../selfhost) bundle: a small backend,
CouchDB, and the static app, wired together with Docker Compose.

By design Stag encrypts on your device and the server only ever holds
ciphertext. Self-hosting doesn't change that — you're just pointing the app at
**your** backend instead of the public one.

---

## What you're standing up

The Compose stack runs four containers:

- **`frontend`** — the Stag SPA, built from this repo and served by nginx.
- **`backend`** — a ~160-line Express server (`selfhost/backend`) implementing the
  `/backup` contract: it verifies a Google ID token, then stores/returns your
  encrypted blob in CouchDB. It never decrypts anything.
- **`couchdb`** — stock CouchDB; one document per user holds the ciphertext.
- **`cloudflared`** *(optional)* — a Cloudflare named tunnel for public access,
  behind the `tunnel` Compose profile.

Three separate concerns keep it secure: **Google** proves *who you are*, the
**backend** gates *which blob is yours* (by your Google `sub`), and your
**passphrase** protects *the contents* — and never leaves the browser.

---

## Prerequisites

- A host with **Docker** + **Docker Compose**.
- A **Google OAuth client ID** (free; steps below).
- A way to reach the app over **HTTPS** — Google sign-in requires a secure
  origin. Use the bundled Cloudflare tunnel, or put your own reverse proxy
  (Caddy, nginx, Traefik) with TLS in front.

---

## 1. Create a Google OAuth client

1. In the [Google Cloud Console](https://console.cloud.google.com/) → **APIs &
   Services → Credentials**, create an **OAuth client ID** of type **Web
   application**.
2. Under **Authorized JavaScript origins**, add the public origin where you'll
   serve the app, e.g. `https://stag.example.com`.
3. Copy the **client ID** (looks like `…-….apps.googleusercontent.com`). There is
   **no client secret** — the ID-token flow doesn't use one. The client ID is
   public; it ships in the frontend bundle and the backend verifies tokens
   against it.

## 2. Configure the stack

```bash
cd selfhost
cp .env.example .env
$EDITOR .env      # fill in the values described in that file
```

At minimum set `COUCHDB_USER`/`COUCHDB_PASSWORD`, `GOOGLE_CLIENT_ID`,
`CORS_ORIGIN` (your app's public origin), and `VITE_CLOUD_API_ENDPOINT` (the
public URL of the backend's `/backup` API). See [`.env.example`](../selfhost/.env.example)
for what each one means.

> The frontend's `VITE_*` values are **baked in at build time**. If you change
> them later, rebuild: `docker compose up -d --build frontend`.

## 3. Launch

```bash
docker compose up -d --build
```

CouchDB creates its single-node admin from your `.env` on first boot. Check
health:

```bash
docker compose ps
curl -s http://localhost:8080/healthz      # backend liveness
```

## 4. Expose it (pick one)

- **Cloudflare tunnel (bundled):** put your named-tunnel token in `TUNNEL_TOKEN`,
  then `docker compose --profile tunnel up -d`. Point the tunnel's public
  hostnames at the `frontend` (port 80) and `backend` (port 8080) services.
- **Your own reverse proxy:** terminate TLS and route your app origin → the
  `frontend` container and your API origin → the `backend` container. Make sure
  the API origin matches `VITE_CLOUD_API_ENDPOINT`, and your app origin matches
  `CORS_ORIGIN` and the Google **Authorized JavaScript origin**.

## 5. Use it

Open the app, go to **Cloud Backup**, sign in with Google, set a backup
passphrase, and back up. The first save lazily creates your CouchDB document.

## Updating

Pull the latest app and rebuild:

```bash
git pull
docker compose -f selfhost/docker-compose.yml up -d --build
```

(The Compose `frontend` service builds from the repo root, so a normal `git
pull` of this repo is all the app needs.)

---

## Reference: the `/backup` contract

The backend speaks exactly this; any compatible implementation works.

```
Auth:   Authorization: Bearer <google-id-token>   (a JWT)
        Verified against Google's JWKS (https://www.googleapis.com/oauth2/v3/certs):
        signature + audience == your client ID + not expired → `sub`, which
        isolates that user's single document.

GET    /backup
   200 { blob: "<encrypted-envelope-JSON-string>", rev: "<opaque>", timestamp, size }
   404 (no backup yet)

POST   /backup
   body: { blob: "<encrypted-envelope-JSON-string>", rev: "<opaque|null>" }
   200 { rev: "<new opaque>", timestamp }
   409 (rev mismatch — someone wrote since you read; client must re-GET)
   413 (too large — capped at ~5 MB)

DELETE /backup
   200
```

`rev` is opaque to the app — it's CouchDB's `_rev`, passed straight through for
optimistic locking. The client stores the last-seen `rev`, sends it on write, and
treats `409` as "re-download and retry." This matters because the browser **and**
the headless [stag-feed](../stagfeed) importer can both write the same document.

---

## Reference: the crypto envelope

Anything that re-encrypts a blob (e.g. a headless importer) must reproduce this
**exactly**, or the browser's post-decrypt checksum check fails. It mirrors
`src/services/encryption/CryptoService.ts`:

- **KDF:** PBKDF2-HMAC-SHA256, **600000** iterations, 16-byte random salt → 256-bit key.
- **Cipher:** AES-256-GCM, 12-byte random IV, 128-bit tag. WebCrypto appends the
  16-byte auth tag to the ciphertext (Python's `cryptography` `AESGCM` is directly
  compatible; with a low-level API, append/split the last 16 bytes yourself).
- **Plaintext** = `JSON.stringify(FullBackup)` — no spaces, insertion key order.
  The checksum is computed over this exact string, so re-serialize identically
  (`json.dumps(obj, separators=(',', ':'), ensure_ascii=False)` preserving key
  order).
- **Envelope JSON:** `version:1`, `algorithm:"AES-256-GCM"`, `kdf:"PBKDF2"`,
  `iterations`, `salt` (b64), `iv` (b64), `ciphertext` (b64), `timestamp` (ISO
  8601), `checksum` (SHA-256 **hex** of plaintext).
- **Stored blob** = `JSON.stringify(envelope)`.
