/**
 * Withdrawal Strategy Calculations
 *
 * Three strategies for retirement withdrawals:
 * - Fixed Real: Initial withdrawal adjusted for inflation each year
 * - Percentage: Fixed % of current portfolio each year
 * - Guyton-Klinger: Dynamic with guardrails based on portfolio performance
 */

export type GuardrailTrigger = 'none' | 'capital-preservation' | 'prosperity';

export interface WithdrawalResult {
  amount: number;           // How much to withdraw this year
  baseAmount: number;       // Base amount for tracking across years
  initialPortfolio: number; // Portfolio value at retirement (for Fixed Real)
  // Guyton-Klinger guardrail state
  guardrailTriggered: GuardrailTrigger;
  targetWithdrawalRate: number;   // The initial target rate (e.g., 4%)
  currentWithdrawalRate: number;  // What the withdrawal actually represents as % of portfolio
}

export interface GuytonKlingerParams {
  currentPortfolio: number;
  baseWithdrawal: number;     // Last year's withdrawal (or initial if year 1)
  withdrawalRate: number;     // Target rate (e.g., 4 for 4%)
  inflationRate: number;      // e.g., 3 for 3%
  upperGuardrail?: number;    // Default 1.2 (20% above target rate)
  lowerGuardrail?: number;    // Default 0.8 (20% below target rate)
  adjustmentPercent?: number; // Default 10 (10% cut/increase when guardrails trigger)
  yearsRemaining?: number;    // Years until life expectancy (for 15-year rule)
  isFirstYear: boolean;       // If true, calculate initial withdrawal
}

/**
 * Fixed Real Withdrawal Strategy
 *
 * Year 1: Withdraw initialPortfolio * (rate/100)
 * Year N: Same dollar amount adjusted for cumulative inflation
 *
 * Provides stable, predictable income that maintains purchasing power.
 */
export function calculateFixedRealWithdrawal(
  initialPortfolio: number,
  withdrawalRate: number,
  inflationRate: number,
  yearsInRetirement: number,
  currentPortfolio?: number
): WithdrawalResult {
  // Year 1 withdrawal (yearsInRetirement = 0)
  const initialWithdrawal = initialPortfolio * (withdrawalRate / 100);

  // Adjust for cumulative inflation
  // Year 0: initialWithdrawal * 1.0
  // Year 1: initialWithdrawal * (1 + inflation)
  // Year N: initialWithdrawal * (1 + inflation)^N
  const inflationMultiplier = Math.pow(1 + inflationRate / 100, yearsInRetirement);
  const amount = initialWithdrawal * inflationMultiplier;

  // Calculate current withdrawal rate for reporting
  const portfolioForRate = currentPortfolio ?? initialPortfolio;
  const currentWithdrawalRate = portfolioForRate > 0 ? (amount / portfolioForRate) * 100 : 0;

  return {
    amount,
    baseAmount: initialWithdrawal, // Always the year-1 amount (not inflation-adjusted)
    initialPortfolio,
    guardrailTriggered: 'none',
    targetWithdrawalRate: withdrawalRate,
    currentWithdrawalRate,
  };
}

/**
 * Percentage Withdrawal Strategy
 *
 * Each year: Withdraw currentPortfolio * (rate/100)
 *
 * Automatically adjusts to portfolio performance:
 * - Portfolio grows → higher withdrawals
 * - Portfolio shrinks → lower withdrawals
 *
 * Never depletes portfolio (mathematically), but income is variable.
 */
export function calculatePercentageWithdrawal(
  currentPortfolio: number,
  withdrawalRate: number
): WithdrawalResult {
  const amount = currentPortfolio * (withdrawalRate / 100);

  return {
    amount,
    baseAmount: amount, // For percentage, base = current (no tracking needed)
    initialPortfolio: currentPortfolio,
    guardrailTriggered: 'none',
    targetWithdrawalRate: withdrawalRate,
    currentWithdrawalRate: withdrawalRate, // For percentage, always equals target
  };
}

/**
 * Guyton-Klinger Dynamic Withdrawal Strategy
 *
 * Based on the actual Guyton-Klinger rules from financial research:
 * - Capital Preservation Rule (bad markets): Cut withdrawal by 10% when rate > target * 1.2
 * - Prosperity Rule (good markets): Increase withdrawal by 10% when rate < target * 0.8
 * - Normal: Adjust for inflation only
 *
 * Key behaviors:
 * - Adjustments are PERMANENT (become the new baseline for next year)
 * - Capital Preservation only applies if > 15 years until life expectancy
 * - Default guardrails: 0.8 to 1.2 (±20% from target rate)
 * - Default adjustment: 10% cut or increase
 *
 * Sources:
 * - White Coat Investor: https://www.whitecoatinvestor.com/guyton-klinger-guardrails-approach-for-retirement/
 * - Retirement Researcher: https://retirementresearcher.com/original-retirement-spending-decision-rules/
 */
