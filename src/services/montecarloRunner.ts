/**
 * Main-thread driver for the Monte Carlo Web Worker (#98). Spins up the worker,
 * forwards progress, and resolves with the summary — reconstituting the class
 * instances structured clone strips on the way back. The caller (MonteCarloContext)
 * falls back to running on the main thread if the worker can't be constructed or
 * errors, so MC always works.
 */
import { reconstituteAccount } from '../components/Objects/Accounts/models';
import { reconstituteIncome } from '../components/Objects/Income/models';
import { reconstituteExpense } from '../components/Objects/Expense/models';
import type { AnyAccount } from '../components/Objects/Accounts/models';
import type { AnyIncome } from '../components/Objects/Income/models';
import type { AnyExpense } from '../components/Objects/Expense/models';
import type { MonteCarloConfig, MonteCarloSummary, ScenarioResult } from './MonteCarloTypes';
import type { SimulationYear } from './simulation/types';
import type { AssumptionsState } from '../components/Objects/Assumptions/AssumptionsContext';
import type { TaxState } from '../components/Objects/Taxes/TaxContext';
import type { McWorkerRequest, McWorkerResponse } from './montecarloWorkerTypes';

function notNull<T>(x: T | null): x is T {
    return x !== null;
}

/** Rebuild the class instances in one timeline (structured clone strips methods). */
function reconstituteTimeline(timeline: SimulationYear[]): SimulationYear[] {
    return timeline.map(year => ({
        ...year,
        accounts: (year.accounts as unknown[]).map(reconstituteAccount).filter(notNull),
        incomes: (year.incomes as unknown[]).map(reconstituteIncome).filter(notNull),
        expenses: (year.expenses as unknown[]).map(reconstituteExpense).filter(notNull),
    }));
}

const reconstituteCase = (c: ScenarioResult): ScenarioResult =>
    ({ ...c, timeline: reconstituteTimeline(c.timeline) });

/**
 * Rebuild class instances in the summary's representative timelines. Only
 * median/worst/best carry full timelines (the percentile bands are plain
 * numbers), so this touches just three timelines — cheap on the main thread.
 * Without it, the UI's `getAccountTotals` `instanceof` checks (net-worth chart)
 * would see plain objects and miscount liabilities/property.
 */
export function reconstituteSummary(summary: MonteCarloSummary): MonteCarloSummary {
    return {
        ...summary,
        worstCase: reconstituteCase(summary.worstCase),
        medianCase: reconstituteCase(summary.medianCase),
        bestCase: reconstituteCase(summary.bestCase),
    };
}

/**
 * Run the Monte Carlo simulation in a Web Worker. Rejects if the worker can't be
 * constructed or it reports an error — the caller should fall back to the
 * main-thread engine.
 */
export function runMonteCarloInWorker(
    config: MonteCarloConfig,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    onProgress?: (pct: number) => void,
): Promise<MonteCarloSummary> {
    return new Promise<MonteCarloSummary>((resolve, reject) => {
        let worker: Worker;
        try {
            worker = new Worker(new URL('./montecarlo.worker.ts', import.meta.url), { type: 'module' });
        } catch (e) {
            reject(e instanceof Error ? e : new Error('Monte Carlo worker unavailable'));
            return;
        }
        worker.onmessage = (e: MessageEvent<McWorkerResponse>) => {
            const msg = e.data;
            if (msg.type === 'progress') {
                onProgress?.(msg.pct);
            } else if (msg.type === 'done') {
                worker.terminate();
                resolve(reconstituteSummary(msg.summary));
            } else {
                worker.terminate();
                reject(new Error(msg.message));
            }
        };
        worker.onerror = (ev: ErrorEvent) => {
            worker.terminate();
            reject(new Error(ev.message || 'Monte Carlo worker error'));
        };
        const req: McWorkerRequest = {
            config,
            accounts: accounts as unknown[],
            incomes: incomes as unknown[],
            expenses: expenses as unknown[],
            assumptions,
            taxState,
        };
        worker.postMessage(req);
    });
}
