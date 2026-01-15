/**
 * Federal Pension Data - FERS and CSRS
 *
 * This file contains official federal pension data used for calculating retirement benefits:
 * - FERS (Federal Employees Retirement System) - for employees hired after 1983
 * - CSRS (Civil Service Retirement System) - for employees hired before 1984
 *
 * Sources:
 * - OPM FERS: https://www.opm.gov/retirement-center/fers-information/
 * - OPM CSRS: https://www.opm.gov/retirement-center/csrs-information/
 * - OPM FERS Supplement: https://www.opm.gov/retirement-center/fers-information/types-of-retirement/#annuity-supplement
 */

export type PensionSystem = 'FERS' | 'CSRS';

/**
 * FERS Minimum Retirement Age (MRA) by Birth Year
 *
 * The MRA is the earliest age at which a FERS employee can retire
 * with an immediate (unreduced) annuity with at least 30 years of service.
 *
 * For those born 1970 or later: MRA = 57
 */
export const FERS_MRA_BY_BIRTH_YEAR: Record<number, number> = {
  1948: 55,
  1949: 55,
  1950: 55,
  1951: 55,
  1952: 55,
  1953: 55.167, // 55 years 2 months
  1954: 55.333, // 55 years 4 months
  1955: 55.5,   // 55 years 6 months
  1956: 55.667, // 55 years 8 months
  1957: 55.833, // 55 years 10 months
  1958: 56,
  1959: 56,
  1960: 56,
  1961: 56,
  1962: 56,
  1963: 56.167, // 56 years 2 months
  1964: 56.333, // 56 years 4 months
  1965: 56.5,   // 56 years 6 months
  1966: 56.667, // 56 years 8 months
  1967: 56.833, // 56 years 10 months
  1968: 57,
  1969: 57,
  1970: 57,
  // All birth years 1970+ have MRA of 57
};

/**
 * Get FERS MRA for a given birth year
 * Returns 57 for birth years 1970 and later
 */
export function getFERSMRA(birthYear: number): number {
  if (birthYear >= 1970) return 57;
  if (birthYear < 1948) return 55;
  return FERS_MRA_BY_BIRTH_YEAR[birthYear] || 57;
}

/**
 * FERS Retirement Eligibility Rules
 *
 * Immediate, unreduced retirement:
 * - Age 62 with 5+ years of service
 * - Age 60 with 20+ years of service
 * - MRA with 30+ years of service
 *
 * Immediate, reduced retirement (MRA+10):
 * - MRA with 10+ years of service (reduced by 5% per year under 62)
 *
 * Early retirement (RIF/VERA):
 * - Age 50 with 20+ years, or any age with 25+ years (during RIF/VERA)
 */
export interface FERSEligibilityResult {
  eligible: boolean;
  reductionPercent: number;
  message: string;
}

/**
 * Check FERS retirement eligibility and calculate any reduction
 */
export function checkFERSEligibility(
  age: number,
  yearsOfService: number,
  birthYear: number
): FERSEligibilityResult {
  const mra = getFERSMRA(birthYear);

  // Age 62 with 5+ years - full benefit
  if (age >= 62 && yearsOfService >= 5) {
    return { eligible: true, reductionPercent: 0, message: 'Full retirement at 62 with 5+ years' };
  }

  // Age 60 with 20+ years - full benefit
  if (age >= 60 && yearsOfService >= 20) {
    return { eligible: true, reductionPercent: 0, message: 'Full retirement at 60 with 20+ years' };
  }

  // MRA with 30+ years - full benefit
  if (age >= mra && yearsOfService >= 30) {
    return { eligible: true, reductionPercent: 0, message: 'Full retirement at MRA with 30+ years' };
  }

  // MRA with 10-29 years - reduced benefit (5% per year under 62)
  if (age >= mra && yearsOfService >= 10) {
    const yearsUnder62 = Math.max(0, 62 - age);
    const reduction = yearsUnder62 * 5;
    return {
      eligible: true,
      reductionPercent: Math.min(reduction, 25), // Cap at 25%
      message: `MRA+10 retirement with ${reduction}% reduction`
    };
  }

  return { eligible: false, reductionPercent: 0, message: 'Not yet eligible for retirement' };
}

/**
 * FERS Basic Benefit Calculation
 *
 * Formula: Years of Service × High-3 × Multiplier
 *
 * Multiplier:
 * - 1% per year of service
 * - 1.1% per year if retiring at age 62+ with 20+ years of service
 *
 * @param yearsOfService Total years of creditable federal service
 * @param high3 Average of highest 3 consecutive years of basic pay
 * @param retirementAge Age at retirement
 * @returns Annual pension amount before any reductions
 */
