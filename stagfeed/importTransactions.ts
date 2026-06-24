/**
 * Step 2 — headless transaction importer (offline, file-based).
 *
 * Decrypt a Stag backup blob, merge stag-feed's transactions.csv into it via the
 * shared Stag helpers, re-encrypt, and write a NEW blob file. This is the real
 * merge path minus the live CouchDB I/O (that's step 4): here the "doc" is just a
 * file on disk, so the merge logic can be proven against a real blob with zero
 * risk to anything live.
 *
 *   STAG_BLOB=/abs/backup.enc \
 *   STAG_CSV=/abs/transactions.csv \
 *   STAG_OUT=/abs/backup.merged.enc \
 *   STAG_PASS=... \
 *   npx vite-node stagfeed/importTransactions.ts
 *
 * Reuses Stag's own parseCSV / applyCategories / detectDuplicates (via
 * backupMerge) and CryptoService, so the headless path can't drift from the app.
 * Runs under vite-node (the import chain transitively pulls React-importing
 * modules; vite-node resolves them, esbuild strips types — no @types/node needed
 * to run, though `npm run feed:check` will want them later).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import process from 'node:process';

import { decrypt, encrypt, EncryptedBackup } from '../src/services/encryption/CryptoService';
import { applyTransactions, MergeBlob } from '../src/services/backupMerge';
import { jsonDateReplacer } from '../src/utils/formatters';
import { csvToTransactions } from './csvToTransactions';

// Re-exported so callers (and the test) can pull the shared parser through this
// module. The implementation lives in csvToTransactions.ts so both importers stay
// in lockstep — see that file's header for why it must be side-effect-free.
export { csvToTransactions };

const MAX_BACKUP_SIZE = 5 * 1024 * 1024; // mirror the browser / backend cap

/**
 * Serialize the plaintext blob exactly as every in-app backup path does — with
 * `jsonDateReplacer`, so date-only Date values emit local 'YYYY-MM-DD' instead of
 * the default UTC toISOString(). Without this, a Date built at local-midnight on a
 * UTC+ runner serializes a day earlier and reloads on the wrong day/budget month
 * for UTC/US/India browsers (issue #73). Both headless importers re-encrypt
 * through this single helper so they can't drift from the browser.
 */
export function serializeBlob(blob: MergeBlob): string {
    return JSON.stringify(blob, jsonDateReplacer);
}

function env(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
}

async function run(): Promise<void> {
    const pass = env('STAG_PASS');
    const blobPath = env('STAG_BLOB');
    const csvPath = env('STAG_CSV');
    const outPath = env('STAG_OUT');

    // 1. decrypt the blob to a plain FullBackup object
    const envelope: EncryptedBackup = JSON.parse(readFileSync(blobPath, 'utf8'));
    const blob: MergeBlob = JSON.parse(await decrypt(envelope, pass));

    // 2. build Transactions from the feed CSV and merge (exact id-dedup)
    const incoming = csvToTransactions(readFileSync(csvPath, 'utf8'));
    const report = applyTransactions(blob, incoming, { dedup: 'id' });
    blob.version = 2;

    // 3. re-encrypt, enforce the size cap, write the new blob file
    const reEncrypted = JSON.stringify(await encrypt(serializeBlob(blob), pass));
    const size = Buffer.byteLength(reEncrypted, 'utf8');
    if (size > MAX_BACKUP_SIZE) {
        throw new Error(`Encrypted blob is ${(size / 1024 / 1024).toFixed(2)} MB; exceeds 5 MB cap — refusing to write.`);
    }
    writeFileSync(outPath, reEncrypted);

    console.log('transaction merge:', report);
    console.log(`wrote ${outPath} (${(size / 1024).toFixed(1)} KB)`);
}

// Skip the live run when imported by the test runner; vitest sets VITEST.
if (!process.env.VITEST) {
    run().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}
