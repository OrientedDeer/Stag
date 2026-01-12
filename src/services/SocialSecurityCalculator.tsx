/**
 * Social Security Benefit Calculator
 *
 * This service implements the Social Security Administration's benefit calculation algorithm:
 * 1. Extract earnings history from simulation
 * 2. Index earnings to age-60 wage levels
 * 3. Select top 35 years of indexed earnings
 * 4. Calculate AIME (Average Indexed Monthly Earnings)
 * 5. Apply PIA formula with bend points
 * 6. Adjust for claiming age
 *
 * References:
 * - SSA AIME Calculation: https://www.ssa.gov/oact/cola/Benefits.html
 * - SSA Benefit Formula: https://www.ssa.gov/oact/cola/piaformula.html
 */

import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { WorkIncome } from '../components/Objects/Income/models';
import {
  getWageIndexFactor,
  getBendPoints,
  getWageBase,
  getClaimingAdjustment,
  getFRA,
  getEarningsTestLimit,
} from '../data/SocialSecurityData';

/**
 * Represents one year of earnings for Social Security calculation
 */
export interface EarningsRecord {
  year: number;
  amount: number;
}

/**
 * Result of AIME calculation with detailed breakdown
 */
export interface AIMECalculation {
  /** Top 35 years of earnings (may include zeros if < 35 years) */
  topEarnings: EarningsRecord[];
  /** Indexed earnings after wage indexing */
  indexedEarnings: number[];
  /** Average Indexed Monthly Earnings */
  aime: number;
  /** Primary Insurance Amount at Full Retirement Age */
  pia: number;
  /** Benefit amount after claiming age adjustment */
  adjustedBenefit: number;
  /** Age when claiming benefits */
  claimingAge: number;
  /** Bend points used in PIA calculation */
  bendPoints: { first: number; second: number };
  /** Year used for indexing (typically age 60) */
  indexYear: number;
}

/**
 * Result of Social Security earnings test calculation
 */
export interface EarningsTestResult {
  /** Original benefit amount before earnings test */
  originalBenefit: number;
  /** Reduced benefit amount after earnings test */
  reducedBenefit: number;
  /** Amount withheld due to earnings test */
  amountWithheld: number;
  /** Explanation of why test was or wasn't applied */
  reason: string;
  /** Whether earnings test was applied */
  appliesTest: boolean;
}

/**
 * Extract earnings from simulation history
 *
 * Combines all WorkIncome amounts per year and caps at SS wage base.
 * Only includes income marked as "earned_income" = "Yes".
 *
 * @param simulation Array of simulation years with income data
 * @param priorEarnings Optional earnings from before simulation started
 * @returns Array of earnings records sorted by year
 */
export function extractEarningsFromSimulation(
  simulation: SimulationYear[],
  priorEarnings?: EarningsRecord[]
): EarningsRecord[] {
  const earningsMap = new Map<number, number>();

  // Add prior earnings if provided
  if (priorEarnings) {
    priorEarnings.forEach(record => {
      earningsMap.set(record.year, record.amount);
    });
  }

  // Extract from simulation
  simulation.forEach(simYear => {
    let yearlyEarnings = 0;

    simYear.incomes.forEach(income => {
      // Only count WorkIncome with earned_income = "Yes"
      if (income instanceof WorkIncome && income.earned_income === 'Yes') {
        yearlyEarnings += income.getAnnualAmount(simYear.year);
      }
    });

    // Cap at SS wage base for the year
    const wageBase = getWageBase(simYear.year);
    const cappedEarnings = Math.min(yearlyEarnings, wageBase);

    if (cappedEarnings > 0) {
      earningsMap.set(simYear.year, cappedEarnings);
    }
  });

  // Convert to array and sort by year
  return Array.from(earningsMap.entries())
    .map(([year, amount]) => ({ year, amount }))
    .sort((a, b) => a.year - b.year);
}