export function calculateFERSBasicBenefit(
  yearsOfService: number,
  high3: number,
  retirementAge: number
): number {
  // 1.1% multiplier if retiring at 62+ with 20+ years
  const multiplier = (retirementAge >= 62 && yearsOfService >= 20) ? 0.011 : 0.01;
  return yearsOfService * high3 * multiplier;
}

/**
 * FERS Supplement Calculation
 *
 * The FERS Supplement is a temporary benefit paid from retirement until age 62,
 * designed to bridge the gap until Social Security becomes available.
 *
 * Formula: (Years of FERS service / 40) × Estimated SS benefit at age 62
 *
 * Notes:
 * - Only available if retiring before age 62
 * - Subject to Social Security earnings test if working
 * - Ends at age 62 (when actual SS becomes available)
 * - Not available for MRA+10 (early reduced) retirees unless they meet exception
 *
 * @param yearsOfService Total years of FERS service
 * @param estimatedSSAt62 Estimated monthly Social Security benefit at age 62
 * @returns Annual FERS Supplement amount
 */
export function calculateFERSSupplement(
  yearsOfService: number,
  estimatedSSAt62: number
): number {
  // Monthly supplement = (years / 40) × monthly SS at 62
  const monthlySupplementAmount = (yearsOfService / 40) * estimatedSSAt62;
  return monthlySupplementAmount * 12;
}

/**
 * FERS COLA (Cost of Living Adjustment)
 *
 * FERS retirees under age 62 do not receive COLA.
 * FERS retirees 62+ receive:
 * - CPI < 2%: Full COLA
 * - CPI 2-3%: 2% COLA
 * - CPI > 3%: CPI - 1% COLA
 *
 * @param inflation Annual inflation rate (as decimal, e.g., 0.03 for 3%)
 * @param age Current age of retiree
 * @returns COLA rate to apply (as decimal)
 */
export function getFERSCOLA(inflation: number, age: number): number {
  // No COLA for FERS retirees under 62
  if (age < 62) return 0;

  // Full COLA if inflation under 2%
  if (inflation <= 0.02) return inflation;

  // 2% if inflation between 2-3%
  if (inflation <= 0.03) return 0.02;

  // CPI - 1% if inflation over 3%
  return inflation - 0.01;
}

/**
 * CSRS Basic Benefit Calculation
 *
 * CSRS uses a more generous graduated formula:
 * - 1.5% × High-3 × first 5 years of service
 * - 1.75% × High-3 × next 5 years of service (years 6-10)
 * - 2.0% × High-3 × all years over 10
 *
 * Maximum benefit is capped at 80% of High-3.
 *
 * @param yearsOfService Total years of creditable federal service
 * @param high3 Average of highest 3 consecutive years of basic pay
 * @returns Annual pension amount
 */
export function calculateCSRSBasicBenefit(
  yearsOfService: number,
  high3: number
): number {
  let benefit = 0;

  // First 5 years at 1.5%
  const first5 = Math.min(yearsOfService, 5);
  benefit += first5 * high3 * 0.015;

  // Years 6-10 at 1.75%
  if (yearsOfService > 5) {
    const next5 = Math.min(yearsOfService - 5, 5);
    benefit += next5 * high3 * 0.0175;
  }

  // Years 11+ at 2.0%
  if (yearsOfService > 10) {
    const remaining = yearsOfService - 10;
    benefit += remaining * high3 * 0.02;
  }

  // Cap at 80% of High-3
  const maxBenefit = high3 * 0.80;
  return Math.min(benefit, maxBenefit);
}

/**
 * CSRS Retirement Eligibility
 *
 * Immediate retirement:
 * - Age 62 with 5+ years
 * - Age 60 with 20+ years
 * - Age 55 with 30+ years
 *
 * Early retirement (voluntary):
 * - Age 50 with 20+ years, or any age with 25+ years (reduced 2% per year under 55)
 */
export interface CSRSEligibilityResult {
  eligible: boolean;
  reductionPercent: number;
  message: string;
}

export function checkCSRSEligibility(
  age: number,
  yearsOfService: number
): CSRSEligibilityResult {
  // Age 62 with 5+ years - full benefit
  if (age >= 62 && yearsOfService >= 5) {
    return { eligible: true, reductionPercent: 0, message: 'Full retirement at 62 with 5+ years' };
  }

  // Age 60 with 20+ years - full benefit
  if (age >= 60 && yearsOfService >= 20) {
    return { eligible: true, reductionPercent: 0, message: 'Full retirement at 60 with 20+ years' };
  }

  // Age 55 with 30+ years - full benefit
  if (age >= 55 && yearsOfService >= 30) {
    return { eligible: true, reductionPercent: 0, message: 'Full retirement at 55 with 30+ years' };
  }

  // Early retirement: Age 50 with 20+ years, or any age with 25+ years
  if ((age >= 50 && yearsOfService >= 20) || yearsOfService >= 25) {
    const yearsUnder55 = Math.max(0, 55 - age);
    const reduction = yearsUnder55 * 2;
    return {
      eligible: true,
      reductionPercent: Math.min(reduction, 10), // Cap reduction
      message: `Early retirement with ${reduction}% reduction`
    };
  }

  return { eligible: false, reductionPercent: 0, message: 'Not yet eligible for retirement' };
}

