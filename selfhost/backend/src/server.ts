/**
 * stag-backend — a zero-knowledge per-user encrypted-blob store.
 *
 * It implements exactly the contract the Stag client expects:
 *   GET    /backup  -> 200 { blob, rev, timestamp, size } | 404
 *   POST   /backup  -> body { blob, rev } -> 200 { rev, timestamp } | 409 | 413
 *   DELETE /backup  -> 200 (404 tolerated)
 *
 * Auth: every request carries `Authorization: Bearer <google-id-token>` (a JWT).
 * We verify it against Google's JWKS (signature + iss + aud + exp) and use the
 * `sub` claim to isolate that user's single CouchDB document. The server never
 * decrypts anything — `blob` is opaque ciphertext in and out.
 *
 * Concurrency: `rev` IS CouchDB's `_rev`, passed straight through. A stale rev
 * makes CouchDB return 409, which we relay verbatim. No blind overwrites.
 */
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { OAuth2Client } from "google-auth-library";

// ---- config (from env) ----
const PORT = parseInt(process.env.PORT || "8080", 10);
const COUCHDB_URL = process.env.COUCHDB_URL || "http://couchdb:5984";
const COUCHDB_USER = process.env.COUCHDB_USER || "";
const COUCHDB_PASSWORD = process.env.COUCHDB_PASSWORD || "";
const BACKUP_DB = process.env.BACKUP_DB || "stag_backups";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "";
const MAX_BLOB_BYTES = parseInt(process.env.MAX_BLOB_BYTES || String(5 * 1024 * 1024), 10);

const couchAuth = "Basic " + Buffer.from(`${COUCHDB_USER}:${COUCHDB_PASSWORD}`).toString("base64");
const googleClient = new OAuth2Client();

// ---- tiny CouchDB helper ----
async function couch(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${COUCHDB_URL}${path}`, {
    method,
    headers: {
      Authorization: couchAuth,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
}

// Both the DB-name and the doc-id (`sub`) segments are encoded for the URL path.
// The DB name MUST be encoded the same way everywhere it appears (here and in
// ensureBackupDb's create path) — otherwise an operator who sets a BACKUP_DB with
// a URL-special char (e.g. CouchDB's legal `+`/`$`/`()`) would create the db at
// one URL while every write 404s against another, so backups never persist.
const dbSegment = encodeURIComponent(BACKUP_DB);
const docPath = (sub: string) => `/${dbSegment}/${encodeURIComponent(sub)}`;

// Create the backup database idempotently. CouchDB 3 auto-creates only its
// system DBs (_users/_replicator/_global_changes), never an app DB — so without
// this a fresh deploy 404s on the very first backup write. PUT /<db> returns
// 201 (created) on first run and 412 (already exists) thereafter; both are fine.
// We retry because the backend usually wins the boot race against CouchDB.
//
// In-flight guard: a single shared promise coalesces concurrent callers (a burst
// of POSTs during a missing-db window would otherwise each spawn their own
// 30-attempt loop). The memo is cleared once it settles so a later genuine
// re-create (db dropped again) can still kick off a fresh loop.
let ensureBackupDbInFlight: Promise<void> | null = null;
function ensureBackupDb(): Promise<void> {
  if (!ensureBackupDbInFlight) {
    ensureBackupDbInFlight = ensureBackupDbOnce().finally(() => {
      ensureBackupDbInFlight = null;
    });
  }
  return ensureBackupDbInFlight;
}

async function ensureBackupDbOnce(): Promise<void> {
  const maxAttempts = 30;
  const dbPath = `/${dbSegment}`;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let status: number;
    let json: any;
    try {
      ({ status, json } = await couch("PUT", dbPath));
    } catch (err) {
      // Connection refused while CouchDB is still booting — expected early on.
      if (attempt === maxAttempts) {
        console.error(`  backup db:      FAILED to reach CouchDB after ${maxAttempts} attempts`);
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    if (status === 201 || status === 412) {
      console.log(
        `  backup db:      "${BACKUP_DB}" ${status === 201 ? "created" : "already present"}`
      );
      return;
    }
    // 401/403 means bad CouchDB creds — no amount of retrying fixes that.
    if (status === 401 || status === 403) {
      throw new Error(`CouchDB rejected db creation (${status}): check COUCHDB_USER/PASSWORD`);
    }
    console.warn(`  backup db:      PUT /${BACKUP_DB} -> ${status} ${JSON.stringify(json)} (retrying)`);
    if (attempt === maxAttempts) {
      throw new Error(`could not create db "${BACKUP_DB}": last status ${status}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

interface AuthedRequest extends Request {
  sub?: string;
}

// ---- app ----
const app = express();
app.disable("x-powered-by");

// Accept generous bodies; we enforce the precise 5 MB limit on the blob itself
// below (JSON-string escaping can inflate a 5 MB blob past 5 MB on the wire).
// NOTE: this parser is mounted only on the authenticated POST route (after
// requireGoogle), NOT globally — so an unauthenticated client can't make us
// buffer + parse a 12 MB body before we reject it. It runs after the auth check.
const parseJsonBody = express.json({ limit: "12mb" });

// CORS: allow exactly the Stag app's public origin. The `cors` middleware also
// answers the OPTIONS preflight that a cross-origin Authorization header triggers.
app.use(
  cors({
    origin: CORS_ORIGIN || false,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type"],
    maxAge: 86400,
  })
);

// liveness — no auth, used by healthchecks / the tunnel
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, db: BACKUP_DB, googleConfigured: Boolean(GOOGLE_CLIENT_ID) });
});