/**
 * Apply SSA wage indexing to historical earnings
 *
 * Earnings are indexed to the year the worker turns 60 using the National Average Wage Index.
 * Earnings after age 60 are not indexed (use actual value).
 *
 * Formula: IndexedEarnings = ActualEarnings × (IndexYear Factor / EarningYear Factor)
 *
 * Example: Worker turns 60 in 2022, earned $40,000 in 2000
 * IndexedEarnings = $40,000 × (63795.13 / 32154.82) = $79,323
 *
 * @param earnings Earnings record to index
 * @param indexYear Year to index to (typically when worker turns 60)
 * @param wageGrowthRate Annual wage growth rate for projecting future factors (default: 0.025 = 2.5%)
 * @returns Indexed earnings amount
 */
export function applyWageIndexing(earnings: EarningsRecord, indexYear: number, wageGrowthRate: number = 0.025): number {
  // No indexing for earnings at or after index year
  if (earnings.year >= indexYear) {
    return earnings.amount;
  }

  const indexYearFactor = getWageIndexFactor(indexYear, wageGrowthRate);
  const earningYearFactor = getWageIndexFactor(earnings.year, wageGrowthRate);

  // Avoid division by zero
  if (earningYearFactor === 0) {
    return earnings.amount;
  }

  return earnings.amount * (indexYearFactor / earningYearFactor);
}

/**
 * Calculate Primary Insurance Amount (PIA) using SSA bend points formula
 *
 * PIA Formula (2024 example):
 * - 90% of first $1,174 of AIME
 * - 32% of AIME between $1,174 and $7,078
 * - 15% of AIME above $7,078
 *
 * Example: AIME = $5,000
 * PIA = (0.90 × $1,174) + (0.32 × ($5,000 - $1,174)) + (0.15 × 0)
 *     = $1,056.60 + $1,224.32 + $0
 *     = $2,280.92/month
 *
 * @param aime Average Indexed Monthly Earnings
 * @param year Year for bend points (typically year of eligibility, age 62)
 * @param wageGrowthRate Annual wage growth rate for projecting future bend points (default: 0.025 = 2.5%)
 * @returns Primary Insurance Amount (monthly benefit at FRA)
 */
export function calculatePIA(aime: number, year: number, wageGrowthRate: number = 0.025): number {
  const bendPoints = getBendPoints(year, wageGrowthRate);

  let pia = 0;

  // First bend point: 90% of AIME up to first threshold
  const firstPortion = Math.min(aime, bendPoints.first);
  pia += firstPortion * 0.90;

  // Second bend point: 32% of AIME between first and second threshold
  if (aime > bendPoints.first) {
    const secondPortion = Math.min(aime - bendPoints.first, bendPoints.second - bendPoints.first);
    pia += secondPortion * 0.32;
  }

  // Third portion: 15% of AIME above second threshold
  if (aime > bendPoints.second) {
    const thirdPortion = aime - bendPoints.second;
    pia += thirdPortion * 0.15;
  }

  // Round to nearest penny (SSA rounds down to nearest dime, but we'll use penny for accuracy)
  return Math.round(pia * 100) / 100;
}

/**
 * Apply claiming age adjustment to PIA
 *
 * Adjustment factors:
 * - Claiming before FRA: Permanent reduction (~6.67% per year)
 * - Claiming after FRA: Permanent increase (8% per year)
 * - Maximum benefit at age 70
 *
 * @param pia Primary Insurance Amount (at FRA)
 * @param claimingAge Age when claiming benefits (62-70)
 * @param birthYear Birth year for determining FRA
 * @returns Adjusted monthly benefit amount
 */
export function applyClaimingAdjustment(
  pia: number,
  claimingAge: number,
  birthYear?: number
): number {
  const fra = birthYear ? getFRA(birthYear) : 67;
  const adjustmentFactor = getClaimingAdjustment(claimingAge, fra);
  return Math.round(pia * adjustmentFactor * 100) / 100;
}

/**
 * Calculate Social Security benefits using the complete AIME/PIA algorithm
 *
 * Steps:
 * 1. Extract earnings from simulation history
 * 2. Index all earnings to age-60 wage levels
 * 3. Select top 35 years (pad with zeros if < 35 years)
 * 4. Calculate AIME (average of top 35 years / 12 months)
 * 5. Apply PIA formula with bend points
 * 6. Adjust for claiming age
 *
 * @param earningsHistory Array of annual earnings (can be from simulation or uploaded SSA data)
 * @param calculationYear Year of calculation (typically year when turning 62, or current year)
 * @param claimingAge Age when claiming benefits (62-70)
 * @param birthYear Optional birth year for FRA calculation
 * @param wageGrowthRate Annual wage growth rate for projecting future values (default: 0.025 = 2.5%)
 * @returns Complete AIME calculation with breakdown
 */
