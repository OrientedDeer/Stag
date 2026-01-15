/**
 * Required Minimum Distribution (RMD) Data and Calculations
 *
 * Based on IRS Uniform Lifetime Table (Table III)
 * Used for account owners whose spouse is not more than 10 years younger
 * or is not the sole beneficiary.
 *
 * SECURE Act 2.0 (2023): RMD age increased to 73
 * Starting 2033: RMD age increases to 75
 */

// IRS Uniform Lifetime Table - Distribution Period by Age
// Source: IRS Publication 590-B (updated for 2022+)
const UNIFORM_LIFETIME_TABLE: Record<number, number> = {
  72: 27.4,
  73: 26.5,
  74: 25.5,
  75: 24.6,
  76: 23.7,
  77: 22.9,
  78: 22.0,
  79: 21.1,
  80: 20.2,
  81: 19.4,
  82: 18.5,
  83: 17.7,
  84: 16.8,
  85: 16.0,
  86: 15.2,
  87: 14.4,
  88: 13.7,
  89: 12.9,
  90: 12.2,
  91: 11.5,
  92: 10.8,
  93: 10.1,
  94: 9.5,
  95: 8.9,
  96: 8.4,
  97: 7.8,
  98: 7.3,
  99: 6.8,
  100: 6.4,
  101: 6.0,
  102: 5.6,
  103: 5.2,
  104: 4.9,
  105: 4.6,
  106: 4.3,
  107: 4.1,
  108: 3.9,
  109: 3.7,
  110: 3.5,
  111: 3.4,
  112: 3.3,
  113: 3.1,
  114: 3.0,
  115: 2.9,
  116: 2.8,
  117: 2.7,
  118: 2.5,
  119: 2.3,
  120: 2.0,
};

/**
 * Get the RMD starting age based on birth year
 * SECURE Act 2.0 rules:
 * - Born 1950 or earlier: Age 72
 * - Born 1951-1959: Age 73
 * - Born 1960 or later: Age 75 (starting 2033)
 */
export function getRMDStartAge(birthYear: number): number {
  if (birthYear <= 1950) {
    return 72;
  } else if (birthYear <= 1959) {
    return 73;
  } else {
    return 75;
  }
}

/**
 * Get the distribution period (life expectancy factor) for a given age
 * Returns the divisor used to calculate RMD amount
 */
export function getDistributionPeriod(age: number): number {
  // For ages below 72, no RMD required (but return a value for calculations)
  if (age < 72) {
    return UNIFORM_LIFETIME_TABLE[72];
  }

  // For ages above 120, use the 120 factor
  if (age > 120) {
    return UNIFORM_LIFETIME_TABLE[120];
  }

  return UNIFORM_LIFETIME_TABLE[age] ?? UNIFORM_LIFETIME_TABLE[120];
}

/**
 * Calculate the Required Minimum Distribution for a single account
 *
 * @param priorYearEndBalance - Account balance as of December 31 of prior year
 * @param age - Owner's age at end of current year
 * @returns RMD amount for the year
 */
export function calculateRMD(priorYearEndBalance: number, age: number): number {
  if (priorYearEndBalance <= 0 || age < 72) {
    return 0;
  }

  const distributionPeriod = getDistributionPeriod(age);
  return priorYearEndBalance / distributionPeriod;
}

/**
 * Check if an account type is subject to RMDs
 * Traditional accounts require RMDs; Roth accounts do not (during owner's lifetime)
 */
export function isAccountSubjectToRMD(taxType: string): boolean {
  return taxType === 'Traditional 401k' || taxType === 'Traditional IRA';
}

/**
 * Calculate the RMD penalty for failing to take the full distribution
 * SECURE Act 2.0 reduced the penalty from 50% to 25%
 * Can be further reduced to 10% if corrected within correction window
 */
export function calculateRMDPenalty(shortfall: number, correctedTimely: boolean = false): number {
  if (shortfall <= 0) return 0;

  const penaltyRate = correctedTimely ? 0.10 : 0.25;
  return shortfall * penaltyRate;
}

/**
 * Determine if RMDs are required for the given year based on age and birth year
 */
export function isRMDRequired(currentAge: number, birthYear: number): boolean {
  const rmdStartAge = getRMDStartAge(birthYear);
  return currentAge >= rmdStartAge;
}

export interface RMDCalculation {
  accountName: string;
  accountId: string;
  priorYearBalance: number;
  distributionPeriod: number;
  rmdAmount: number;
}

export interface RMDSummary {
  totalRMD: number;
  accountBreakdown: RMDCalculation[];
  rmdStartAge: number;
  currentAge: number;
  isRequired: boolean;
}
