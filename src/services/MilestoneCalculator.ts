/**
 * Milestone Calculator
 *
 * Calculates retirement milestones and financial independence metrics.
 */

import { AssumptionsState, getRetirementAge, getLifeExpectancy, getBirthYear, BUILTIN_MILESTONE_IDS } from '../components/Objects/Assumptions/AssumptionsContext';
import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { InvestedAccount } from '../components/Objects/Accounts/models';
import { MortgageExpense } from '../components/Objects/Expense/models';

export interface MilestonesSummary {
  currentAge: number;
  currentYear: number;
  retirementAge: number;
  retirementYear: number;
  fiAge: number | null;
  fiYear: number | null;
  lifeExpectancy: number;
  lifeExpectancyYear: number;
  progress: number; // 0-100 (current position between birth and life expectancy)
}

export interface FIResult {
  year: number;
  age: number;
}

/**
 * Find the year when Financial Independence is reached.
 *
 * FI is reached when portfolio * withdrawal rate >= expenses / (1 - tax rate)
 * Uses 15% estimated tax rate for conservative calculation.
 */
export function findFinancialIndependenceYear(
  simulation: SimulationYear[],
  assumptions: AssumptionsState
): FIResult | null {
  for (let i = 1; i < simulation.length; i++) {
    const lastYear = simulation[i - 1];
    const currentYear = simulation[i];

    // Calculate invested assets at start of year
    const startingInvestedAssets = lastYear.accounts
      .filter(acc => acc instanceof InvestedAccount)
      .reduce((sum, acc) => sum + acc.amount, 0);

    // Safe withdrawal amount based on user's withdrawal rate
    const safeWithdrawalAmount = startingInvestedAssets * (assumptions.investments.withdrawalRate / 100);

    // Calculate annual living expenses
    const annualLivingExpenses = currentYear.expenses.reduce((sum, exp) => {
      if (exp instanceof MortgageExpense) {
        return sum + exp.calculateAnnualAmortization(currentYear.year).totalPayment;
      }
      return sum + exp.getAnnualAmount(currentYear.year);
    }, 0);

    // Gross up for taxes (conservative 15% estimate)
    const estimatedTaxRate = 0.15;
    const grossWithdrawalNeeded = annualLivingExpenses / (1 - estimatedTaxRate);

    if (safeWithdrawalAmount >= grossWithdrawalNeeded) {
      const age = currentYear.year - getBirthYear(assumptions.milestones);
      return { year: currentYear.year, age };
    }
  }
  return null;
}

/**
 * Find when a specific milestone was reached in the simulation.
 * Returns the first year where the milestone appears in milestoneEvents.
 */
function findMilestoneReachYear(
  simulation: SimulationYear[],
  milestoneId: string
): { year: number; age: number } | null {
  for (const year of simulation) {
    const event = year.milestoneEvents?.find(e => e.milestoneId === milestoneId);
    if (event) {
      return { year: event.yearReached, age: event.ageReached };
    }
  }
  return null;
}

/**
 * Calculate all milestone information for the milestone tracker.
 */
export function calculateMilestones(
  assumptions: AssumptionsState,
  simulation: SimulationYear[]
): MilestonesSummary {
  const { priorYearMode } = assumptions.demographics;
  const birthYear = getBirthYear(assumptions.milestones);
  const configuredRetirementAge = getRetirementAge(assumptions.milestones);
  const lifeExpectancy = getLifeExpectancy(assumptions.milestones);

  // Calculate start year and age from birth year
  const calendarYear = new Date().getFullYear();
  const startYear = priorYearMode ? calendarYear - 1 : calendarYear;
  const startAge = startYear - birthYear;

  // Current year from simulation or calculated
  const currentYear = startYear;
  const currentAge = startAge;

  // Find actual retirement year/age from simulation (when RETIRE milestone was reached)
  // This handles milestones with multiple conditions (e.g., AGE >= 65 AND NET_WORTH >= 1M)
  const actualRetirement = findMilestoneReachYear(simulation, BUILTIN_MILESTONE_IDS.RETIRE);
  const retirementAge = actualRetirement?.age ?? configuredRetirementAge;

  // Calculate retirement year
  const retirementYear = actualRetirement?.year ?? (startYear + (configuredRetirementAge - startAge));

  // Calculate life expectancy year
  const lifeExpectancyYear = startYear + (lifeExpectancy - startAge);

  // Find FI year
  const fiResult = findFinancialIndependenceYear(simulation, assumptions);

  // Calculate progress (0-100) through life span
  // Progress from birth (age 0) to life expectancy
  const progress = Math.min(100, Math.max(0, (currentAge / lifeExpectancy) * 100));

  return {
    currentAge,
    currentYear,
    retirementAge,
    retirementYear,
    fiAge: fiResult?.age ?? null,
    fiYear: fiResult?.year ?? null,
    lifeExpectancy,
    lifeExpectancyYear,
    progress,
  };
}

/**
 * Calculate years until a target age from current age.
 */
export function yearsUntil(currentAge: number, targetAge: number): number {
  return Math.max(0, Math.ceil(targetAge - currentAge));
}

/**
 * Format age for display (handles half years like 59.5).
 */
export function formatAge(age: number): string {
  if (age % 1 === 0.5) {
    return `${Math.floor(age)}½`;
  }
  return String(Math.floor(age));
}
