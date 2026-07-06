/**
 * Test-only preload (`node --require`): replaces google-auth-library's
 * OAuth2Client.verifyIdToken with a stub so the authed /backup flow is
 * reachable without a real Google ID token. Loaded ONLY by the test harness;
 * never referenced by production code.
 *
 * A bearer token of the form "stub:<sub>" resolves to that `sub`; the form
 * "stub:<sub>|<email>" also sets a verified `email` claim (used by the
 * allow-list tests). Anything else rejects, mirroring a verification failure.
 */
const mod = require("google-auth-library");
const proto = mod.OAuth2Client && mod.OAuth2Client.prototype;
if (proto) {
  proto.verifyIdToken = async function ({ idToken }) {
    const m = /^stub:(.+)$/.exec(idToken || "");
    if (!m) throw new Error("stub: bad token");
    const [sub, email] = m[1].split("|");
    const payload = { sub };
    if (email) payload.email = email;
    return { getPayload: () => payload };
  };
}
