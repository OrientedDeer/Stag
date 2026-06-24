/**
 * Step 4 — live CouchDB importer for stag-feed.
 *
 * The production entry. GET the per-user backup doc → decrypt → merge stag-feed's
 * transactions.csv + balances.csv via Stag's shared helpers (the SAME logic proven
 * offline in importTransactions.ts / importBalances.ts) → re-encrypt → PUT back
 * with `_rev`, retrying on 409. Only the blob I/O changes (file → CouchDB); the
 * merge math is reused verbatim so the headless path can't drift from the browser.
 *
 * Schema note (verified against the live deployment, NOT the prefixed id some docs
 * assume): the doc `_id` is the literal id this backend stores (the Google `sub`),
 * and the doc shape is { _id, _rev, blob, size, timestamp }. We update blob/size/
 * timestamp (so the app's next GET sees fresh metadata) and preserve everything
 * else via spread.
 *
 *   STAG_PASS=...                 backup passphrase (decrypts the blob)
 *   COUCHDB_URL=http://couchdb:5984
 *   COUCHDB_USER=... COUCHDB_PASSWORD=...
 *   BACKUP_DB=stag_backups
 *   STAG_USER_DOC_ID=<the per-user doc id>
 *   STAG_TX_CSV=/abs/out/transactions.csv   (optional)
 *   STAG_BAL_CSV=/abs/out/balances.csv      (optional)
 *   STAG_WRITE=1                  actually PUT (DEFAULT: dry-run, no write)
 *
 *   npx vite-node stagfeed/couchImport.ts
 */
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import process from 'node:process';

import { decrypt, encrypt, EncryptedBackup } from '../src/services/encryption/CryptoService';
import { parseBalancesCSV } from '../src/services/simplefinBalances';
import { applyTransactions, applyBalances, BalanceMergeReport, MergeBlob } from '../src/services/backupMerge';
import { jsonDateReplacer } from '../src/utils/formatters';
import { csvToTransactions } from './csvToTransactions';

// Re-exported so the test can pull the shared parser through this module too. The
// implementation lives in csvToTransactions.ts so both importers stay in lockstep
// — see that file's header for why it must be side-effect-free.
export { csvToTransactions };

const MAX_BACKUP_SIZE = 5 * 1024 * 1024; // mirror the browser / backend cap

// Opt-in: the detailed dumps (account names, balances, SimpleFIN keys, the
// per-user doc id) are sensitive and would otherwise land in journald/cron-mail/CI
// logs in cleartext — contradicting the zero-knowledge posture. Default to counts
// + flag-reason breakdown only; STAG_VERBOSE=1 to surface detail when debugging.
const VERBOSE = process.env.STAG_VERBOSE === '1';

/** Tally flag reasons into a non-sensitive count map (drops the account keys). */
export function flagReasonCounts(flagged: BalanceMergeReport['flagged']): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const f of flagged) counts[f.reason] = (counts[f.reason] ?? 0) + 1;
    return counts;
}

/**
 * Serialize the plaintext blob exactly as every in-app backup path does — with
 * `jsonDateReplacer`, so date-only Date values emit local 'YYYY-MM-DD' instead of
 * the default UTC toISOString(). Without this, transaction dates built at
 * local-midnight on a UTC+ runner round-trip a day earlier for browsers whose UTC
 * offset is more negative than the runner's (issue #73). Mirrors the file-based
 * importer so the nightly Couch path can't drift from the browser.
 */
export function serializeBlob(blob: MergeBlob): string {
    return JSON.stringify(blob, jsonDateReplacer);
}

function env(name: string): string {
    const v = process.env[name];
    if (!v) {
        // Under the test runner the module is imported only for its pure helpers
        // (csvToTransactions); the live config/run path never executes, so don't
        // require the CouchDB env vars just to import. vitest sets VITEST.
        if (process.env.VITEST) return '';
        throw new Error(`Missing required env var: ${name}`);
    }
    return v;
}
function optEnv(name: string): string | undefined {
    return process.env[name] || undefined;
}

// --- config ---
const PASS = env('STAG_PASS');
const COUCH = env('COUCHDB_URL').replace(/\/$/, '');
const DB = env('BACKUP_DB');
const DOC_ID = env('STAG_USER_DOC_ID');
const COUCH_AUTH = 'Basic ' + Buffer.from(`${env('COUCHDB_USER')}:${env('COUCHDB_PASSWORD')}`).toString('base64');
const WRITE = process.env.STAG_WRITE === '1';

interface CouchDoc {
    _id: string;
    _rev: string;
    blob: string;
    size?: number;
    timestamp?: string;
    [k: string]: unknown; // preserve any other fields verbatim on write
}