export function calculateAIME(
  earningsHistory: EarningsRecord[],
  calculationYear: number,
  claimingAge: number,
  birthYear?: number,
  wageGrowthRate: number = 0.025
): AIMECalculation {
  // Determine index year (year when worker turns 60)
  // If birthYear provided, calculate exact year; otherwise estimate from calculationYear
  let indexYear: number;
  if (birthYear) {
    indexYear = birthYear + 60;
  } else {
    // Estimate: If calculating at claiming age, worker turns 60 at (calculationYear - (claimingAge - 60))
    indexYear = calculationYear - (claimingAge - 60);
  }

  // Step 1: Index all earnings to age-60 wage levels
  const indexedRecords = earningsHistory.map(record => ({
    year: record.year,
    amount: record.amount,
    indexed: applyWageIndexing(record, indexYear, wageGrowthRate),
  }));

  // Step 2: Sort by indexed amount (descending) and take top 35 years
  const sortedIndexed = [...indexedRecords]
    .sort((a, b) => b.indexed - a.indexed)
    .slice(0, 35);

  // Step 3: Pad with zeros if less than 35 years
  const top35 = sortedIndexed.map(r => r.indexed);
  while (top35.length < 35) {
    top35.push(0);
  }

  // Step 4: Calculate AIME (sum of top 35 years / 420 months)
  const sumTop35 = top35.reduce((sum, val) => sum + val, 0);
  const aime = sumTop35 / 420; // 35 years × 12 months = 420

  // Step 5: Calculate PIA using bend points (with wage growth projection)
  const pia = calculatePIA(aime, calculationYear, wageGrowthRate);

  // Step 6: Apply claiming age adjustment
  const adjustedBenefit = applyClaimingAdjustment(pia, claimingAge, birthYear);

  // Get bend points used (with wage growth projection)
  const bendPoints = getBendPoints(calculationYear, wageGrowthRate);

  // Return detailed breakdown
  return {
    topEarnings: sortedIndexed.slice(0, Math.min(35, earningsHistory.length)).map(r => ({
      year: r.year,
      amount: r.amount,
    })),
    indexedEarnings: top35,
    aime: Math.round(aime * 100) / 100,
    pia: pia,
    adjustedBenefit: adjustedBenefit,
    claimingAge: claimingAge,
    bendPoints: bendPoints,
    indexYear: indexYear,
  };
}

/**
 * Helper function to calculate estimated monthly benefit from current earnings
 *
 * Simplified calculation assuming constant earnings from now until retirement.
 * Useful for quick estimates in UI.
 *
 * @param currentAge Current age
 * @param retirementAge Age planning to retire/claim
 * @param annualIncome Current annual income
 * @param birthYear Birth year for FRA calculation
 * @returns Estimated monthly Social Security benefit
 */
export function estimateBenefitFromCurrentIncome(
  currentAge: number,
  retirementAge: number,
  annualIncome: number,
  birthYear: number
): number {
  const currentYear = new Date().getFullYear();
  const yearsUntilRetirement = retirementAge - currentAge;

  // Build hypothetical earnings history
  const earnings: EarningsRecord[] = [];

  // Past: Assume they earned the same amount from age 22 to now (simplified)
  const yearsWorked = Math.max(0, currentAge - 22);
  for (let i = 0; i < yearsWorked; i++) {
    const year = currentYear - (yearsWorked - i);
    const wageBase = getWageBase(year);
    earnings.push({
      year: year,
      amount: Math.min(annualIncome, wageBase),
    });
  }

  // Future: Project same earnings until retirement
  for (let i = 0; i < yearsUntilRetirement; i++) {
    const year = currentYear + i;
    const wageBase = getWageBase(year);
    earnings.push({
      year: year,
      amount: Math.min(annualIncome, wageBase),
    });
  }

  // Calculate AIME
  const calculationYear = birthYear + 62; // Year of eligibility
  const result = calculateAIME(earnings, calculationYear, retirementAge, birthYear);

  return result.adjustedBenefit;
}