/**
 * CSRS COLA (Cost of Living Adjustment)
 *
 * CSRS retirees receive full CPI-based COLA regardless of age.
 * Calculated on the anniversary of retirement.
 *
 * @param inflation Annual inflation rate (as decimal, e.g., 0.03 for 3%)
 * @returns COLA rate to apply (same as inflation)
 */
export function getCSRSCOLA(inflation: number): number {
  return inflation;
}

/**
 * Calculate High-3 from salary history
 *
 * The High-3 is the average of the highest 3 consecutive years of basic pay.
 * For employees with less than 3 years, it's the average of their entire career.
 *
 * @param salaryHistory Array of annual salaries in chronological order
 * @returns High-3 average
 */
export function calculateHigh3(salaryHistory: number[]): number {
  if (salaryHistory.length === 0) return 0;
  if (salaryHistory.length < 3) {
    // Average of entire history if less than 3 years
    return salaryHistory.reduce((a, b) => a + b, 0) / salaryHistory.length;
  }

  // Find highest 3 consecutive years
  let maxAverage = 0;
  for (let i = 0; i <= salaryHistory.length - 3; i++) {
    const threeYearSum = salaryHistory[i] + salaryHistory[i + 1] + salaryHistory[i + 2];
    const average = threeYearSum / 3;
    maxAverage = Math.max(maxAverage, average);
  }

  return maxAverage;
}

/**
 * Estimate High-3 from current salary and expected years until retirement
 *
 * Projects future salary growth to estimate what High-3 will be at retirement.
 *
 * @param currentSalary Current annual salary
 * @param yearsUntilRetirement Years until planned retirement
 * @param salaryGrowthRate Annual salary growth rate (default 2%)
 * @returns Estimated High-3 at retirement
 */
export function estimateHigh3(
  currentSalary: number,
  yearsUntilRetirement: number,
  salaryGrowthRate: number = 0.02
): number {
  if (yearsUntilRetirement <= 0) return currentSalary;

  // Project salaries for the final 3 years before retirement
  const year1 = currentSalary * Math.pow(1 + salaryGrowthRate, yearsUntilRetirement - 2);
  const year2 = currentSalary * Math.pow(1 + salaryGrowthRate, yearsUntilRetirement - 1);
  const year3 = currentSalary * Math.pow(1 + salaryGrowthRate, yearsUntilRetirement);

  return (year1 + year2 + year3) / 3;
}

/**
 * Early Retirement Reduction for FERS MRA+10
 *
 * If retiring at MRA with 10-29 years of service, benefit is reduced:
 * - 5% for each year under age 62
 * - Can be avoided by postponing annuity commencement until age 62
 *
 * @param retirementAge Age at retirement
 * @returns Reduction factor (e.g., 0.75 for 25% reduction)
 */
export function getFERSEarlyReduction(retirementAge: number): number {
  if (retirementAge >= 62) return 1.0;

  const yearsUnder62 = 62 - retirementAge;
  const reductionPercent = Math.min(yearsUnder62 * 5, 25); // 5% per year, max 25%
  return 1 - (reductionPercent / 100);
}

/**
 * Summary of pension system differences
 */
export const PENSION_SYSTEM_COMPARISON = {
  FERS: {
    name: 'Federal Employees Retirement System',
    establishedYear: 1987,
    components: ['Basic Benefit (defined benefit)', 'Social Security', 'TSP (401k-like)'],
    basicBenefitFormula: '1% (or 1.1% at 62+/20yr) × High-3 × Years',
    cola: 'Reduced (CPI-1% if CPI > 3%)',
    socialSecurity: 'Yes, covered',
    supplement: 'FERS Supplement available until age 62',
    maxBenefit: 'No explicit cap (but practical limits based on years)',
  },
  CSRS: {
    name: 'Civil Service Retirement System',
    establishedYear: 1920,
    closedYear: 1987,
    components: ['Basic Benefit only (no SS, no TSP match)'],
    basicBenefitFormula: '1.5%×5yr + 1.75%×5yr + 2%×remaining',
    cola: 'Full CPI',
    socialSecurity: 'No, not covered',
    supplement: 'N/A (no SS to bridge to)',
    maxBenefit: '80% of High-3',
  },
};
