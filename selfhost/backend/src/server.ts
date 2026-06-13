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

// Google `sub` is a numeric string; encode defensively for use in the URL path.
const docPath = (sub: string) => `/${BACKUP_DB}/${encodeURIComponent(sub)}`;

interface AuthedRequest extends Request {
  sub?: string;
}

// ---- app ----
const app = express();
app.disable("x-powered-by");

// Accept generous bodies; we enforce the precise 5 MB limit on the blob itself
// below (JSON-string escaping can inflate a 5 MB blob past 5 MB on the wire).
app.use(express.json({ limit: "12mb" }));

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

// POST /backup
app.post("/backup", requireGoogle, async (req: AuthedRequest, res) => {
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
});
