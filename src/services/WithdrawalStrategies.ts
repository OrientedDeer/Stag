/**
 * Withdrawal Strategy Calculations
 *
 * Three strategies for retirement withdrawals:
 * - Fixed Real: Initial withdrawal adjusted for inflation each year
 * - Percentage: Fixed % of current portfolio each year
 * - Guyton-Klinger: Dynamic with guardrails based on portfolio performance
 */

export interface WithdrawalResult {
  amount: number;           // How much to withdraw this year
  baseAmount: number;       // Base amount for tracking across years
  initialPortfolio: number; // Portfolio value at retirement (for Fixed Real)
}

export interface GuytonKlingerParams {
  currentPortfolio: number;
  baseWithdrawal: number;     // Last year's withdrawal (or initial if year 1)
  withdrawalRate: number;     // Target rate (e.g., 4 for 4%)
  inflationRate: number;      // e.g., 3 for 3%
  upperGuardrail?: number;    // Default 1.2 (20% above target rate)
  lowerGuardrail?: number;    // Default 0.8 (20% below target rate)
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
  yearsInRetirement: number
): WithdrawalResult {
  // Year 1 withdrawal (yearsInRetirement = 0)
  const initialWithdrawal = initialPortfolio * (withdrawalRate / 100);

  // Adjust for cumulative inflation
  // Year 0: initialWithdrawal * 1.0
  // Year 1: initialWithdrawal * (1 + inflation)
  // Year N: initialWithdrawal * (1 + inflation)^N
  const inflationMultiplier = Math.pow(1 + inflationRate / 100, yearsInRetirement);
  const amount = initialWithdrawal * inflationMultiplier;

  return {
    amount,
    baseAmount: initialWithdrawal, // Always the year-1 amount (not inflation-adjusted)
    initialPortfolio,
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
  };
}

/**
 * Guyton-Klinger Dynamic Withdrawal Strategy
 *
 * Starts with initial withdrawal like Fixed Real, then applies guardrails:
 *
 * Each year, check if current withdrawal rate has drifted from target:
 * - If rate > target * upperGuardrail (portfolio dropped): REDUCE withdrawal
 * - If rate < target * lowerGuardrail (portfolio grew): INCREASE withdrawal
 * - Otherwise: adjust for inflation only
 *
 * This balances between:
 * - Fixed Real's stability (inflation adjustments)
 * - Percentage's responsiveness (guardrail triggers)
 *
 * Default guardrails: 0.8 to 1.2 (±20% from target rate)
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
    isFirstYear,
  } = params;

  // First year of retirement: calculate initial withdrawal
  if (isFirstYear) {
    const initialWithdrawal = currentPortfolio * (withdrawalRate / 100);
    return {
      amount: initialWithdrawal,
      baseAmount: initialWithdrawal,
      initialPortfolio: currentPortfolio,
    };
  }

  // Calculate what rate our current withdrawal represents
  const currentWithdrawalRate = (baseWithdrawal / currentPortfolio) * 100;
  const targetRate = withdrawalRate;

  // Default: adjust for inflation
  let newWithdrawal = baseWithdrawal * (1 + inflationRate / 100);

  // Check guardrails
  if (currentWithdrawalRate > targetRate * upperGuardrail) {
    // Portfolio has dropped significantly - we're withdrawing too high a %
    // Reduce withdrawal (skip inflation adjustment, or even reduce)
    // The "prosperity rule" - cut back in bad times
    newWithdrawal = baseWithdrawal; // No inflation adjustment this year
  } else if (currentWithdrawalRate < targetRate * lowerGuardrail) {
    // Portfolio has grown significantly - we can withdraw more
    // The "capital preservation rule" - increase in good times
    newWithdrawal = baseWithdrawal * (1 + inflationRate / 100 * 1.5); // 150% of inflation
  }
  // else: normal case, just inflation adjustment (already set above)

  return {
    amount: newWithdrawal,
    baseAmount: newWithdrawal, // Track this year's withdrawal for next year
    initialPortfolio: currentPortfolio,
  };
}

/**
 * Main entry point for calculating withdrawal based on selected strategy
 */
export function calculateStrategyWithdrawal(
  strategy: 'Fixed Real' | 'Percentage' | 'Guyton Klinger',
  withdrawalRate: number,
  currentPortfolio: number,
  inflationRate: number,
  yearsInRetirement: number,
  previousWithdrawal?: WithdrawalResult
): WithdrawalResult {
  const isFirstYear = yearsInRetirement === 0;
  const initialPortfolio = previousWithdrawal?.initialPortfolio ?? currentPortfolio;
  const baseWithdrawal = previousWithdrawal?.baseAmount ?? (currentPortfolio * withdrawalRate / 100);

  switch (strategy) {
    case 'Fixed Real':
      return calculateFixedRealWithdrawal(
        initialPortfolio,
        withdrawalRate,
        inflationRate,
        yearsInRetirement
      );

    case 'Percentage':
      return calculatePercentageWithdrawal(currentPortfolio, withdrawalRate);

    case 'Guyton Klinger':
      return calculateGuytonKlingerWithdrawal({
        currentPortfolio,
        baseWithdrawal,
        withdrawalRate,
        inflationRate,
        isFirstYear,
      });

    default:
      // Fallback to percentage
      return calculatePercentageWithdrawal(currentPortfolio, withdrawalRate);
  }
}
