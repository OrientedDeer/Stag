/**
 * Integration tests for the three selfhost-deploy fixes. These run the REAL
 * compiled server (dist/server.js) as a child process against an in-process
 * fake CouchDB, so they exercise the actual middleware order and startup wiring
 * — not a reconstruction.
 *
 * No external test framework: uses Node's built-in `node:test` runner.
 *   build first, then:  node --test dist/server.test.js
 *
 * The fake CouchDB records every request it receives so we can assert exactly
 * what the backend did (e.g. that it PUT the db at startup, that an
 * unauthenticated POST never reached the body parser).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, ChildProcess } from "node:child_process";
import { AddressInfo } from "node:net";
import { resolve as resolvePath } from "node:path";

const BACKUP_DB = "stag_backups";

interface RecordedReq {
  method: string;
  url: string;
}

/** A configurable fake CouchDB. `dbExists` starts false so we can prove the
 *  backend creates the database itself.
 *
 *  `dbSegment` is the exact URL path segment the backend is expected to use for
 *  the database (i.e. how it encodes BACKUP_DB). It defaults to the plain
 *  `stag_backups` (which needs no encoding) but the encode-consistency test
 *  overrides it with a special-char name's encoded form. */
class FakeCouch {
  server: http.Server;
  port = 0;
  requests: RecordedReq[] = [];
  dbExists = false;
  // When true, the PUT /<db>/<doc> write succeeds; otherwise it 404s as a real
  // CouchDB would when the database is missing.
  failDocWriteWith404 = false;
  // Delay (ms) applied to the create-db PUT so a concurrency test can hold a
  // missing-db window open while several POSTs pile up.
  createDbDelayMs = 0;

  constructor(public dbSegment: string = BACKUP_DB) {
    this.server = http.createServer((req, res) => {
      this.requests.push({ method: req.method || "", url: req.url || "" });
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => this.handle(req, res));
    });
  }

  handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url || "";
    const method = req.method || "";
    const dbUrl = `/${this.dbSegment}`;
    const send = (code: number, obj: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    // PUT /<db>  -> create database
    if (method === "PUT" && url === dbUrl) {
      const respond = () => {
        if (this.dbExists) return send(412, { error: "file_exists" });
        this.dbExists = true;
        return send(201, { ok: true });
      };
      if (this.createDbDelayMs > 0) {
        setTimeout(respond, this.createDbDelayMs);
        return;
      }
      return respond();
    }
    // PUT /<db>/<doc>  -> write the user document
    if (method === "PUT" && url.startsWith(`${dbUrl}/`)) {
      if (this.failDocWriteWith404 || !this.dbExists) {
        return send(404, { error: "not_found", reason: "Database does not exist." });
      }
      return send(201, { ok: true, id: "x", rev: "1-abc" });
    }
    // GET /<db>/<doc>
    if (method === "GET" && url.startsWith(`${dbUrl}/`)) {
      return send(404, { error: "not_found" });
    }
    return send(404, { error: "not_found" });
  }

  listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", () => {
        this.port = (this.server.address() as AddressInfo).port;
        resolve();
      });
    });
  }
  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
  get url() {
    return `http://127.0.0.1:${this.port}`;
  }
}

let couch: FakeCouch;
let backend: ChildProcess;
let backendPort = 0;

// A second backend instance run WITH a Google-verification stub, so the
// authenticated /backup flow (happy path + the 404->503 config-error mapping)
// is reachable without a real ID token.
let authedBackend: ChildProcess;
let authedPort = 0;

// Ask the OS for a free port, then hand it to the backend explicitly. The
// server logs only its *configured* PORT (not the bound socket), so we can't
// scrape an ephemeral port from its output — we pick one up front.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

