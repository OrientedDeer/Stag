/**
 * Retirement Account Contribution Limits
 *
 * IRS contribution limits for 401k, IRA, and HSA accounts by year.
 * Used for tax optimization recommendations.
 */

export interface YearlyContributionLimits {
  // 401k limits
  traditional401k: number;      // Also applies to Roth 401k (combined limit)
  catchUp401k: number;          // Additional amount for age 50+

  // IRA limits
  traditionalIRA: number;       // Also applies to Roth IRA (combined limit)
  catchUpIRA: number;           // Additional amount for age 50+

  // HSA limits
  hsaIndividual: number;        // Self-only coverage
  hsaFamily: number;            // Family coverage
  catchUpHSA: number;           // Additional amount for age 55+
}

export const CONTRIBUTION_LIMITS: Record<number, YearlyContributionLimits> = {
  2024: {
    traditional401k: 23000,
    catchUp401k: 7500,
    traditionalIRA: 7000,
    catchUpIRA: 1000,
    hsaIndividual: 4150,
    hsaFamily: 8300,
    catchUpHSA: 1000,
  },
  2025: {
    traditional401k: 23500,
    catchUp401k: 7500,
    traditionalIRA: 7000,
    catchUpIRA: 1000,
    hsaIndividual: 4300,
    hsaFamily: 8550,
    catchUpHSA: 1000,
  },
  2026: {
    traditional401k: 24500,     // Projected
    catchUp401k: 7500,
    traditionalIRA: 7000,
    catchUpIRA: 1000,
    hsaIndividual: 4400,        // Projected
    hsaFamily: 8750,            // Projected
    catchUpHSA: 1000,
  },
};

/**
 * Get contribution limits for a specific year.
 * Falls back to closest available year if exact year not found.
 *
 * @param year - The tax year to get limits for
 * @param inflationAdjusted - If true (default), projects future years with ~2.5% growth.
 *                            If false, uses latest known values without projection.
 */
export function getContributionLimits(year: number, inflationAdjusted: boolean = true): YearlyContributionLimits {
  if (CONTRIBUTION_LIMITS[year]) {
    return CONTRIBUTION_LIMITS[year];
  }

  // Find closest year
  const years = Object.keys(CONTRIBUTION_LIMITS).map(Number).sort((a, b) => a - b);

  if (year < years[0]) {
    return CONTRIBUTION_LIMITS[years[0]];
  }

  // For future years beyond our data
  const latestYear = years[years.length - 1];
  const latestLimits = CONTRIBUTION_LIMITS[latestYear];

  // If not inflation adjusted (real dollars mode), use latest known values
  if (!inflationAdjusted) {
    return latestLimits;
  }

  // Project forward with assumed ~2.5% annual increase
  const yearsAhead = year - latestYear;
  const inflationFactor = Math.pow(1.025, yearsAhead);

  return {
    traditional401k: Math.round(latestLimits.traditional401k * inflationFactor / 500) * 500,
    catchUp401k: latestLimits.catchUp401k,  // Catch-up tends to stay flat
    traditionalIRA: Math.round(latestLimits.traditionalIRA * inflationFactor / 500) * 500,
    catchUpIRA: latestLimits.catchUpIRA,
    hsaIndividual: Math.round(latestLimits.hsaIndividual * inflationFactor / 50) * 50,
    hsaFamily: Math.round(latestLimits.hsaFamily * inflationFactor / 50) * 50,
    catchUpHSA: latestLimits.catchUpHSA,
  };
}

/**
 * Get the 401k contribution limit for a specific year and age.
 */
export function get401kLimit(year: number, age: number, inflationAdjusted: boolean = true): number {
  const limits = getContributionLimits(year, inflationAdjusted);
  const base = limits.traditional401k;
  const catchUp = age >= 50 ? limits.catchUp401k : 0;
  return base + catchUp;
}

/**
 * Get the IRA contribution limit for a specific year and age.
 */
export function getIRALimit(year: number, age: number, inflationAdjusted: boolean = true): number {
  const limits = getContributionLimits(year, inflationAdjusted);
  const base = limits.traditionalIRA;
  const catchUp = age >= 50 ? limits.catchUpIRA : 0;
  return base + catchUp;
}

/**
 * Get the HSA contribution limit for a specific year, age, and coverage type.
 */
export function getHSALimit(
  year: number,
  age: number,
  coverage: 'individual' | 'family',
  inflationAdjusted: boolean = true
): number {
  const limits = getContributionLimits(year, inflationAdjusted);
  const base = coverage === 'family' ? limits.hsaFamily : limits.hsaIndividual;
  const catchUp = age >= 55 ? limits.catchUpHSA : 0;
  return base + catchUp;
}

/**
 * Calculate potential tax savings from maxing out a retirement account.
 */
export function calculateContributionTaxSavings(
  currentContribution: number,
  limit: number,
  marginalTaxRate: number
): { additionalContribution: number; taxSavings: number } {
  const additionalContribution = Math.max(0, limit - currentContribution);
  const taxSavings = additionalContribution * marginalTaxRate;
  return { additionalContribution, taxSavings };
}