// --- CouchDB I/O ---
async function getDoc(): Promise<CouchDoc | null> {
    const res = await fetch(`${COUCH}/${DB}/${encodeURIComponent(DOC_ID)}`, {
        headers: { Authorization: COUCH_AUTH },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`CouchDB GET ${res.status}: ${await res.text()}`);
    return (await res.json()) as CouchDoc;
}

async function putDoc(doc: CouchDoc): Promise<{ conflict: boolean; rev?: string }> {
    const res = await fetch(`${COUCH}/${DB}/${encodeURIComponent(DOC_ID)}`, {
        method: 'PUT',
        headers: { Authorization: COUCH_AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
    });
    if (res.status === 409) return { conflict: true };
    if (!res.ok) throw new Error(`CouchDB PUT ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { rev: string };
    return { conflict: false, rev: j.rev };
}

/**
 * Advance the Budget tab's "Last import" indicator. OverviewTab.tsx shows the
 * newest savedCSVFormats[].lastUsed; only the browser import flow normally
 * bumps it, so the headless feed would leave it frozen. Touch the most-recent
 * saved format so the indicator tracks the nightly run.
 */
function bumpLastImport(blob: MergeBlob): void {
    const formats = blob.budget?.importSettings?.savedCSVFormats;
    if (!formats?.length) {
        console.warn('  NOTE: no saved CSV formats — "Last import" cannot advance (seed it with one in-app import).');
        return;
    }
    const newest = formats.reduce((a, b) =>
        new Date(b.lastUsed).getTime() > new Date(a.lastUsed).getTime() ? b : a);
    newest.lastUsed = new Date();
    // The saved-format name is a user-chosen label — keep it out of routine logs.
    console.log(VERBOSE ? `  bumped "Last import" via saved format "${newest.name}"` : '  bumped "Last import"');
}

/** One full attempt: GET → decrypt → merge → re-encrypt → PUT. Returns false on 409 (retry). */
async function mergeOnce(): Promise<boolean> {
    const doc = await getDoc();
    if (!doc) {
        throw new Error(
            `No backup doc "${DOC_ID}" in "${DB}". The browser creates it lazily on first cloud save — ` +
                `save once in the app first. stag-feed will not create the doc itself.`,
        );
    }

    const envelope: EncryptedBackup = JSON.parse(doc.blob);
    const blob: MergeBlob = JSON.parse(await decrypt(envelope, PASS));

    const txCsv = optEnv('STAG_TX_CSV');
    const balCsv = optEnv('STAG_BAL_CSV');
    if (!txCsv && !balCsv) throw new Error('Nothing to merge: set STAG_TX_CSV and/or STAG_BAL_CSV.');

    if (txCsv) {
        const report = applyTransactions(blob, csvToTransactions(readFileSync(txCsv, 'utf8')), { dedup: 'id' });
        console.log('transactions:', report);
    }
    if (balCsv) {
        const parsed = parseBalancesCSV(readFileSync(balCsv, 'utf8'));
        for (const e of parsed.errors) console.warn('  balances.csv:', e);
        if (Object.keys(blob.balanceAccountMap ?? {}).length === 0) {
            console.warn('  NOTE: balanceAccountMap is empty — rows rely on name auto-match.');
        }
        const report = applyBalances(blob, parsed.rows.map((r) => ({ account: r.account, balance: r.balance })));
        // Counts + flag-reason breakdown only (no account names, balances, or keys).
        console.log(`balances: updated ${report.updated.length}`);
        if (report.flagged.length) console.log(`  flagged ${report.flagged.length}:`, flagReasonCounts(report.flagged));
        if (VERBOSE) {
            console.log('  [verbose] updated:', report.updated);
            if (report.flagged.length) console.log('  [verbose] flagged:', report.flagged);
        }
    }
    bumpLastImport(blob);
    blob.version = 2;

    const reEncrypted = JSON.stringify(await encrypt(serializeBlob(blob), PASS));
    const size = Buffer.byteLength(reEncrypted, 'utf8');
    if (size > MAX_BACKUP_SIZE) {
        throw new Error(`Encrypted blob ${(size / 1048576).toFixed(2)} MB exceeds 5 MB cap — refusing to write.`);
    }

    // The doc id is the per-user Google `sub` — keep it out of routine logs.
    const docLabel = VERBOSE ? DOC_ID : 'user doc';
    if (!WRITE) {
        console.log(`[dry-run] merge OK; would PUT ${docLabel} (${(size / 1024).toFixed(1)} KB). Set STAG_WRITE=1 to commit.`);
        return true;
    }

    const updated: CouchDoc = { ...doc, blob: reEncrypted, size, timestamp: new Date().toISOString() };
    const put = await putDoc(updated);
    if (put.conflict) {
        console.warn('  409 conflict (someone wrote since our GET) — re-reading and retrying…');
        return false;
    }
    console.log(`wrote ${docLabel} → rev ${put.rev} (${(size / 1024).toFixed(1)} KB)`);
    return true;
}

async function run(): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (await mergeOnce()) return;
        await new Promise((r) => setTimeout(r, 250 * attempt)); // backoff, then re-GET
    }
    throw new Error('Gave up after repeated 409 conflicts.');
}

// Skip the live run when imported by the test runner; vitest sets VITEST.
if (!process.env.VITEST) {
    run().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}
