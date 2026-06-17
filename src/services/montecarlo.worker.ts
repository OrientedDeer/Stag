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
import { runMonteCarloSimulation } from './MonteCarloEngine';
import { reconstituteAccount } from '../components/Objects/Accounts/models';
import { reconstituteIncome } from '../components/Objects/Income/models';
import { reconstituteExpense } from '../components/Objects/Expense/models';
import type { McWorkerRequest, McWorkerResponse } from './montecarloWorkerTypes';

const post = (msg: McWorkerResponse): void =>
    (self as unknown as { postMessage: (m: McWorkerResponse) => void }).postMessage(msg);

function notNull<T>(x: T | null): x is T {
    return x !== null;
}

self.onmessage = async (e: MessageEvent): Promise<void> => {
    const req = e.data as McWorkerRequest;
    try {
        const accounts = req.accounts.map(reconstituteAccount).filter(notNull);
        const incomes = req.incomes.map(reconstituteIncome).filter(notNull);
        const expenses = req.expenses.map(reconstituteExpense).filter(notNull);
        const summary = await runMonteCarloSimulation(
            req.config, accounts, incomes, expenses, req.assumptions, req.taxState,
            (pct) => post({ type: 'progress', pct }),
        );
        post({ type: 'done', summary });
    } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
};
