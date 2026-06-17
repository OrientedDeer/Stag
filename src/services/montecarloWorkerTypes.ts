/**
 * Message protocol for the Monte Carlo Web Worker (#98). Shared by the worker
 * (`montecarlo.worker.ts`) and the main-thread driver (`montecarloRunner.ts`).
 */
import type { MonteCarloConfig, MonteCarloSummary } from './MonteCarloTypes';
import type { AssumptionsState } from '../components/Objects/Assumptions/AssumptionsContext';
import type { TaxState } from '../components/Objects/Taxes/TaxContext';

/**
 * Inputs posted to the worker. `accounts`/`incomes`/`expenses` are class
 * instances on the main thread; structured clone strips their methods to plain
 * objects in transit, so the worker reconstitutes them (hence `unknown[]`).
 * `assumptions`/`taxState`/`config` are plain reducer state and clone losslessly.
 */
export interface McWorkerRequest {
    config: MonteCarloConfig;
    accounts: unknown[];
    incomes: unknown[];
    expenses: unknown[];
    assumptions: AssumptionsState;
    taxState: TaxState;
}

/** Messages the worker posts back. */
export type McWorkerResponse =
    | { type: 'phase'; phase: 'solving' | 'running' }
    | { type: 'progress'; pct: number }
    | { type: 'done'; summary: MonteCarloSummary }
    | { type: 'error'; message: string };
