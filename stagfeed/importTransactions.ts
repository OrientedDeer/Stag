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
import { parseCSV } from '../src/services/CSVImportService';
import { applyTransactions, makeTransaction, MergeBlob } from '../src/services/backupMerge';
import type { Transaction } from '../src/components/Objects/Budget/BudgetTypes';

const MAX_BACKUP_SIZE = 5 * 1024 * 1024; // mirror the browser / backend cap

function env(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
}

/** Locate a column by header name (case-insensitive, trimmed). */
function col(headers: string[], name: string): number {
    return headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
}

/** Parse stag-feed's transactions.csv into Stag Transactions (id = SimpleFIN id). */
function csvToTransactions(csvText: string): Transaction[] {
    const { headers, rows } = parseCSV(csvText);
    const idx = {
        date: col(headers, 'Date'),
        description: col(headers, 'Description'),
        amount: col(headers, 'Amount'),
        id: col(headers, 'Id'),
    };
    for (const [k, v] of Object.entries(idx)) {
        if (v === -1) throw new Error(`transactions.csv is missing the "${k}" column`);
    }

    const out: Transaction[] = [];
    let skipped = 0;
    for (const r of rows) {
        const amount = Number(r[idx.amount]);
        const id = (r[idx.id] ?? '').trim();
        if (!Number.isFinite(amount) || !id) {
            skipped++;
            continue; // a row with no stable id can't be id-deduped — skip & report
        }
        out.push(
            makeTransaction({
                id, // SimpleFIN's stable txn id → exact dedup on re-fetch
                date: r[idx.date].trim(), // 'YYYY-MM-DD' → local-midnight Date in makeTransaction
                description: r[idx.description] ?? '',
                amount,
            }),
        );
    }
    if (skipped) console.warn(`  skipped ${skipped} row(s) with no id / unparseable amount`);
    return out;
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
    const reEncrypted = JSON.stringify(await encrypt(JSON.stringify(blob), pass));
    const size = Buffer.byteLength(reEncrypted, 'utf8');
    if (size > MAX_BACKUP_SIZE) {
        throw new Error(`Encrypted blob is ${(size / 1024 / 1024).toFixed(2)} MB; exceeds 5 MB cap — refusing to write.`);
    }
    writeFileSync(outPath, reEncrypted);

    console.log('transaction merge:', report);
    console.log(`wrote ${outPath} (${(size / 1024).toFixed(1)} KB)`);
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