/**
 * Validate earnings record
 * Ensures earnings don't exceed SS wage base for the year
 */
export function validateEarningsRecord(record: EarningsRecord): boolean {
  const wageBase = getWageBase(record.year);
  return record.amount >= 0 && record.amount <= wageBase;
}

/**
 * Calculate work credits earned
 * Need 40 credits (10 years) to qualify for Social Security
 * Earn up to 4 credits per year based on earnings
 *
 * 2024: $1,730 per credit ($6,920 for 4 credits)
 */
export function calculateWorkCredits(earningsHistory: EarningsRecord[]): number {
  let totalCredits = 0;

  earningsHistory.forEach(record => {
    // Simplified: Each $1,730 of earnings = 1 credit (max 4 per year)
    // In reality, this threshold changes yearly
    const creditThreshold = 1730;
    const creditsThisYear = Math.min(4, Math.floor(record.amount / creditThreshold));
    totalCredits += creditsThisYear;
  });

  return totalCredits;
}

/**
 * Calculate Social Security benefit reduction due to earnings test
 *
 * When claiming benefits before Full Retirement Age (FRA) and continuing to work,
 * the SSA withholds benefits based on earned income:
 * - Before FRA: $1 withheld for every $2 earned above limit
 * - Year of FRA (before month): $1 withheld for every $3 earned above higher limit
 * - After FRA: No test applies
 *
 * Note: This is a simplified implementation. Withheld benefits are actually
 * recalculated and added back at FRA, but that logic is not yet implemented.
 *
 * TODO: Implement benefit recapture at FRA (withheld benefits are not lost)
 *
 * @param ssBenefit Annual Social Security benefit amount
 * @param earnedIncome Annual earned income (wages, salary, self-employment)
 * @param currentAge User's current age
 * @param fra Full Retirement Age (typically 67)
 * @param year Current simulation year
 * @param wageGrowthRate Wage growth rate for projecting future limits
 * @returns EarningsTestResult with reduced benefit and withholding details
 */
export function calculateEarningsTestReduction(
  ssBenefit: number,
  earnedIncome: number,
  currentAge: number,
  fra: number,
  year: number,
  wageGrowthRate: number = 0.025
): EarningsTestResult {
  // No test if at or after FRA
  if (currentAge >= fra) {
    return {
      originalBenefit: ssBenefit,
      reducedBenefit: ssBenefit,
      amountWithheld: 0,
      reason: 'No earnings test after Full Retirement Age',
      appliesTest: false
    };
  }

  // Get earnings limits for this year
  const limits = getEarningsTestLimit(year, wageGrowthRate);

  // Determine if this is the year user reaches FRA
  // Year of FRA is when you turn FRA during the year (age between fra-1 and fra)
  const yearOfFRA = currentAge >= (fra - 1) && currentAge < fra;

  // Select appropriate limit and withholding ratio
  const earningsLimit = yearOfFRA ? limits.yearOfFRA : limits.beforeFRA;
  const withholdingRatio = yearOfFRA ? 1/3 : 1/2;

  // Calculate excess earnings
  const excessEarnings = Math.max(0, earnedIncome - earningsLimit);

  if (excessEarnings === 0) {
    return {
      originalBenefit: ssBenefit,
      reducedBenefit: ssBenefit,
      amountWithheld: 0,
      reason: `Earned income below threshold ($${earningsLimit.toLocaleString()})`,
      appliesTest: false
    };
  }

  // Calculate withholding amount
  const amountWithheld = Math.min(ssBenefit, excessEarnings * withholdingRatio);
  const reducedBenefit = Math.max(0, ssBenefit - amountWithheld);

  const withholdingDescription = yearOfFRA
    ? '$1 for every $3 earned above limit (year of FRA)'
    : '$1 for every $2 earned above limit';

  return {
    originalBenefit: ssBenefit,
    reducedBenefit: reducedBenefit,
    amountWithheld: amountWithheld,
    reason: `Earnings test: ${withholdingDescription}. Earned $${earnedIncome.toLocaleString()}, limit $${earningsLimit.toLocaleString()}`,
    appliesTest: true
  };
}
