/**
 * Joint conversion/withdrawal-order search Web Worker (#158). Runs the entire
 * `runSimulationWithOptimization` joint search — the std-ded baseline sim, the
 * F5a DP solve, and every candidate order's engine-direct search — off the main
 * thread, so a debounced what-if no longer freezes the UI for multiple seconds.
 * Mirrors the Monte Carlo worker (`montecarlo.worker.ts`): the compute graph is
 * React-free at runtime, class instances arrive as plain objects (structured
 * clone strips methods) and are reconstituted via the `className` discriminator
 * before the run, and the resulting timeline is posted back for the driver to
 * re-reconstitute (`jointSearchRunner.reconstituteTimeline`).
 *
 * The #158 per-order artifact memo cache lives in module state inside
 * useSimulation.tsx — i.e. in THIS worker's module registry. The driver keeps
 * the worker alive across requests precisely so that cache survives between
 * recalcs; terminating the worker (supersede/error) drops it, and the next run
 * recomputes.
 */
// MUST stay the first import — see workerWindowShim doc (dev react-refresh
// preamble references `window`; without the shim this worker dies at load and
// every recalc silently falls back to the main-thread sync path).
import './workerWindowShim';
import { runSimulationWithOptimization } from '../components/Objects/Assumptions/useSimulation';
import { reconstituteExpense } from '../components/Objects/Expense/models';
// Engine-faithful reconstitution (persistence reconstitutors + the fidelity
// shims for engine-carried state — see jointSearchRunner doc). Importing the
// runner here is safe: it only touches `Worker` inside a function this worker
// never calls.
import { reconstituteEngineAccount, reconstituteEngineIncome } from './jointSearchRunner';
import type { JointSearchWorkerRequest, JointSearchWorkerResponse } from './jointSearchWorkerTypes';
import { notNull } from '../utils/notNull';

const post = (msg: JointSearchWorkerResponse): void =>
    (self as unknown as { postMessage: (m: JointSearchWorkerResponse) => void }).postMessage(msg);

/**
 * Handle one search request. Exported for the parity test, which invokes it
 * directly (vitest can't run real web workers) with a stubbed `postMsg` — the
 * same way the MC worker's reconstitution logic is exercised in
 * montecarloWorkerGuard.test.ts (via the shared reconstitute functions).
 */
export function handleJointSearchRequest(
    req: JointSearchWorkerRequest,
    postMsg: (msg: JointSearchWorkerResponse) => void,
): void {
    try {
        const accounts = req.accounts.map(reconstituteEngineAccount).filter(notNull);
        const incomes = req.incomes.map(reconstituteEngineIncome).filter(notNull);
        const expenses = req.expenses.map(reconstituteExpense).filter(notNull);

        // Wipeout guard, mirroring montecarlo.worker.ts: if a non-empty input
        // list reconstitutes to zero instances (lost `className` discriminators
        // in transfer), the run would silently produce a meaningless projection
        // ($0 portfolio / zero spending). Throw so the main-thread sync fallback
        // — which uses the live instances directly — takes over instead. The
        // failure mode is all-or-nothing per list (className is stamped in the
        // base constructors), so a total wipe is the realistic case to catch.
        if (req.accounts.length > 0 && accounts.length === 0) {
            throw new Error(`reconstituted 0 of ${req.accounts.length} accounts (lost class discriminators in transfer)`);
        }
        if (req.incomes.length > 0 && incomes.length === 0) {
            throw new Error(`reconstituted 0 of ${req.incomes.length} incomes (lost class discriminators in transfer)`);
        }
        if (req.expenses.length > 0 && expenses.length === 0) {
            throw new Error(`reconstituted 0 of ${req.expenses.length} expenses (lost class discriminators in transfer)`);
        }

        const timeline = runSimulationWithOptimization(
            req.yearsToRun, accounts, incomes, expenses, req.assumptions, req.taxState,
            undefined, // yearlyReturns — not part of the worker contract (production never passes it)
            req.referenceDate,
            req.eoyContributionAdditions,
            req.eoyDebtReductions,
            req.eoyMortgageReductions,
            undefined, // dpObjective — production path only
            (message) => postMsg({ type: 'progress', requestId: req.requestId, message }),
        );
        postMsg({ type: 'done', requestId: req.requestId, timeline });
    } catch (err) {
        postMsg({
            type: 'error',
            requestId: req.requestId,
            message: err instanceof Error ? err.message : String(err),
        });
    }
}

self.onmessage = (e: MessageEvent): void => {
    handleJointSearchRequest(e.data as JointSearchWorkerRequest, post);
};
