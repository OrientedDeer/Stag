/**
 * IndexedDB cache for the completed Monte Carlo results summary (#204). The
 * config is already persisted to localStorage, and the #98 policy cache makes a
 * re-run fast, but neither RESTORES the finished summary — so a hard refresh
 * always lands the Risk tab back on "No simulation data". This cache stores the
 * last summary keyed on everything that affects the run, so a refresh that
 * changed nothing can re-display the results without re-running.
 *
 * Modeled on policyCache.ts: separate DB (a new store here would force a version
 * bump/migration on the policy DB), FNV-hashed short primary key with a full-key
 * recheck against collisions, LRU prune, and best-effort — ANY IndexedDB failure
 * (private mode, quota, no support) degrades silently to "no restore".
 *
 * Like policyCache, this is DERIVED, local-only performance state: it is
 * intentionally NOT part of the JSON/QR backup (fully recomputable from the
 * inputs, and far too large to ride a QR code).
 *
 * Structured-clone note: MonteCarloSummary's representative timelines carry
 * AnyAccount/Income/Expense CLASS instances; structured clone preserves their
 * data (incl. Date fields and the own `className` property) but strips the
 * prototype. That is the same loss the worker→main postMessage already incurs,
 * so the reader reconstitutes with the existing `reconstituteSummary` before use
 * — no JSON-safe projection is needed.
 */
import type { MonteCarloConfig, MonteCarloSummary } from './MonteCarloTypes';
import { getSimulationInputHash } from './simulationHash';
import type { AnyAccount } from '../components/Objects/Accounts/models';
import type { AnyIncome } from '../components/Objects/Income/models';
import type { AnyExpense } from '../components/Objects/Expense/models';
import type { AssumptionsState } from '../components/Objects/Assumptions/AssumptionsContext';
import type { TaxState } from '../components/Objects/Taxes/TaxContext';

const DB_NAME = 'stag-mc-summary';
const STORE = 'summaries';
const DB_VERSION = 1;
/** Keep only the latest handful of distinct summaries; older ones are LRU-pruned. */
const MAX_ENTRIES = 2;

/**
 * Derive the cache key for a completed run. The summary is a deterministic
 * function of the simulation inputs + the config fields that steer the run, so
 * the key hashes exactly those:
 *  - `getSimulationInputHash` covers accounts/incomes/expenses/assumptions/taxes.
 *  - The MC config contributes only the fields that CHANGE the output:
 *      returnMean/returnStdDev (rounded to 4dp to absorb float noise, matching
 *      the #130 policy-key rounding), numScenarios, seed, and compareToBaseline.
 *    Excluded: `enabled` (UI mode gate — doesn't change a run), `preset` (UI
 *    tracking only; the resolved returnMean/StdDev are what drive the run), and
 *    the `last*` inflation/ROR tracking fields (transient bookkeeping for the
 *    Tab's auto-sync effect — they never affect the run's result).
 *
 * Seed: the run consumes `config.seed` verbatim (handleRun never mints a fresh
 * seed — only the explicit "New" button does, via generateNewSeed), and that
 * config is persisted to localStorage, so a reload reads back the SAME seed the
 * cached run used. Keying on config.seed is therefore correct.
 */
export function mcSummaryCacheKey(
    config: MonteCarloConfig,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
): string {
    return JSON.stringify({
        // Engine-behavior version: the key otherwise hashes INPUTS only, so an
        // engine change that alters MC results (return draws, policy, tax law,
        // valuation ruler) would replay a stale summary. Bump this on any such
        // change so old IndexedDB entries miss.
        v: 'v1-204',
        inputHash: getSimulationInputHash(accounts, incomes, expenses, assumptions, taxState),
        rm: Number(config.returnMean.toFixed(4)),
        rs: Number(config.returnStdDev.toFixed(4)),
        n: config.numScenarios,
        seed: config.seed,
        cmp: config.compareToBaseline ?? false,
        // Current year: results depend on today's age/horizon, so a restore
        // across a year boundary should miss (matches policyCache's `y`).
        y: new Date().getFullYear(),
    });
}

/** FNV-1a 32-bit hash (+ length) → short, stable primary key for a long cache key. */
function hashKey(str: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16) + '-' + str.length.toString(16);
}

interface CacheRecord {
    /** FNV hash of `key` — the object-store primary key. */
    hash: string;
    /** Full cache key, re-checked on read so a hash collision can't serve a wrong summary. */
    key: string;
    summary: MonteCarloSummary;
    storedAt: number;
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'hash' });
                store.createIndex('storedAt', 'storedAt');
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    });
}

/** Return the cached summary for `fullKey`, or null on miss / any failure. */
export async function getCachedSummary(fullKey: string): Promise<MonteCarloSummary | null> {
    if (typeof indexedDB === 'undefined') return null;
    try {
        const db = await openDB();
        const rec = await new Promise<CacheRecord | undefined>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const r = tx.objectStore(STORE).get(hashKey(fullKey));
            r.onsuccess = () => resolve(r.result as CacheRecord | undefined);
            r.onerror = () => reject(r.error);
        });
        db.close();
        // Verify the full key (guards against the rare hash collision).
        if (rec && rec.key === fullKey) return rec.summary;
        return null;
    } catch {
        return null;
    }
}

/** Store `summary` under `fullKey` and prune to MAX_ENTRIES. Best-effort. */
export async function putCachedSummary(fullKey: string, summary: MonteCarloSummary): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
        const db = await openDB();
        const rec: CacheRecord = {
            hash: hashKey(fullKey),
            key: fullKey,
            summary,
            storedAt: Date.now(),
        };
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(rec);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        await prune(db);
        db.close();
    } catch {
        // Best-effort cache; ignore write failures.
    }
}

/** Delete the oldest entries beyond MAX_ENTRIES (ascending storedAt = oldest first). */
function prune(db: IDBDatabase): Promise<void> {
    return new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const countReq = store.count();
        countReq.onsuccess = () => {
            const excess = countReq.result - MAX_ENTRIES;
            if (excess <= 0) { resolve(); return; }
            let removed = 0;
            const curReq = store.index('storedAt').openCursor();
            curReq.onsuccess = () => {
                const cursor = curReq.result;
                if (cursor && removed < excess) {
                    cursor.delete();
                    removed++;
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            curReq.onerror = () => resolve();
        };
        countReq.onerror = () => resolve();
    });
}
