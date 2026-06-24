/**
 * Shared stag-feed importer helpers.
 *
 * The two headless importers (importBalances.ts, the file-based balance path, and
 * couchImport.ts, the live CouchDB path) and the example template each need the
 * same small set of pure helpers: a non-sensitive flag tally, the verbose-logging
 * flag, and the one canonical blob serializer. Hosting them here keeps a single
 * implementation so the paths can't drift.
 *
 * CRITICAL: keep this module free of TOP-LEVEL SIDE EFFECTS. importTransactions.ts
 * and couchImport.ts each fire a live run() at import time under vite-node; they're
 * imported by the test runner only for their pure helpers, so the shared logic must
 * NOT live in either of them and must NOT import them. Importing this file must do
 * nothing but define functions. (Mirrors csvToTransactions.ts.)
 */
import process from 'node:process';

import type { BalanceMergeReport, MergeBlob } from '../src/services/backupMerge';
import { jsonDateReplacer } from '../src/utils/formatters';

/**
 * Backup size cap, mirroring the browser / backend write guard. Declared once here
 * so every headless importer enforces the identical numeric limit (5 MB) — the cap
 * and its over-size error string had already drifted across the four importers.
 */
export const MAX_BACKUP_SIZE = 5 * 1024 * 1024;

/**
 * Required-env-var reader: returns the value or throws a uniform "Missing required
 * env var" error. Shared so all importers reject a missing var identically (instead
 * of re-declaring the same helper three times). Under the test runner the live
 * config/run path never executes — modules are imported only for their pure
 * helpers — so return '' rather than throwing when vitest sets VITEST, matching the
 * prior couchImport behavior that let the module import without CouchDB env vars.
 */
export function env(name: string): string {
    const v = process.env[name];
    if (!v) {
        if (process.env.VITEST) return '';
        throw new Error(`Missing required env var: ${name}`);
    }
    return v;
}

/**
 * Whether the importers should surface sensitive detail (account names, balances,
 * SimpleFIN keys, the per-user doc id) in their logs. Opt-in via STAG_VERBOSE=1;
 * default off so those values don't land in journald/cron-mail/CI logs in cleartext
 * — contradicting the zero-knowledge posture. Read once at module load by each
 * importer (the live config is fixed for a run), matching the prior inline const.
 */
export function stagVerbose(): boolean {
    return process.env.STAG_VERBOSE === '1';
}

/** Tally flag reasons into a non-sensitive count map (drops the account keys). */
export function flagReasonCounts(flagged: BalanceMergeReport['flagged']): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const f of flagged) counts[f.reason] = (counts[f.reason] ?? 0) + 1;
    return counts;
}

/**
 * Serialize the plaintext blob exactly as every in-app backup path does — with
 * `jsonDateReplacer`, so date-only Date values emit local 'YYYY-MM-DD' instead of
 * the default UTC toISOString(). Without this, a Date built at local-midnight on a
 * UTC+ runner serializes a day earlier and reloads on the wrong day/budget month
 * for UTC/US/India browsers (issue #73). Every headless importer re-encrypts
 * through this single helper so they can't drift from the browser.
 */
export function serializeBlob(blob: MergeBlob): string {
    return JSON.stringify(blob, jsonDateReplacer);
}
