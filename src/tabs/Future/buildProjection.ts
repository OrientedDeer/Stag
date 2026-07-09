import { AssumptionsState, getBirthYear, planHorizonYears } from '../../components/Objects/Assumptions/AssumptionsContext';
import { AnyAccount } from '../../components/Objects/Accounts/models';
import { AnyIncome } from '../../components/Objects/Income/models';
import { AnyExpense } from '../../components/Objects/Expense/models';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { MonthlySnapshot } from '../../components/Objects/Budget/BudgetTypes';
import { SimulationYear } from '../../services/simulation/types';
import { computeEOYBudgetContributions } from '../../services/eoyContributionProjection';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import { runJointSearchInWorker, JointSearchSupersededError } from '../../services/jointSearchRunner';

/**
 * Run the full lifetime projection for a given assumptions object, deriving the
 * horizon, the partial-year EOY budget contributions, and feeding them into the
 * optimizing engine. Single source for the projection-building block the Future
 * and Withdrawal tabs both need (they previously hand-copied it). `cachedSimulation`
 * supplies the "remainder goals already funded this year" lookup; pass the latest
 * cached timeline (or [] before the first run).
 */
export function buildProjection(
    assumptions: AssumptionsState,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    taxState: TaxState,
    budgetMonths: MonthlySnapshot[],
    cachedSimulation: SimulationYear[],
): SimulationYear[] {
    const today = new Date();
    const currentYear = today.getFullYear();
    const startYear = assumptions.demographics.priorYearMode ? currentYear - 1 : currentYear;
    const currentAge = currentYear - getBirthYear(assumptions.milestones);
    const yearsToRun = planHorizonYears(assumptions, currentAge);
    const remainderGoals = (cachedSimulation.find(s => s.year === startYear + 1)?.cashflow.bucketDetail
        ?? cachedSimulation.find(s => s.year === startYear)?.cashflow.bucketDetail
        ?? {});
    const { additions, debtReductions, mortgageReductions } = computeEOYBudgetContributions(
        assumptions.priorities, accounts, incomes, expenses, budgetMonths,
        assumptions, taxState, startYear, today, remainderGoals,
    );
    return runSimulationWithOptimization(
        yearsToRun, accounts, incomes, expenses, assumptions, taxState,
        undefined, undefined, additions, debtReductions, mortgageReductions,
    );
}

/**
 * Async variant of `buildProjection` (#158): with Tax Optimization on — the
 * multi-second joint conversion/order search — the projection runs in the
 * jointSearch Web Worker so the main thread stays responsive; without it (a
 * fast single sim), or when the worker is unavailable/fails, it falls back to
 * the synchronous path, so the result is always produced.
 *
 * Rejects ONLY with `JointSearchSupersededError` (a newer request replaced
 * this one mid-run) — callers must treat that as "drop this request", not as
 * an error; every other worker failure is swallowed into the sync fallback.
 */
export async function buildProjectionAsync(
    assumptions: AssumptionsState,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    taxState: TaxState,
    budgetMonths: MonthlySnapshot[],
    cachedSimulation: SimulationYear[],
    onProgress?: (message: string) => void,
): Promise<SimulationYear[]> {
    if (!assumptions.investments.taxOptimizationEnabled) {
        // No joint search → the sync run is fast (~50–200ms); a worker round
        // trip (spawn + clone + reconstitute) would only add latency and risk.
        // Yield to the event loop first so the caller's spinner state paints
        // before the synchronous block (the role the old setTimeout(50) played).
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        return buildProjection(assumptions, accounts, incomes, expenses, taxState, budgetMonths, cachedSimulation);
    }
    // Same derivation as buildProjection (kept inline there so the sync path
    // stays byte-identical for tests) — the EOY budget-contribution records are
    // plain objects and cheap to compute, so they stay on the main thread.
    const today = new Date();
    const currentYear = today.getFullYear();
    const startYear = assumptions.demographics.priorYearMode ? currentYear - 1 : currentYear;
    const currentAge = currentYear - getBirthYear(assumptions.milestones);
    const yearsToRun = planHorizonYears(assumptions, currentAge);
    const remainderGoals = (cachedSimulation.find(s => s.year === startYear + 1)?.cashflow.bucketDetail
        ?? cachedSimulation.find(s => s.year === startYear)?.cashflow.bucketDetail
        ?? {});
    const { additions, debtReductions, mortgageReductions } = computeEOYBudgetContributions(
        assumptions.priorities, accounts, incomes, expenses, budgetMonths,
        assumptions, taxState, startYear, today, remainderGoals,
    );
    try {
        return await runJointSearchInWorker({
            yearsToRun, accounts, incomes, expenses, assumptions, taxState,
            // Explicit reference date so the worker's partial-year proration uses
            // the SAME month the main thread saw (sync path resolves the identical
            // `referenceDate ?? new Date()` value internally).
            referenceDate: today,
            eoyContributionAdditions: additions,
            eoyDebtReductions: debtReductions,
            eoyMortgageReductions: mortgageReductions,
            onProgress,
        });
    } catch (err) {
        if (err instanceof JointSearchSupersededError) throw err;
        // Worker unavailable (jsdom/tests, exotic browsers) or failed —
        // fall back to the synchronous engine with the live instances.
        // A permanently-broken worker is otherwise invisible (the sync path
        // just silently freezes the UI again); surface it in dev so it's
        // diagnosable — same guard the Monte Carlo worker fallback carries.
        if (import.meta.env.DEV) {
            console.warn('joint search worker unavailable; running on the main thread instead:', err);
        }
        return runSimulationWithOptimization(
            yearsToRun, accounts, incomes, expenses, assumptions, taxState,
            undefined, undefined, additions, debtReductions, mortgageReductions,
        );
    }
}
