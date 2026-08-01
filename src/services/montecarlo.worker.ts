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
import { getBondStdDev, getStockBondCorrelation } from './MonteCarloTypes';

const post = (msg: McWorkerResponse): void =>
    (self as unknown as { postMessage: (m: McWorkerResponse) => void }).postMessage(msg);

/**
 * Handle one MC run request. Exported for the cache-key parity test (#130),
 * which invokes it directly — vitest can't run real web workers, mirroring
 * jointSearch.worker.ts's `handleJointSearchRequest` / this worker's own
 * montecarloWorkerGuard.test.ts precedent.
 */
export async function handleMcRequest(
    req: McWorkerRequest,
    postMsg: (msg: McWorkerResponse) => void,
): Promise<void> {
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

        // Round returnMean/returnStdDev ONCE here, into the config object used
        // for ALL THREE consumers below (cache key, solve, run) — not just the
        // cache key. Before #130, the cache key rounded rm/rs to 4dp but the
        // solve and run consumed the full-precision req.config directly, so two
        // configs that round identically (e.g. float noise like 7.00000049)
        // could share a cached policy solved for a DIFFERENT rate than the one
        // actually run. policyCache's full-key recheck doesn't catch this: the
        // "full key" IS the rounded key, so a mismatched full-precision config
        // still matches it. Rounding once and threading the same object through
        // keeps the cache key and the actual run permanently in agreement.
        const config = {
            ...req.config,
            returnMean: Number(req.config.returnMean.toFixed(4)),
            returnStdDev: Number(req.config.returnStdDev.toFixed(4)),
            // #208: same rounding treatment for the bond risk parameters.
            bondReturnStdDev: Number(getBondStdDev(req.config).toFixed(4)),
            stockBondCorrelation: Number(getStockBondCorrelation(req.config).toFixed(4)),
        };

        // Cache key: everything the policy depends on, EXCLUDING seed and
        // numScenarios (they don't change the policy), so re-running with only
        // those changed is an instant cache hit. Hashed off the raw cloned request:
        // relies on stable structured-clone field ordering, and is collision-guarded
        // downstream by policyCache's full-key recheck. Rounding rm/rs to 4 decimals
        // absorbs float noise (benign extra misses otherwise); the current year
        // guards against day-to-day drift.
        const cacheKey = JSON.stringify({
            // Engine-behavior version: the key otherwise hashes INPUTS only, so an
            // engine change (e.g. #155's Roth penalty-slice split) would replay a
            // stale cached policy solved under the old behavior. Bump on
            // policy-affecting engine changes so old IndexedDB entries miss.
            // v3-169: gap-year policy entries are now consulted per path
            // (solveWorkingYear #98 lookup) — pre-#159/#169 cached policies lack
            // gap-year coverage, so force a re-solve.
            // #208: bumped — the two-asset draw changes the return distribution the
            // policy is solved against, so pre-#208 cached policies must miss.
            v: 'v4-208',
            rm: config.returnMean,
            rs: config.returnStdDev,
            // #208: two configs differing only in bond vol/correlation solve to different
            // policies, so both must be part of the key.
            brs: config.bondReturnStdDev,
            rho: config.stockBondCorrelation,
            a: req.accounts,
            i: req.incomes,
            e: req.expenses,
            as: req.assumptions,
            ts: req.taxState,
            y: new Date().getFullYear(),
        });
        postMsg({ type: 'phase', phase: 'solving' });
        let plan = await getCachedPlan(cacheKey);
        if (!plan) {
            plan = solveMcConversionPlan(config, accounts, incomes, expenses, req.assumptions, req.taxState);
            await putCachedPlan(cacheKey, plan); // no-op when there's no policy (non-DP)
        }

        postMsg({ type: 'phase', phase: 'running' });
        const summary = await runMonteCarloSimulation(
            config, accounts, incomes, expenses, req.assumptions, req.taxState,
            (pct) => postMsg({ type: 'progress', pct }),
            plan,
        );
        postMsg({ type: 'done', summary });
    } catch (err) {
        postMsg({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
}

self.onmessage = (e: MessageEvent): void => {
    void handleMcRequest(e.data as McWorkerRequest, post);
};
