# Self-Hosting — Open Questions (fill in as values become known)

These are the values the **Stag app code** needs from the homelab side. Fill them
in and the patches in `SELF_HOSTING_PLAN.md` can be finalized. Items marked
**(decision)** change which code path we build; **(value)** is just a string to
drop into `.env` or a config later.

Auth approach is settled: **Google Identity Services** (the "Sign in with Google"
button / One Tap). The browser receives a Google-signed **ID token** directly —
no client secret, no Authentik/Keycloak, no token-exchange proxy. The backend
verifies that token's signature against Google's public keys (a fixed public URL)
to read the user's `sub`, then stores/returns that user's blob.

---

## 1. Google OAuth client ID  **(value)**

Create an OAuth 2.0 Client ID of type **Web application** in Google Cloud Console.
We only need the **client ID** (no secret — the ID-token flow doesn't use one).

> Client ID: ____________________

## 2. Public URL where Stag is served  **(value)**

The exact origin the app loads from. This must be registered on the Google client
as an **Authorized JavaScript origin** (note: origin only — scheme + host, no path,
no redirect URI needed for the ID-token flow).

> e.g. `https://stag.example.com`  →  ____________________

## 3. Backend `/backup` API base URL  **(value)**

Where the blob store lives (the service implementing `GET/POST/DELETE /backup`).
Stag only ever talks to this — never to CouchDB directly.

> e.g. `https://stag-api.example.com`  →  ____________________

## 4. Single-user or real multi-tenant?  **(decision)**

Do you want strangers to be able to sign up, or is this you + a few trusted
people? Doesn't change much Stag code (blob is keyed by `sub` either way) but it
decides how hard we lean on rate-limiting / abuse hardening on the open port.

> Your answer: ____________________

## 5. Login buttons  **(decision)**

Today the UI shows **Google** and **GitHub**. Google Identity Services is
Google-only. Drop the GitHub button?

> Your answer: ____________________

## 6. Homelab values for later (not needed to write Stag code, needed to deploy)

- CT 100 IP / hostname on the LAN: ____________________
- CouchDB URL the **backend** uses (not the browser): ____________________
- CouchDB URL the **stag-feed** process uses: ____________________
- TLS termination (Caddy / Traefik / Cloudflare Tunnel / other): ____________________
- Public port / how the open port is exposed: ____________________

---

## Notes

- The backend's only Google dependency is fetching Google's public signing keys
  (`https://www.googleapis.com/oauth2/v3/certs`) to verify the ID token. No
  secret, no OAuth dance, no redirects. Everything else about Google stays in the
  browser.
- The "account mapping lives in localStorage" item from the research plan is
  **not** a question — it's a one-field code change (W5 in the plan), and it's the
  piece I can build and test entirely in-repo today.
