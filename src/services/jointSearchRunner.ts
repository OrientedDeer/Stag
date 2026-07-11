/**
 * Main-thread driver for the joint conversion/withdrawal-order search Web
 * Worker (#158). Counterpart to `montecarloRunner.ts`, with two deliberate
 * differences:
 *
 *  1. PERSISTENT worker. MC spins a worker per run; here the worker is kept
 *     alive across requests so the per-order artifact memo cache in its
 *     useSimulation module state survives between recalcs (that cache is the
 *     other half of #158 — a repeat/near-repeat recalc skips the baseline sims
 *     and the DP solve).
 *
 *  2. SUPERSEDE semantics. The search is synchronous compute inside the worker
 *     — it cannot observe a "cancel" message mid-run — so when a new request
 *     arrives while one is in flight, the worker is TERMINATED (dropping its
 *     memo cache; the fresh worker recomputes) and the old request's promise
 *     rejects with `JointSearchSupersededError`. Callers treat that rejection
 *     as "a newer request owns the UI" — NOT as a worker failure, so it must
 *     not trigger the sync fallback.
 *
 * Staleness contract for callers (FutureTab): reject(JointSearchSupersededError)
 * covers the in-flight-when-replaced case; the resolved-but-inputs-moved-on case
 * (sync fallback finishing after an edit) is the caller's hash check.
 */
import { reconstituteAccount, InvestedAccount, type BrokerageLot } from '../components/Objects/Accounts/models';
import { reconstituteIncome } from '../components/Objects/Income/models';
import { reconstituteExpense } from '../components/Objects/Expense/models';
import type { AnyAccount } from '../components/Objects/Accounts/models';
import type { AnyIncome } from '../components/Objects/Income/models';
import type { AnyExpense } from '../components/Objects/Expense/models';
import type { AssumptionsState } from '../components/Objects/Assumptions/AssumptionsContext';
import type { TaxState } from '../components/Objects/Taxes/TaxContext';
import type { SimulationYear } from './simulation/types';
import type { JointSearchWorkerRequest, JointSearchWorkerResponse } from './jointSearchWorkerTypes';
import { notNull } from '../utils/notNull';

/** Rejection marker for a request replaced by a newer one (see module doc). */
export class JointSearchSupersededError extends Error {
    constructor() {
        super('joint search superseded by a newer request');
        this.name = 'JointSearchSupersededError';
    }
}

/**
 * Rebuild the class instances in a worker-returned timeline (structured clone
 * strips methods). Every year is reconstituted — unlike MC's three
 * representative timelines, the whole projection feeds the UI's `instanceof`
 * checks (charts, withdrawal tab). Same core body as montecarloRunner's
 * private helper; duplicated rather than exported from there to keep this
 * change off the MC-owned files.
 *
 * FIDELITY SHIMS (validated by jointSearchWorkerParity.test.ts, which
 * deep-equals the round trip against the sync path): the reconstitute*
 * functions are persistence-oriented (localStorage/import), so they default
 * or drop two pieces of ENGINE state that timeline rows legitimately carry:
 *   • `reconstituteIncome` coerces a missing `startDate` to `new Date()` —
 *     but engine-carried incomes (e.g. synthetic vest/interest rows, or a
 *     dateless SS income) may genuinely have none; restore `undefined`.
 *   • `reconstituteAccount` omits `InvestedAccount.lots` (the engine-seeded
 *     brokerage cost-basis lot pool, plain {purchaseYear,costBasis,
 *     currentValue} records); reattach it so per-year gains splits derived
 *     from lots don't silently fall back to the blended-ratio path.
 */
export function reconstituteEngineAccount(raw: unknown): AnyAccount | null {
    const rebuilt = reconstituteAccount(raw);
    const rawLots = (raw as { lots?: unknown }).lots;
    if (rebuilt instanceof InvestedAccount && Array.isArray(rawLots)) {
        rebuilt.lots = rawLots as BrokerageLot[];
    }
    return rebuilt;
}

export function reconstituteEngineIncome(raw: unknown): AnyIncome | null {
    const rebuilt = reconstituteIncome(raw);
    if (rebuilt && (raw as { startDate?: unknown }).startDate === undefined) {
        rebuilt.startDate = undefined;
    }
    return rebuilt;
}

export function reconstituteTimeline(timeline: SimulationYear[]): SimulationYear[] {
    return timeline.map(year => ({
        ...year,
        accounts: (year.accounts as unknown[]).map(reconstituteEngineAccount).filter(notNull),
        incomes: (year.incomes as unknown[]).map(reconstituteEngineIncome).filter(notNull),
        expenses: (year.expenses as unknown[]).map(reconstituteExpense).filter(notNull),
    }));
}

export interface JointSearchInput {
    yearsToRun: number;
    accounts: AnyAccount[];
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    assumptions: AssumptionsState;
    taxState: TaxState;
    referenceDate: Date;
    eoyContributionAdditions?: Record<string, number>;
    eoyDebtReductions?: Record<string, number>;
    eoyMortgageReductions?: Record<string, number>;
    onProgress?: (message: string) => void;
}

interface InFlight {
    requestId: number;
    resolve: (timeline: SimulationYear[]) => void;
    reject: (err: Error) => void;
    onProgress?: (message: string) => void;
}

let worker: Worker | null = null;
let inFlight: InFlight | null = null;
let nextRequestId = 1;

/** Build the postMessage payload for a request (shared by both run modes). */
function toWorkerRequest(input: JointSearchInput, requestId: number): JointSearchWorkerRequest {
    return {
        requestId,
        yearsToRun: input.yearsToRun,
        accounts: input.accounts as unknown[],
        incomes: input.incomes as unknown[],
        expenses: input.expenses as unknown[],
        assumptions: input.assumptions,
        taxState: input.taxState,
        referenceDate: input.referenceDate,
        eoyContributionAdditions: input.eoyContributionAdditions,
        eoyDebtReductions: input.eoyDebtReductions,
        eoyMortgageReductions: input.eoyMortgageReductions,
    };
}

