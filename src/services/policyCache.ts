/**
 * IndexedDB cache for the Monte Carlo conversion policy (#98). The ~20s
 * stochastic-DP solve is a deterministic function of its inputs, so a re-run that
 * changes ONLY the seed or scenario count (which don't affect the policy) can
 * reuse the cached policy and skip the solve entirely. Worker-owned and
 * best-effort: any IndexedDB failure (private mode, quota, no support) degrades
 * silently to a recompute.
 *
 * This is DERIVED, local-only performance state — it is intentionally NOT part of
 * the JSON/QR backup (recomputable, and a ~1.3MB blob would break QR). The policy
 * table (Float64Arrays) and the central-schedule Map ride IndexedDB's structured
 * clone losslessly.
 */
import type { McConversionPlan } from './MonteCarloEngine';

const DB_NAME = 'stag-mc-policy';
const STORE = 'policies';
const DB_VERSION = 1;
/** Keep the last N distinct policies; older ones are pruned (LRU by store time). */
const MAX_ENTRIES = 8;

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
    /** Full cache key, re-checked on read so a hash collision can't serve a wrong policy. */
    key: string;
    plan?: Map<number, number>;
    policy: NonNullable<McConversionPlan['policy']>;
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

/** Return the cached plan/policy for `fullKey`, or null on miss / any failure. */
export async function getCachedPlan(fullKey: string): Promise<McConversionPlan | null> {
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
        if (rec && rec.key === fullKey) return { plan: rec.plan, policy: rec.policy };
        return null;
    } catch {
        return null;
    }
}

/** Store the plan/policy under `fullKey` and prune to MAX_ENTRIES. No-op without a policy. */
export async function putCachedPlan(fullKey: string, plan: McConversionPlan): Promise<void> {
    if (typeof indexedDB === 'undefined' || !plan.policy) return;
    try {
        const db = await openDB();
        const rec: CacheRecord = {
            hash: hashKey(fullKey),
            key: fullKey,
            plan: plan.plan,
            policy: plan.policy,
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