export function calculateGuytonKlingerWithdrawal(
  params: GuytonKlingerParams
): WithdrawalResult {
  const {
    currentPortfolio,
    baseWithdrawal,
    withdrawalRate,
    inflationRate,
    upperGuardrail = 1.2,
    lowerGuardrail = 0.8,
    adjustmentPercent = 10,
    yearsRemaining,
    isFirstYear,
  } = params;

  // First year of retirement: calculate initial withdrawal
  if (isFirstYear) {
    const initialWithdrawal = currentPortfolio * (withdrawalRate / 100);
    return {
      amount: initialWithdrawal,
      baseAmount: initialWithdrawal,
      initialPortfolio: currentPortfolio,
      guardrailTriggered: 'none',
      targetWithdrawalRate: withdrawalRate,
      currentWithdrawalRate: withdrawalRate,
    };
  }

  // Calculate what rate our current withdrawal represents
  const currentWithdrawalRate = currentPortfolio > 0
    ? (baseWithdrawal / currentPortfolio) * 100
    : 0;
  const targetRate = withdrawalRate;

  // Default: adjust for inflation only
  let newWithdrawal = baseWithdrawal * (1 + inflationRate / 100);
  let guardrailTriggered: GuardrailTrigger = 'none';

  // Check guardrails
  if (currentWithdrawalRate > targetRate * upperGuardrail) {
    // Capital Preservation Rule: Portfolio has dropped significantly
    // Only apply if more than 15 years until life expectancy
    const canApplyCapitalPreservation = yearsRemaining === undefined || yearsRemaining > 15;

    if (canApplyCapitalPreservation) {
      // CUT withdrawal by adjustmentPercent (default 10%)
      newWithdrawal = baseWithdrawal * (1 - adjustmentPercent / 100);
      guardrailTriggered = 'capital-preservation';
    } else {
      // Within 15 years of life expectancy - just inflation adjust
      newWithdrawal = baseWithdrawal * (1 + inflationRate / 100);
    }
  } else if (currentWithdrawalRate < targetRate * lowerGuardrail) {
    // Prosperity Rule: Portfolio has grown significantly
    // INCREASE withdrawal by adjustmentPercent (default 10%)
    newWithdrawal = baseWithdrawal * (1 + adjustmentPercent / 100);
    guardrailTriggered = 'prosperity';
  }
  // else: normal case, just inflation adjustment (already set above)

  // Calculate the new withdrawal rate after adjustment
  const newWithdrawalRate = currentPortfolio > 0
    ? (newWithdrawal / currentPortfolio) * 100
    : 0;

  return {
    amount: newWithdrawal,
    baseAmount: newWithdrawal, // Adjustment becomes the new baseline for next year
    initialPortfolio: currentPortfolio,
    guardrailTriggered,
    targetWithdrawalRate: targetRate,
    currentWithdrawalRate: newWithdrawalRate,
  };
}

/**
 * Extended parameters for withdrawal calculation
 */
export interface WithdrawalParams {
  strategy: 'Fixed Real' | 'Percentage' | 'Guyton Klinger';
  withdrawalRate: number;
  currentPortfolio: number;
  inflationRate: number;
  yearsInRetirement: number;
  previousWithdrawal?: WithdrawalResult;
  // Guyton-Klinger specific
  gkUpperGuardrail?: number;
  gkLowerGuardrail?: number;
  gkAdjustmentPercent?: number;
  yearsRemaining?: number;  // Years until life expectancy
}

/**
 * Main entry point for calculating withdrawal based on selected strategy
 */
export function calculateStrategyWithdrawal(
  strategyOrParams: 'Fixed Real' | 'Percentage' | 'Guyton Klinger' | WithdrawalParams,
  withdrawalRate?: number,
  currentPortfolio?: number,
  inflationRate?: number,
  yearsInRetirement?: number,
  previousWithdrawal?: WithdrawalResult
): WithdrawalResult {
  // Support both old signature and new params object
  let params: WithdrawalParams;

  if (typeof strategyOrParams === 'object') {
    params = strategyOrParams;
  } else {
    params = {
      strategy: strategyOrParams,
      withdrawalRate: withdrawalRate!,
      currentPortfolio: currentPortfolio!,
      inflationRate: inflationRate!,
      yearsInRetirement: yearsInRetirement!,
      previousWithdrawal,
    };
  }

  const {
    strategy,
    withdrawalRate: rate,
    currentPortfolio: portfolio,
    inflationRate: inflation,
    yearsInRetirement: years,
    previousWithdrawal: prevWithdrawal,
    gkUpperGuardrail,
    gkLowerGuardrail,
    gkAdjustmentPercent,
    yearsRemaining,
  } = params;

  const isFirstYear = years === 0;
  const initialPortfolio = prevWithdrawal?.initialPortfolio ?? portfolio;
  const baseWithdrawal = prevWithdrawal?.baseAmount ?? (portfolio * rate / 100);

  switch (strategy) {
    case 'Fixed Real':
      return calculateFixedRealWithdrawal(
        initialPortfolio,
        rate,
        inflation,
        years,
        portfolio
      );

    case 'Percentage':
      return calculatePercentageWithdrawal(portfolio, rate);

    case 'Guyton Klinger':
      return calculateGuytonKlingerWithdrawal({
        currentPortfolio: portfolio,
        baseWithdrawal,
        withdrawalRate: rate,
        inflationRate: inflation,
        upperGuardrail: gkUpperGuardrail,
        lowerGuardrail: gkLowerGuardrail,
        adjustmentPercent: gkAdjustmentPercent,
        yearsRemaining,
        isFirstYear,
      });

    default:
      // Fallback to percentage
      return calculatePercentageWithdrawal(portfolio, rate);
  }
}
