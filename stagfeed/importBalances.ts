/**
 * Step 3 — headless balance importer (offline, file-based).
 *
 * Decrypt a Stag backup blob, apply stag-feed's balances.csv via the shared
 * `applyBalances` helper, re-encrypt, write a NEW blob file. Mirrors the in-app
 * ImportBalancesModal: each row sets account.amount AND appends an amountHistory
 * snapshot; mapping comes from the blob's `balanceAccountMap` (v2), falling back
 * to name auto-match; 1→many maps split by current-balance weight.
 *
 *   STAG_BLOB=/abs/backup.enc \
 *   STAG_CSV=/abs/balances.csv \
 *   STAG_OUT=/abs/backup.merged.enc \
 *   STAG_PASS=... \
 *   npx vite-node stagfeed/importBalances.ts
 *
 * Live CouchDB I/O is the later step; here the "doc" is a file on disk.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import process from 'node:process';

import { decrypt, encrypt, EncryptedBackup } from '../src/services/encryption/CryptoService';
import { parseBalancesCSV } from '../src/services/simplefinBalances';
import { applyBalances, MergeBlob } from '../src/services/backupMerge';

const MAX_BACKUP_SIZE = 5 * 1024 * 1024; // mirror the browser / backend cap

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

    // 2. parse stag-feed's balances.csv (latest snapshot per account) and apply
    const parsed = parseBalancesCSV(readFileSync(csvPath, 'utf8'));
    for (const err of parsed.errors) console.warn('  balances.csv:', err);
    const rows = parsed.rows.map((r) => ({ account: r.account, balance: r.balance }));

    const mapEntries = Object.keys(blob.balanceAccountMap ?? {}).length;
    if (mapEntries === 0) {
        console.warn('  NOTE: balanceAccountMap is empty — every row relies on name auto-match.');
    }
    const report = applyBalances(blob, rows /*, { date }*/);
    blob.version = 2;

    // 3. re-encrypt, enforce the size cap, write the new blob file
    const reEncrypted = JSON.stringify(await encrypt(JSON.stringify(blob), pass));
    const size = Buffer.byteLength(reEncrypted, 'utf8');
    if (size > MAX_BACKUP_SIZE) {
        throw new Error(`Encrypted blob is ${(size / 1024 / 1024).toFixed(2)} MB; exceeds 5 MB cap — refusing to write.`);
    }
    writeFileSync(outPath, reEncrypted);

    console.log(`updated ${report.updated.length} account(s):`, report.updated);
    if (report.flagged.length) console.log('flagged:', report.flagged);
    console.log(`wrote ${outPath} (${(size / 1024).toFixed(1)} KB)`);
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
