/**
 * Monte Carlo Web Worker (#98). Runs the entire MC simulation off the main
 * thread — the ~20s stochastic-DP policy solve plus the 1,000-path loop — so the
 * UI stays responsive. The compute graph (MonteCarloEngine → useSimulation →
 * simulation services) is React-free at runtime: the context modules it imports
 * only touch the DOM inside provider components/hooks the worker never calls, so
 * React is bundled but inert here.
 *
 * Class instances (accounts/incomes/expenses) arrive as plain objects (structured
 * clone strips methods) and are reconstituted before the run; the resulting
 * summary is posted back and re-reconstituted on the main thread
 * (see montecarloRunner.reconstituteSummary).
 */
// MUST stay the first import — see workerWindowShim doc (dev react-refresh
// preamble references `window`; without the shim this worker dies at load and
// every MC run silently falls back to the main-thread engine).
import './workerWindowShim';
import { runMonteCarloSimulation, solveMcConversionPlan } from './MonteCarloEngine';
import { getCachedPlan, putCachedPlan } from './policyCache';
import { reconstituteAccount } from '../components/Objects/Accounts/models';
import { reconstituteIncome } from '../components/Objects/Income/models';
import { reconstituteExpense } from '../components/Objects/Expense/models';
import type { McWorkerRequest, McWorkerResponse } from './montecarloWorkerTypes';
import { notNull } from '../utils/notNull';

const post = (msg: McWorkerResponse): void =>
    (self as unknown as { postMessage: (m: McWorkerResponse) => void }).postMessage(msg);

self.onmessage = async (e: MessageEvent): Promise<void> => {
    const req = e.data as McWorkerRequest;
    try {
        const accounts = req.accounts.map(reconstituteAccount).filter(notNull);
        const incomes = req.incomes.map(reconstituteIncome).filter(notNull);
        const expenses = req.expenses.map(reconstituteExpense).filter(notNull);

        // Guard against a silent reconstitution failure: if we were handed
        // instances but rebuilt none (e.g. a missing `className` discriminator
        // after structured clone), the run would produce a meaningless result.
        // Dropping every account → $0 net worth → 100% "success"; dropping every
        // expense → zero spending → an equally impossible ~100% success. The
        // className-clone failure is all-or-nothing per list (className is stamped
        // in the base constructor on every instance, so the clone either preserves
        // it for all or none) — so a TOTAL wipe of any of the three lists is the
        // realistic failure mode. We check all three; a partial drop from
        // heterogeneous/malformed input is NOT caught here (out of scope). Throw so
        // the main-thread fallback — which uses the live instances directly — takes
        // over instead.
        if (req.accounts.length > 0 && accounts.length === 0) {
            throw new Error(
                `reconstituted 0 of ${req.accounts.length} accounts (lost class discriminators in transfer)`,
            );
        }
        if (req.expenses.length > 0 && expenses.length === 0) {
            throw new Error(
                `reconstituted 0 of ${req.expenses.length} expenses (lost class discriminators in transfer)`,
            );
        }
        if (req.incomes.length > 0 && incomes.length === 0) {
            throw new Error(
                `reconstituted 0 of ${req.incomes.length} incomes (lost class discriminators in transfer)`,
            );
        }

        // Cache key: everything the policy depends on, EXCLUDING seed and
        // numScenarios (they don't change the policy), so re-running with only
        // those changed is an instant cache hit. Hashed off the raw cloned request:
        // relies on stable structured-clone field ordering, and is collision-guarded
        // downstream by policyCache's full-key recheck. Rounding rm/rs to 4 decimals
        // absorbs float noise (benign extra misses otherwise); the current year
        // guards against day-to-day drift.
        const cacheKey = JSON.stringify({
            rm: Number(req.config.returnMean.toFixed(4)),
            rs: Number(req.config.returnStdDev.toFixed(4)),
            a: req.accounts,
            i: req.incomes,
            e: req.expenses,
            as: req.assumptions,
            ts: req.taxState,
            y: new Date().getFullYear(),
        });
        post({ type: 'phase', phase: 'solving' });
        let plan = await getCachedPlan(cacheKey);
        if (!plan) {
            plan = solveMcConversionPlan(req.config, accounts, incomes, expenses, req.assumptions, req.taxState);
            await putCachedPlan(cacheKey, plan); // no-op when there's no policy (non-DP)
        }

        post({ type: 'phase', phase: 'running' });
        const summary = await runMonteCarloSimulation(
            req.config, accounts, incomes, expenses, req.assumptions, req.taxState,
            (pct) => post({ type: 'progress', pct }),
            plan,
        );
        post({ type: 'done', summary });
    } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
};
