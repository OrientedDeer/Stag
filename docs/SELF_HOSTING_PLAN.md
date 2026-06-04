# Self-Hosting — Stag App-Side Plan

Scope: **only the changes inside this repo.** The homelab pieces (CouchDB,
the `/backup` backend, stag-feed) are tracked separately. Open inputs from the
homelab side live in `SELF_HOSTING_QUESTIONS.md`.

The guiding constraint: Stag is a static SPA that encrypts client-side. The
server only ever holds ciphertext. That doesn't change — we're swapping the
**auth flow** and the **blob transport**, plus moving the SimpleFIN account map
out of `localStorage` and into the encrypted blob.

**Auth approach (settled):** Google Identity Services ID-token flow. The browser
gets a Google-signed ID token (a JWT) directly — no client secret, no Cognito, no
Authentik/Keycloak. The user then types their passphrase, the blob is encrypted
client-side, and it's sent to the backend with the ID token attached. The backend
verifies the token signature against Google's public keys to read `sub`, and gates
that user's blob. Three clean concerns: Google proves *who*, the backend gates
*which blob*, the passphrase protects *the contents* (and never leaves the browser).

---

## The interface boundary (the contract the backend must honor)

This is the seam between my work and the homelab work. Stag speaks exactly this:

```
Auth:   Authorization: Bearer <google-id-token>   (a JWT)
        Backend verifies the JWT signature against Google's JWKS
        (https://www.googleapis.com/oauth2/v3/certs), checks audience == our
        client ID and not expired, extracts `sub`, and isolates that user's doc.

GET    /backup
   200 { blob: "<encrypted-envelope-JSON-string>", rev: "<opaque>", timestamp, size }
   404 (no backup yet)

POST   /backup
   body: { blob: "<encrypted-envelope-JSON-string>", rev: "<opaque|null>" }
   200 { rev: "<new opaque>", timestamp }
   409 (rev mismatch — someone wrote since you read; client must re-GET)
   413 (too large — backend should also cap, ~5 MB)

DELETE /backup
   200
```

`rev` is opaque to Stag — it's CouchDB's `_rev`, passed through. Stag stores the
last-seen `rev`, sends it on write, and treats `409` as "re-download and retry."
This is the optimistic-locking story the research plan flagged: the browser and
stag-feed both write the same doc, so blind writes would clobber.

Shape change from today's AWS flow: the current `/backup` returns a presigned S3
URL and the client does a second request to S3. The new contract is **direct** —
the blob rides in the request/response body. Simpler, and it's what lets `rev`
round-trip.

---

## Work items (in dependency order)

### W1 — Slim down cloud config  `src/services/cloud/cloudConfig.ts`

With Google Identity Services there are no authorize/token/logout URLs to
configure — just the client ID and the backend endpoint. New `.env` keys:

- `VITE_GOOGLE_CLIENT_ID`
- `VITE_CLOUD_API_ENDPOINT` (unchanged)

`CloudConfig` drops `cognitoDomain`/`redirectUri`/`logoutUri`, keeps `clientId`
(now the Google client ID) and `apiEndpoint`. `isCloudBackupEnabled()` returns
true when both are set. Update `.env.example`.

### W2 — Replace the OAuth flow with Google Identity Services  `src/services/cloud/AuthService.ts`

The current file implements the authorization-code + PKCE flow against Cognito's
hosted endpoints. That whole machinery (PKCE verifier/challenge, `/oauth2/authorize`
redirect, code→token exchange, refresh-token storage) goes away. Replace with GIS:

- Load Google's GIS script (`https://accounts.google.com/gsi/client`) and
  initialize with the client ID.
- Sign-in returns a `credential` = the Google ID token (JWT). No redirect, no
  code exchange, no secret.
- `decodeUserInfo` stays (it already just reads JWT claims — `email`, `sub`).
- No refresh tokens: GIS ID tokens are ~1 hour. When the token is expired at
  sync time, re-prompt via GIS (One Tap / silent re-select). For a backup app
  that syncs occasionally, this is fine and removes a whole class of state.
- `getValidAccessToken()` in the provider becomes `getValidIdToken()` — if the
  cached ID token is expired, trigger a fresh GIS prompt rather than a refresh
  grant.
- Logout: just drop the local token and call `google.accounts.id.disableAutoSelect()`.
  No hosted logout URL.

This is a real rewrite of `AuthService.ts`, but a *net simplification* — fewer
moving parts and no secret anywhere.

### W3 — Direct-blob transport  `src/services/cloud/CloudBackupService.ts`

Rewrite the three functions to the contract above:

- `uploadBackup`: encrypt client-side (unchanged), keep the 5 MB guard, then
  `POST /backup` with `{ blob, rev }` directly (no presigned URL, no FormData, no
  S3). Return `{ timestamp, rev }`. Bearer = Google ID token.
