/**
 * Message protocol for the joint conversion/withdrawal-order search Web Worker
 * (#158). Shared by the worker (`jointSearch.worker.ts`) and the main-thread
 * driver (`jointSearchRunner.ts`). Mirrors the Monte Carlo worker protocol
 * (`montecarloWorkerTypes.ts`) — the established pattern for shipping class
 * instances across the structured-clone boundary.
 */
import type { AssumptionsState } from '../components/Objects/Assumptions/AssumptionsContext';
import type { TaxState } from '../components/Objects/Taxes/TaxContext';
import type { SimulationYear } from './simulation/types';

/**
 * Inputs posted to the worker — exactly the production argument list of
 * `runSimulationWithOptimization` (the app call site never passes
 * yearlyReturns or dpObjective, so they are deliberately NOT part of the
 * contract; callers that need them use the sync path).
 *
 * `accounts`/`incomes`/`expenses` are class instances on the main thread;
 * structured clone strips their methods to plain objects in transit, so the
 * worker reconstitutes them via the `className`-keyed reconstitute* functions
 * (never constructor.name — minification-safe only because of the keepNames
 * build flag, and the className field is the contract regardless).
 * `assumptions`/`taxState` are plain reducer state and clone losslessly;
 * `referenceDate` is a Date (structured clone preserves Dates).
 *
 * `requestId` tags every response so the driver can pair messages with the
 * request it sent (the worker is serial — one request in flight at a time —
 * but the id makes staleness handling explicit and cheap).
 */
export interface JointSearchWorkerRequest {
    requestId: number;
    yearsToRun: number;
    accounts: unknown[];
    incomes: unknown[];
    expenses: unknown[];
    assumptions: AssumptionsState;
    taxState: TaxState;
    referenceDate: Date;
    eoyContributionAdditions?: Record<string, number>;
    eoyDebtReductions?: Record<string, number>;
    eoyMortgageReductions?: Record<string, number>;
}

/**
 * Messages the worker posts back. `done.timeline` is the full SimulationYear[]
 * the sync path returns — including the year-0 stamps every consumer reads
 * (chosenWithdrawalOrder, orderOptimizationGain, stdDedBaselineTerminalAfterTaxNW,
 * strategyTerminalAfterTaxNW, feasibilityFloorApplied, logs/summaryLogs) and the
 * per-year dpTrace. Its accounts/incomes/expenses arrive as plain objects and
 * are reconstituted by the driver (jointSearchRunner.reconstituteTimeline).
 */
export type JointSearchWorkerResponse =
    | { type: 'progress'; requestId: number; message: string }
    | { type: 'done'; requestId: number; timeline: SimulationYear[] }
    | { type: 'error'; requestId: number; message: string };