// verify the Google ID token -> req.sub
async function requireGoogle(req: AuthedRequest, res: Response, next: NextFunction) {
  const m = (req.header("authorization") || "").match(/^Bearer (.+)$/i);
  if (!m) return res.status(401).json({ error: "missing bearer token" });
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: "server not configured: GOOGLE_CLIENT_ID unset" });
  }
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: m[1], audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.sub) return res.status(401).json({ error: "invalid token" });
    req.sub = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "token verification failed" });
  }
}

// GET /backup
app.get("/backup", requireGoogle, async (req: AuthedRequest, res) => {
  const { status, json } = await couch("GET", docPath(req.sub!));
  if (status === 404) return res.status(404).json({ error: "no backup" });
  if (status !== 200) return res.status(502).json({ error: "store error" });
  return res.json({ blob: json.blob, rev: json._rev, timestamp: json.timestamp, size: json.size });
});

// POST /backup — requireGoogle runs FIRST; only then do we parse the body.
app.post("/backup", requireGoogle, parseJsonBody, async (req: AuthedRequest, res) => {
  const blob = req.body?.blob;
  const rev: string | null = req.body?.rev ?? null;
  if (typeof blob !== "string") return res.status(400).json({ error: "blob must be a string" });

  const size = Buffer.byteLength(blob, "utf8");
  if (size > MAX_BLOB_BYTES) return res.status(413).json({ error: "blob too large" });

  const doc: Record<string, unknown> = {
    _id: req.sub,
    blob,
    size,
    timestamp: new Date().toISOString(),
  };
  if (rev) doc._rev = rev;

  const { status, json } = await couch("PUT", docPath(req.sub!), doc);
  if (status === 201 || status === 200) return res.json({ rev: json.rev, timestamp: doc.timestamp });
  if (status === 409) return res.status(409).json({ error: "stale rev" });
  // A 404 here means the backup DB itself is missing (it should have been
  // created at startup) — surface it as a config error, not a generic store
  // error, and try to self-heal so the next write succeeds.
  if (status === 404) {
    ensureBackupDb().catch(() => {});
    return res.status(503).json({ error: "backup database missing — initializing, retry shortly" });
  }
  return res.status(502).json({ error: "store error" });
});

// DELETE /backup  (idempotent; 404 tolerated)
app.delete("/backup", requireGoogle, async (req: AuthedRequest, res) => {
  const get = await couch("GET", docPath(req.sub!));
  if (get.status === 404) return res.status(200).json({ ok: true });
  if (get.status !== 200) return res.status(502).json({ error: "store error" });

  const rev = get.json._rev;
  const del = await couch("DELETE", `${docPath(req.sub!)}?rev=${encodeURIComponent(rev)}`);
  if (del.status === 200 || del.status === 202 || del.status === 404) {
    return res.status(200).json({ ok: true });
  }
  return res.status(502).json({ error: "store error" });
});

app.listen(PORT, () => {
  console.log(`stag-backend listening on :${PORT}`);
  console.log(`  couchdb:        ${COUCHDB_URL} (db=${BACKUP_DB})`);
  console.log(`  google client:  ${GOOGLE_CLIENT_ID ? "set" : "UNSET — /backup will 503"}`);
  console.log(`  cors origin:    ${CORS_ORIGIN || "UNSET — cross-origin blocked"}`);
  console.log(`  max blob bytes: ${MAX_BLOB_BYTES}`);
  // Idempotently provision the backup DB (retries past CouchDB's boot race).
  // Failure here is logged but non-fatal: the POST route also self-heals on 404.
  ensureBackupDb().catch((err) =>
    console.error(`  backup db:      could not provision "${BACKUP_DB}": ${err?.message || err}`)
  );
});