- `downloadBackup`: `GET /backup`, read `{ blob, rev, ... }`, decrypt, return both
  plaintext **and** `rev` so the provider can remember it.
- `getBackupMetadata`: from the same `GET` (timestamp/size/rev). Fine to pull the
  whole blob for now — blobs are <5 MB.
- `deleteBackup`: `DELETE /backup`, unchanged shape.

### W4 — Concurrency / `rev` plumbing  `CloudBackupProvider.tsx`

- Store last-seen `rev` (ref + persisted meta) alongside `lastBackupHash`.
- `backup()` sends the stored `rev`; on `409`, surface a clear error ("Cloud copy
  changed since your last sync — restore first, then back up") and do **not**
  silently overwrite. Matches the existing dirty-state UX from commit `5ff680b`.
- `restore()` records the `rev` it pulled.

### W5 — Put the SimpleFIN account map in the blob  `useFileManager.ts` + `simplefinBalances.ts`

The research plan calls this an "open question"; it isn't — it's a field add.

- Add `balanceAccountMap?: Record<string, string[]>` to `FullBackup`.
- Export (`handleGlobalExport` + `getBackupData`): populate from `loadAccountMap()`.
- Import (`handleGlobalImport`): if present, `saveAccountMap(data.balanceAccountMap)`.
- Bump `FullBackup.version` to 2; keep the field optional so v1 blobs still load.

Why: headless stag-feed needs the SimpleFIN→Stag account mapping to know which
Stag account a fetched balance belongs to. Transaction **category** mappings are
already in the blob (`budget.importSettings.categoryMappings`), so the account map
is the only missing piece. After W5 the blob is a complete, self-contained config
for stag-feed.

This is independent of the auth/transport work and testable entirely in-repo.

### W6 — Login UI  `CloudBackupSync.tsx`, `CloudBackupPanel.tsx`

Replace the custom Google/GitHub buttons with the GIS sign-in (drop GitHub per
Q5). Cosmetic relative to the flow change in W2.

### W7 — Docs & env

- Rewrite `.env.example` for `VITE_GOOGLE_CLIENT_ID` + `VITE_CLOUD_API_ENDPOINT`.
- Add a short self-hosting setup note once values land (the referenced
  `docs/CLOUD_BACKUP_SETUP.md` doesn't currently exist).

---

## The crypto envelope — spec for the stag-feed (Python) side

No Stag code change here, but stag-feed must reproduce this **exactly** or the
round-trip fails. Verified against `src/services/encryption/CryptoService.ts`:

- KDF: PBKDF2-HMAC-SHA256, **600000** iterations, 16-byte random salt → 256-bit key
- Cipher: AES-256-GCM, 12-byte random IV, 128-bit tag
- **GCM tag placement:** WebCrypto appends the 16-byte auth tag to the ciphertext.
  Python's `cryptography` `AESGCM.encrypt/decrypt` does the same — directly
  compatible. With a low-level cipher API, split/append the last 16 bytes yourself.
- Plaintext = `JSON.stringify(FullBackup)` (JS default — no spaces, insertion key
  order). The checksum is computed over this exact string, so stag-feed must
  serialize identically when it re-encrypts. Practical rule: mutate the decrypted
  object and re-dump with `json.dumps(obj, separators=(',', ':'), ensure_ascii=False)`
  preserving key order, or the browser's post-decrypt checksum check fails.
- Envelope JSON fields: `version:1`, `algorithm:"AES-256-GCM"`, `kdf:"PBKDF2"`,
  `iterations`, `salt` (b64), `iv` (b64), `ciphertext` (b64), `timestamp` (ISO
  8601), `checksum` (SHA-256 **hex** of plaintext).
- Stored blob = `JSON.stringify(envelope)`.

Do the research plan's "decrypt → re-encrypt-unchanged round-trip" gate first,
before any merge logic.

---

## What I am NOT changing (and why)

- **CryptoService.ts** — the envelope is already correct and reproducible; touching
  it would break compatibility with existing backups for no gain.
- **The merge logic** (balances snapshot + transaction dedup) — lives in stag-feed,
  not Stag. Stag's importer is the *reference* for the behavior, but we don't run
  it headless.

---

## Suggested sequencing

1. **W5** first — independent, low-risk, testable in-repo today, and it unblocks
   stag-feed development (the feed needs the account map in the blob).
2. **W1 → W2 → W3 → W4** — the auth + transport swap. W1/W3 only need the Google
   client ID and API endpoint (Q1–Q3); W2's GIS flow can be built and stubbed
   against a test client ID before the real one lands.
3. **W6, W7** — UI + docs cleanup, last.
