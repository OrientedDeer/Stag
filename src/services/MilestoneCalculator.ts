/**
 * Milestone Calculator
 *
 * Calculates retirement milestones and financial independence metrics.
 */

import { AssumptionsState } from '../components/Objects/Assumptions/AssumptionsContext';
import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { InvestedAccount } from '../components/Objects/Accounts/models';
import { MortgageExpense } from '../components/Objects/Expense/models';

export interface Milestone {
  name: string;
  age: number;
  year: number;
  description: string;
  isReached: boolean;
  yearsUntil: number;
}

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
  keyMilestones: Milestone[];
}

export interface FIResult {
  year: number;
  age: number;
}

/**
 * Key retirement milestone ages with descriptions
 */
const KEY_MILESTONE_AGES: Array<{ age: number; name: string; description: string }> = [
  { age: 59.5, name: 'Penalty-Free', description: 'Penalty-free retirement withdrawals' },
  { age: 62, name: 'SS Eligible', description: 'Social Security benefits available (reduced)' },
  { age: 65, name: 'Medicare', description: 'Medicare eligibility begins' },
  { age: 67, name: 'Full SS', description: 'Full Social Security retirement age' },
  { age: 70, name: 'Max SS', description: 'Maximum Social Security benefits' },
  { age: 73, name: 'RMDs', description: 'Required Minimum Distributions begin' },
];

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
      const age = currentYear.year - assumptions.demographics.birthYear;
      return { year: currentYear.year, age };
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
  const { birthYear, retirementAge, lifeExpectancy, priorYearMode } = assumptions.demographics;

  // Calculate start year and age from birth year
  const calendarYear = new Date().getFullYear();
  const startYear = priorYearMode ? calendarYear - 1 : calendarYear;
  const startAge = startYear - birthYear;

  // Current year from simulation or calculated
  const currentYear = startYear;
  const currentAge = startAge;

  // Calculate retirement year
  const retirementYear = startYear + (retirementAge - startAge);

  // Calculate life expectancy year
  const lifeExpectancyYear = startYear + (lifeExpectancy - startAge);

  // Find FI year
  const fiResult = findFinancialIndependenceYear(simulation, assumptions);

  // Calculate progress (0-100) through life span
  // Progress from birth (age 0) to life expectancy
  const progress = Math.min(100, Math.max(0, (currentAge / lifeExpectancy) * 100));

  // Build key milestones
  const keyMilestones: Milestone[] = KEY_MILESTONE_AGES.map(({ age, name, description }) => {
    const milestoneYear = startYear + (age - startAge);
    const isReached = currentAge >= age;
    const yearsUntil = isReached ? 0 : Math.ceil(age - currentAge);

    return {
      name,
      age,
      year: milestoneYear,
      description,
      isReached,
      yearsUntil,
    };
  });

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
    keyMilestones,
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
