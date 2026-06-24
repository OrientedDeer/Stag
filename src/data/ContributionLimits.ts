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
  // SECURE 2.0 "super" catch-up for ages 60-63 (replaces, not adds to, catchUp401k
  // for that age band). Published as a separate figure by the IRS — do NOT derive
  // it as catchUp401k * 1.5 (the ratio only happens to hold for some years).
  superCatchUp401k: number;

  // IRA limits
  traditionalIRA: number;       // Also applies to Roth IRA (combined limit)
  catchUpIRA: number;           // Additional amount for age 50+

  // HSA limits
  hsaIndividual: number;        // Self-only coverage
  hsaFamily: number;            // Family coverage
  catchUpHSA: number;           // Additional amount for age 55+

  // §415(c) annual-additions limit: combined cap on employee (pre-tax + Roth)
  // + employer contributions to a single defined-contribution plan.
  // Catch-up contributions are ON TOP of this limit (handled via get415cLimit).
  section415c: number;
}

const CONTRIBUTION_LIMITS: Record<number, YearlyContributionLimits> = {
  2024: {
    traditional401k: 23000,
    catchUp401k: 7500,
    superCatchUp401k: 7500,     // SECURE 2.0 super catch-up not yet in effect for 2024
    traditionalIRA: 7000,
    catchUpIRA: 1000,
    hsaIndividual: 4150,
    hsaFamily: 8300,
    catchUpHSA: 1000,
    section415c: 69000,
  },
  2025: {
    traditional401k: 23500,
    catchUp401k: 7500,
    superCatchUp401k: 11250,    // IRS Notice 2024-80 (first year of the 60-63 super catch-up)
    traditionalIRA: 7000,
    catchUpIRA: 1000,
    hsaIndividual: 4300,
    hsaFamily: 8550,
    catchUpHSA: 1000,
    section415c: 70000,
  },
  2026: {
    traditional401k: 24500,     // IRS Notice 2025-67
    catchUp401k: 8000,          // IRS Notice 2025-67 (up from 7500)
    superCatchUp401k: 11250,    // IRS Notice 2025-67 (ages 60-63; unchanged from 2025)
    traditionalIRA: 7500,       // IRS Notice 2025-67
    catchUpIRA: 1100,           // IRS Notice 2025-67 (up from 1000)
    hsaIndividual: 4400,        // Rev. Proc. 2025-19
    hsaFamily: 8750,            // Rev. Proc. 2025-19
    catchUpHSA: 1000,
    section415c: 72000,         // IRS Notice 2025-67
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
    superCatchUp401k: latestLimits.superCatchUp401k,  // 60-63 super catch-up, held flat like catchUp401k
    traditionalIRA: Math.round(latestLimits.traditionalIRA * inflationFactor / 500) * 500,
    catchUpIRA: latestLimits.catchUpIRA,
    hsaIndividual: Math.round(latestLimits.hsaIndividual * inflationFactor / 50) * 50,
    hsaFamily: Math.round(latestLimits.hsaFamily * inflationFactor / 50) * 50,
    catchUpHSA: latestLimits.catchUpHSA,
    section415c: Math.round(latestLimits.section415c * inflationFactor / 1000) * 1000,
  };
}

/**
 * Get the 401k contribution limit for a specific year and age.
 */
export function get401kLimit(year: number, age: number, inflationAdjusted: boolean = true): number {
  const limits = getContributionLimits(year, inflationAdjusted);
  const base = limits.traditional401k;
  const catchUp = age >= 50 ? (age >= 60 && age <= 63 ? limits.superCatchUp401k : limits.catchUp401k) : 0;
  return base + catchUp;
}

/**
 * Get the §415(c) annual-additions limit for a specific year and age.
 *
 * This caps the COMBINED employee (pre-tax + Roth) + employer contributions to
 * a single defined-contribution (401k) plan. Per IRS rules, age 50+ catch-up
 * contributions are allowed ON TOP of the §415(c) limit, so we add the same
 * catch-up amount used by get401kLimit (including the 60-63 super catch-up).
 */
export function get415cLimit(year: number, age: number, inflationAdjusted: boolean = true): number {
  const limits = getContributionLimits(year, inflationAdjusted);
  const base = limits.section415c;
  const catchUp = age >= 50 ? (age >= 60 && age <= 63 ? limits.superCatchUp401k : limits.catchUp401k) : 0;
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

/**
 * Get the ESPP (Employee Stock Purchase Plan) FMV limit.
 *
 * IRS limits ESPP purchases to $25,000 of stock Fair Market Value per calendar year.
 * This is measured at the grant date FMV, not the purchase date.
 * Note: This is not the amount you can contribute, but the FMV of shares you can acquire.
 *
 * @returns Annual ESPP FMV limit ($25,000)
 */
export function getESPPLimit(): number {
  // ESPP limit is fixed at $25,000 FMV and is not adjusted for inflation
  return 25000;
}