function dropWorker(): void {
    worker?.terminate();
    worker = null;
}

function handleMessage(e: MessageEvent<JointSearchWorkerResponse>): void {
    const msg = e.data;
    // A terminated worker can't deliver messages, so a mismatched id should be
    // unreachable — but pairing on requestId keeps staleness explicit and free.
    if (!inFlight || msg.requestId !== inFlight.requestId) return;
    if (msg.type === 'progress') {
        inFlight.onProgress?.(msg.message);
        return;
    }
    const settled = inFlight;
    inFlight = null;
    if (msg.type === 'done') {
        // Keep the worker alive: its module-state artifact cache makes the next
        // (repeat/near-repeat) request cheap. Reconstitution can throw — reject
        // rather than leaving the promise (and the UI spinner) hanging.
        try {
            settled.resolve(reconstituteTimeline(msg.timeline));
        } catch (err) {
            settled.reject(err instanceof Error ? err : new Error(String(err)));
        }
    } else {
        // Worker-reported failure (reconstitution wipeout, engine throw). Drop
        // the worker so the next request starts clean; the caller falls back to
        // the sync path for THIS one.
        dropWorker();
        settled.reject(new Error(msg.message));
    }
}

function handleError(ev: ErrorEvent): void {
    const settled = inFlight;
    inFlight = null;
    dropWorker();
    settled?.reject(new Error(ev.message || 'joint search worker error'));
}

/**
 * Run the joint search in the Web Worker. Rejects with
 * `JointSearchSupersededError` if a newer request replaces this one, or with
 * an ordinary Error if the worker can't be constructed / fails — the caller
 * should fall back to the synchronous `runSimulationWithOptimization` path
 * for the latter only.
 */
export function runJointSearchInWorker(input: JointSearchInput): Promise<SimulationYear[]> {
    return new Promise<SimulationYear[]>((resolve, reject) => {
        // Supersede any in-flight request: the worker is blocked in synchronous
        // compute and can't be cancelled cooperatively, so terminate it.
        if (inFlight) {
            const old = inFlight;
            inFlight = null;
            dropWorker();
            old.reject(new JointSearchSupersededError());
        }
        if (!worker) {
            if (typeof Worker === 'undefined') {
                reject(new Error('Web Workers unavailable in this environment'));
                return;
            }
            try {
                worker = new Worker(new URL('./jointSearch.worker.ts', import.meta.url), { type: 'module' });
            } catch (e) {
                worker = null;
                reject(e instanceof Error ? e : new Error('joint search worker unavailable'));
                return;
            }
            worker.onmessage = handleMessage;
            worker.onerror = handleError;
        }
        const requestId = nextRequestId++;
        inFlight = { requestId, resolve, reject, onProgress: input.onProgress };
        worker.postMessage(toWorkerRequest(input, requestId));
    });
}

/**
 * Run one joint search in a fresh, single-use worker: spawn → run → terminate
 * (#166, the scenario-comparison "Run Comparison" path). Deliberately NOT
 * routed through the persistent runner above: its supersede semantics are
 * "latest request wins, terminate the in-flight one" — correct for the live
 * projection (only the newest inputs matter) but wrong in BOTH directions for
 * a comparison run, which must always complete: a live recalc landing mid-run
 * would silently cancel the comparison, and the comparison would terminate a
 * live recalc whose caller treats the rejection as "a newer request owns the
 * UI" and never repaints. An ephemeral worker is fully isolated — no shared
 * state, no supersede rules, no contention for the persistent worker's memo
 * cache — and costs nothing when idle. Its memo cache starts cold, which is
 * fine: scenario inputs differ from the live plan's, so there is nothing to
 * reuse anyway.
 *
 * Rejects with an ordinary Error if the worker can't be constructed or the
 * run fails — the caller falls back to the synchronous engine. There is no
 * `JointSearchSupersededError` on this path by design.
 */
export function runJointSearchEphemeral(input: JointSearchInput): Promise<SimulationYear[]> {
    return new Promise<SimulationYear[]>((resolve, reject) => {
        if (typeof Worker === 'undefined') {
            reject(new Error('Web Workers unavailable in this environment'));
            return;
        }
        let ephemeral: Worker;
        try {
            ephemeral = new Worker(new URL('./jointSearch.worker.ts', import.meta.url), { type: 'module' });
        } catch (e) {
            reject(e instanceof Error ? e : new Error('joint search worker unavailable'));
            return;
        }
        const requestId = nextRequestId++;
        const settle = (finish: () => void): void => {
            ephemeral.terminate();
            finish();
        };
        ephemeral.onmessage = (e: MessageEvent<JointSearchWorkerResponse>): void => {
            const msg = e.data;
            if (msg.requestId !== requestId) return;
            if (msg.type === 'progress') {
                input.onProgress?.(msg.message);
                return;
            }
            if (msg.type === 'done') {
                // Reconstitution can throw — reject rather than leaving the
                // promise (and the comparison busy state) hanging.
                try {
                    const timeline = reconstituteTimeline(msg.timeline);
                    settle(() => resolve(timeline));
                } catch (err) {
                    settle(() => reject(err instanceof Error ? err : new Error(String(err))));
                }
            } else {
                settle(() => reject(new Error(msg.message)));
            }
        };
        ephemeral.onerror = (ev: ErrorEvent): void => {
            settle(() => reject(new Error(ev.message || 'joint search worker error')));
        };
        ephemeral.postMessage(toWorkerRequest(input, requestId));
    });
}