async function startBackend(extraEnv: Record<string, string> = {}): Promise<void> {
  backendPort = await freePort();
  return new Promise((resolve, reject) => {
    backend = spawn("node", ["dist/server.js"], {
      env: {
        ...process.env,
        PORT: String(backendPort),
        COUCHDB_URL: couch.url,
        COUCHDB_USER: "u",
        COUCHDB_PASSWORD: "p",
        BACKUP_DB,
        // Unset so requireGoogle returns 503 on a *valid* bearer token, but the
        // "no bearer header at all" path still 401s first — which is what the
        // auth-before-parse test relies on.
        GOOGLE_CLIENT_ID: "",
        CORS_ORIGIN: "https://example.test",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      if (/listening on :\d+/.test(out)) resolve();
    };
    backend.stdout!.on("data", onData);
    backend.stderr!.on("data", onData);
    backend.on("error", reject);
    setTimeout(() => reject(new Error(`backend did not start; output:\n${out}`)), 8000);
  });
}

// Start a backend with Google verification stubbed (via the --require preload),
// so requests bearing "Bearer stub:<sub>" authenticate as <sub>.
async function startAuthedBackend(): Promise<void> {
  authedPort = await freePort();
  const stub = resolvePath(__dirname, "..", "src", "stub-google.cjs");
  return new Promise((resolve, reject) => {
    authedBackend = spawn("node", ["--require", stub, "dist/server.js"], {
      env: {
        ...process.env,
        PORT: String(authedPort),
        COUCHDB_URL: couch.url,
        COUCHDB_USER: "u",
        COUCHDB_PASSWORD: "p",
        BACKUP_DB,
        GOOGLE_CLIENT_ID: "test-client-id", // set, so requireGoogle proceeds to verify
        CORS_ORIGIN: "https://example.test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      if (/listening on :\d+/.test(out)) resolve();
    };
    authedBackend.stdout!.on("data", onData);
    authedBackend.stderr!.on("data", onData);
    authedBackend.on("error", reject);
    setTimeout(() => reject(new Error(`authed backend did not start; output:\n${out}`)), 8000);
  });
}

/**
 * Spawn a standalone, Google-stubbed backend against an arbitrary fake CouchDB
 * and BACKUP_DB. Used by the encode-consistency and self-heal-coalescing tests,
 * which need their own isolated instance + recorded-request log rather than the
 * shared `before`-block backends. Resolves with the bound port and a kill fn.
 */
async function spawnBackend(opts: {
  couchUrl: string;
  backupDb: string;
}): Promise<{ port: number; kill: () => void }> {
  const port = await freePort();
  const stub = resolvePath(__dirname, "..", "src", "stub-google.cjs");
  const child = spawn("node", ["--require", stub, "dist/server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      COUCHDB_URL: opts.couchUrl,
      COUCHDB_USER: "u",
      COUCHDB_PASSWORD: "p",
      BACKUP_DB: opts.backupDb,
      GOOGLE_CLIENT_ID: "test-client-id",
      CORS_ORIGIN: "https://example.test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let out = "";
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      if (/listening on :\d+/.test(out)) resolve();
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("error", reject);
    setTimeout(() => reject(new Error(`backend did not start; output:\n${out}`)), 8000);
  });
  return { port, kill: () => child.kill() };
}

function reqTo(
  port: number,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "127.0.0.1", port, method, path, headers: opts.headers },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: b }));
      }
    );
    r.on("error", reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

const req = (
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {}
) => reqTo(backendPort, method, path, opts);

before(async () => {
  couch = new FakeCouch();
  await couch.listen();
  await startBackend();
  await startAuthedBackend();
  // Give ensureBackupDb (fired in each app.listen callback) a beat to run.
  await new Promise((r) => setTimeout(r, 400));
});

after(async () => {
  if (backend && !backend.killed) backend.kill();
  if (authedBackend && !authedBackend.killed) authedBackend.kill();
  if (couch) await couch.close();
});

// ---- ISSUE 1: backup DB is created at startup ----
test("ISSUE 1: backend PUTs the backup database at startup", () => {
  const createdDb = couch.requests.some((r) => r.method === "PUT" && r.url === `/${BACKUP_DB}`);
  assert.ok(createdDb, "expected a startup PUT /stag_backups to create the db");
  assert.equal(couch.dbExists, true, "fake CouchDB should now hold the backup db");
});

// ---- ISSUE 2: auth runs BEFORE the JSON body parser (DoS amplification) ----
test("ISSUE 2: unauthenticated POST with malformed body is rejected by auth, not the parser", async () => {
  // Malformed JSON: if the body parser ran first (the bug), express.json would
  // 400 on the parse. With auth first, the missing bearer token 401s and the
  // body is never parsed.
  const res = await req("POST", "/backup", {
    headers: { "content-type": "application/json" },
    body: "{ this is not valid json ",
  });
  assert.equal(res.status, 401, `expected 401 from auth, got ${res.status}: ${res.body}`);
});

test("ISSUE 2: a large MALFORMED unauthenticated POST never reaches the body parser", async () => {
  // 1 MB of junk that is NOT valid JSON, with no auth header. This is the true
  // ordering discriminator: if the global parser still ran first (the bug), the
  // malformed body would 400 on parse; with auth first, the missing token 401s
  // and the megabyte is never buffered/parsed. (A *valid* large JSON body would
  // 401 either way, so it wouldn't prove the parser was skipped.)
  const big = "x".repeat(1024 * 1024);
  const res = await req("POST", "/backup", {
    headers: { "content-type": "application/json" },
    body: "{ " + big, // unterminated object => parse error under the global parser
  });
  assert.equal(res.status, 401, `expected 401 (auth before parse), got ${res.status}`);
});

// ---- ISSUE 1 (continued), via the AUTHED backend (Google stubbed) ----

test("ISSUE 1: an authenticated POST stores successfully once the db exists", async () => {
  // Sanity: with the db present (created at startup), the happy path writes.
  couch.failDocWriteWith404 = false;
  const res = await reqTo(authedPort, "POST", "/backup", {
    headers: { "content-type": "application/json", authorization: "Bearer stub:user-1" },
    body: JSON.stringify({ blob: "ciphertext", rev: null }),
  });
  assert.equal(res.status, 200, `expected 200 store, got ${res.status}: ${res.body}`);
});

test("ISSUE 1: a 404 from CouchDB (missing db) surfaces as 503 config error, not a generic 502", async () => {
  // Simulate the backup db being absent when the write lands: CouchDB 404s the
  // doc PUT. The fixed handler maps that to a 503 'backup database missing'
  // (and kicks off self-heal), NOT the catch-all 502 'store error'.
  couch.failDocWriteWith404 = true;
  try {
    const res = await reqTo(authedPort, "POST", "/backup", {
      headers: { "content-type": "application/json", authorization: "Bearer stub:user-2" },
      body: JSON.stringify({ blob: "ciphertext", rev: null }),
    });
    assert.equal(res.status, 503, `expected 503 config error, got ${res.status}: ${res.body}`);
    assert.match(res.body, /database missing/i);
  } finally {
    couch.failDocWriteWith404 = false;
  }
});

test("ISSUE 2: the authed backend also parses the body only after auth (bad token, malformed body => 401)", async () => {
  const res = await reqTo(authedPort, "POST", "/backup", {
    headers: { "content-type": "application/json", authorization: "Bearer not-a-stub-token" },
    body: "{ broken",
  });
  // requireGoogle's verify rejects the bogus token (401) before the body parser
  // would have 400'd the malformed JSON.
  assert.equal(res.status, 401, `expected 401 (verify fails before parse), got ${res.status}`);
});

// ---- ISSUE 6: the DB-name segment is encoded consistently across create &
//      read/write paths (a special-char BACKUP_DB created at one URL, written at
//      another, would 404 every backup forever) ----
test("ISSUE 6: a special-char BACKUP_DB is created and written at the SAME encoded URL", async () => {
  // `+` is a legal CouchDB database-name character that encodeURIComponent maps
  // to %2B. Before the fix, ensureBackupDb encoded the name (PUT /stag%2Bbackups)
  // while docPath used it raw (PUT /stag+backups/<sub>), so the write 404'd
  // against a different db than the one created.
  const rawDb = "stag+backups";
  const encodedSegment = encodeURIComponent(rawDb); // "stag%2Bbackups"
  assert.notEqual(encodedSegment, rawDb, "test premise: this db name must need encoding");

  const fake = new FakeCouch(encodedSegment);
  await fake.listen();
  const be = await spawnBackend({ couchUrl: fake.url, backupDb: rawDb });
  try {
    // Startup self-provisions the db — give it a beat, then write.
    await new Promise((r) => setTimeout(r, 400));
    const res = await reqTo(be.port, "POST", "/backup", {
      headers: { "content-type": "application/json", authorization: "Bearer stub:user-enc" },
      body: JSON.stringify({ blob: "ciphertext", rev: null }),
    });
    assert.equal(res.status, 200, `expected 200 store, got ${res.status}: ${res.body}`);

    // The create PUT and the doc-write PUT must target the SAME (encoded) db URL.
    const createReq = fake.requests.find(
      (r) => r.method === "PUT" && r.url === `/${encodedSegment}`
    );
    const writeReq = fake.requests.find(
      (r) => r.method === "PUT" && r.url.startsWith(`/${encodedSegment}/`)
    );
    assert.ok(createReq, `expected a create PUT at /${encodedSegment}; saw ${JSON.stringify(fake.requests)}`);
    assert.ok(writeReq, `expected a doc-write PUT under /${encodedSegment}/; saw ${JSON.stringify(fake.requests)}`);

    // And nothing should have hit the RAW, unencoded path — the original bug.
    const rawHit = fake.requests.some(
      (r) => r.url === `/${rawDb}` || r.url.startsWith(`/${rawDb}/`)
    );
    assert.ok(!rawHit, `no request should target the raw db path /${rawDb}; saw ${JSON.stringify(fake.requests)}`);
  } finally {
    be.kill();
    await fake.close();
  }
});

// ---- ISSUE 7: concurrent self-heals coalesce onto ONE ensureBackupDb loop ----
test("ISSUE 7: a burst of POSTs during a missing-db window triggers only ONE create loop", async () => {
  const fake = new FakeCouch();
  // The db starts missing AND the doc write keeps 404-ing, so every POST in the
  // burst hits the self-heal path. A delay on the create PUT holds the missing-db
  // window open long enough for all the POSTs to pile up concurrently — if the
  // in-flight guard were absent, each would fire its own create loop.
  fake.dbExists = false;
  fake.failDocWriteWith404 = true;
  fake.createDbDelayMs = 300;
  await fake.listen();

  const be = await spawnBackend({ couchUrl: fake.url, backupDb: BACKUP_DB });
  try {
    // Let the startup ensureBackupDb fire (and stall on the delayed create PUT),
    // then snapshot the create-PUT count so far so the assertion measures only
    // the burst's effect.
    await new Promise((r) => setTimeout(r, 50));
    const createsBefore = fake.requests.filter(
      (r) => r.method === "PUT" && r.url === `/${BACKUP_DB}`
    ).length;

    // Fire several POSTs at once. Each gets a 404 on the doc write and calls
    // ensureBackupDb(); with the guard they coalesce onto the single in-flight
    // loop, so they add AT MOST one new create PUT between them.
    const burst = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        reqTo(be.port, "POST", "/backup", {
          headers: {
            "content-type": "application/json",
            authorization: `Bearer stub:burst-${i}`,
          },
          body: JSON.stringify({ blob: "ciphertext", rev: null }),
        })
      )
    );
    // Every POST should still get the 503 self-heal response (db is missing).
    for (const r of burst) {
      assert.equal(r.status, 503, `expected 503 during missing-db window, got ${r.status}: ${r.body}`);
    }

    // Wait for any in-flight create loop(s) to settle.
    await new Promise((r) => setTimeout(r, 600));
    const createsAfter = fake.requests.filter(
      (r) => r.method === "PUT" && r.url === `/${BACKUP_DB}`
    ).length;

    const createsFromBurst = createsAfter - createsBefore;
    assert.ok(
      createsFromBurst <= 1,
      `a 6-POST burst should coalesce onto one self-heal loop (<=1 create PUT), saw ${createsFromBurst}`
    );
  } finally {
    be.kill();
    await fake.close();
  }
});
