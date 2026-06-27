import { AssumptionsState, getBirthYear, getLifeExpectancy } from '../../components/Objects/Assumptions/AssumptionsContext';
import { AnyAccount } from '../../components/Objects/Accounts/models';
import { AnyIncome } from '../../components/Objects/Income/models';
import { AnyExpense } from '../../components/Objects/Expense/models';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { MonthlySnapshot } from '../../components/Objects/Budget/BudgetTypes';
import { SimulationYear } from '../../services/simulation/types';
import { computeEOYBudgetContributions } from '../../services/eoyContributionProjection';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';

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
    const yearsToRun = Math.max(1, getLifeExpectancy(assumptions.milestones) - currentAge);
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
