/**
 * Template headless entry for stag-feed — the end-to-end skeleton.
 *   npm run feed:example   (vite-node stagfeed/example.ts)
 *
 * Replace the TODOs with real SimpleFIN fetch + CouchDB `_rev` I/O. This file is
 * a wiring reference, not production: it shows how the shared Stag helpers compose
 * (decrypt → merge → re-encrypt) so the headless path matches the in-app path.
 */

import { decrypt, encrypt, EncryptedBackup } from '../src/services/encryption/CryptoService';
import {
    applyTransactions,
    applyBalances,
    makeTransaction,
    MergeBlob,
} from '../src/services/backupMerge';
import { serializeBlob } from './importShared';

const MAX_BACKUP_SIZE = 5 * 1024 * 1024; // mirror the browser / backend cap

async function run(): Promise<void> {
    // --- secrets (TODO: load from your secret store, never hard-code) ---
    const passphrase = process_env('STAG_BACKUP_PASSPHRASE');

    // --- 1. read the encrypted doc from CouchDB (TODO) ---
    // GET the single per-user doc; capture `_rev` for the optimistic-locking write.
    const docBlobString = ''; // TODO: doc.blob (the encrypted envelope string)
    const rev = '';           // TODO: doc._rev
    void rev;

    // --- 2. decrypt to a plain FullBackup object ---
    const envelope: EncryptedBackup = JSON.parse(docBlobString);
    const plaintext = await decrypt(envelope, passphrase);
    const blob: MergeBlob = JSON.parse(plaintext);

    // --- 3. merge new SimpleFIN data (TODO: build these from the real fetch) ---
    const transactions = [
        makeTransaction({ id: 'sf-1', date: '2026-06-03', amount: -9.99, description: 'COFFEE' }),
    ];
    const txReport = applyTransactions(blob, transactions, { dedup: 'id' });
    const balReport = applyBalances(blob, [
        { account: 'Checking Account (1234)', balance: 4242.42 },
    ]);
    blob.version = 2;

    // --- 4. re-encrypt and guard the size cap ---
    // Serialize through the same shared `serializeBlob` the production importers
    // use, so date-only Date values emit local 'YYYY-MM-DD' instead of the default
    // UTC toISOString(). A bare JSON.stringify(blob) shifts every transaction date a
    // day earlier on a UTC+ runner — issue #73 — which would make this reference
    // contradict the in-app path it claims to mirror.
    const updatedPlaintext = serializeBlob(blob);
    const reEncrypted = JSON.stringify(await encrypt(updatedPlaintext, passphrase));
    if (new Blob([reEncrypted]).size > MAX_BACKUP_SIZE) {
        throw new Error('Encrypted blob exceeds 5 MB; refusing to write.');
    }

    // --- 5. write back to CouchDB with `_rev`, retry on 409 (TODO) ---
    // PUT { ...doc, blob: reEncrypted, _rev } ; on 409 re-read and redo from step 2.

    console.log('transactions:', txReport);
    console.log('balances:', balReport);
}

// Tiny env reader so this template typechecks without @types/node. Replace with
// `process.env[name]` once you add @types/node for the real fs/CouchDB wiring.
function process_env(name: string): string {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const value = env?.[name];
    if (!value) throw new Error(`Missing required secret: ${name}`);
    return value;
}

run().catch((err) => {
    console.error(err);
    // process.exitCode = 1;  (set once @types/node is added)
});
