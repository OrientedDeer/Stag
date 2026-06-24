/**
 * Withdrawal Strategy Calculations
 *
 * Three strategies for retirement withdrawals:
 * - Fixed Real: Initial withdrawal adjusted for inflation each year
 * - Percentage: Fixed % of current portfolio each year
 * - Guyton-Klinger: Dynamic with guardrails based on portfolio performance
 */

// ============================================================================
// Constants
// ============================================================================

/** Default Guyton-Klinger upper guardrail (20% above target rate triggers capital preservation) */
const DEFAULT_GK_UPPER_GUARDRAIL = 1.2;

/** Default Guyton-Klinger lower guardrail (20% below target rate triggers prosperity increase) */
const DEFAULT_GK_LOWER_GUARDRAIL = 0.8;

/** Default adjustment percentage when guardrails are triggered (10% cut or increase) */
const DEFAULT_GK_ADJUSTMENT_PERCENT = 10;

/** Years until life expectancy threshold for capital preservation rule */
const GK_15_YEAR_RULE_THRESHOLD = 15;

// ============================================================================
// Types
// ============================================================================

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
  /**
   * Prior year's portfolio TOTAL return as a percent (e.g. -10 for -10%).
   * Drives the canonical GK "Withdrawal Rule" inflation freeze: the annual
   * inflation increase is skipped following a year with a negative total return,
   * but only while the current withdrawal rate is above the initial target rate.
   * Omit (undefined) to preserve legacy behavior (always inflation-adjust).
   */
  lastYearReturn?: number;
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
 * - Withdrawal Rule (down-year freeze): skip the annual inflation increase following
 *   a year with a negative total return, but only while the current withdrawal rate
 *   is ABOVE the initial target rate (when below target you can afford the raise).
 * - Normal: Adjust for inflation only
 *
 * Key behaviors:
 * - Adjustments are PERMANENT (become the new baseline for next year)
 * - Capital Preservation only applies if > 15 years until life expectancy
 * - Default guardrails: 0.8 to 1.2 (±20% from target rate)
 * - Default adjustment: 10% cut or increase
 *
 * NOTE: We deliberately do NOT implement the optional 6% inflation-cap variant of
 * the Withdrawal Rule (cap the annual raise at 6% rather than freezing it) — only
 * the canonical down-year freeze is modeled here.
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
    upperGuardrail = DEFAULT_GK_UPPER_GUARDRAIL,
    lowerGuardrail = DEFAULT_GK_LOWER_GUARDRAIL,
    adjustmentPercent = DEFAULT_GK_ADJUSTMENT_PERCENT,
    yearsRemaining,
    lastYearReturn,
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

  // Withdrawal Rule (down-year inflation freeze): canonical GK skips the annual
  // inflation increase following a year whose portfolio total return was negative,
  // but ONLY while the current withdrawal rate is above the initial target rate
  // (below target, the portfolio can comfortably absorb the raise). When
  // lastYearReturn is undefined we can't know the year was down, so we don't freeze.
  const freezeInflation =
    lastYearReturn !== undefined &&
    lastYearReturn < 0 &&
    currentWithdrawalRate > targetRate;
  const inflationMultiplier = freezeInflation ? 1 : 1 + inflationRate / 100;

  // Default: adjust for inflation only (or freeze it, per the Withdrawal Rule)
  let newWithdrawal = baseWithdrawal * inflationMultiplier;
  let guardrailTriggered: GuardrailTrigger = 'none';

  // Check guardrails
  if (currentWithdrawalRate > targetRate * upperGuardrail) {
    // Capital Preservation Rule: Portfolio has dropped significantly
    // Only apply if more than 15 years until life expectancy
    const canApplyCapitalPreservation = yearsRemaining === undefined || yearsRemaining > GK_15_YEAR_RULE_THRESHOLD;

    if (canApplyCapitalPreservation) {
      // CUT withdrawal by adjustmentPercent (default 10%)
      newWithdrawal = baseWithdrawal * (1 - adjustmentPercent / 100);
      guardrailTriggered = 'capital-preservation';
    } else {
      // Within 15 years of life expectancy - capital preservation is suppressed,
      // so fall back to a normal inflation adjustment (subject to the down-year
      // Withdrawal Rule freeze, which applies here since the rate is above target).
      newWithdrawal = baseWithdrawal * inflationMultiplier;
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

/** Result of a plan-anchored Guyton-Klinger guardrail evaluation. */
export interface GKGuardrailEvaluation {
  /** Which guardrail (if any) the plan's withdrawal rate breached this year. */
  guardrailTriggered: GuardrailTrigger;
  /** The plan's effective withdrawal rate (%) = plannedSpending / portfolio × 100. */
  planRate: number;
}

/**
 * Plan-anchored Guyton-Klinger guardrail DECISION (which guardrail the plan's
 * withdrawal rate crossed this year). It does NOT size the adjustment — the
 * caller does, because the canonical ±10% is 10% of the *withdrawal / total
 * spending*, but it must be absorbed by discretionary alone (you can't cut
 * fixed costs like housing). The caller therefore computes a dollar amount =
 * adjustmentPercent × total spending and applies it to discretionary; if a cut
 * exceeds available discretionary, the plan can't comply (a failure).
 *
 * Unlike {@link calculateGuytonKlingerWithdrawal} (a single inflation-tracked
 * withdrawal number used by the historical backtest), this evaluates the user's
 * itemized plan against the band:
 * - rate > center × upper, and the 15-year rule is satisfied (`yearsRemaining`
 *   undefined or > 15) → capital-preservation.
 * - rate > center × upper but within 15 years of life expectancy → none.
 * - rate < center × lower → prosperity.
 * - otherwise → none.
 *
 * Pure: no side effects.
 */
export function evaluateGuytonKlingerGuardrail(params: {
  plannedSpending: number;
  portfolio: number;
  withdrawalRate: number; // band center (configured initial rate, e.g. 4)
  upperGuardrail?: number;
  lowerGuardrail?: number;
  yearsRemaining?: number;
}): GKGuardrailEvaluation {
  const {
    plannedSpending,
    portfolio,
    withdrawalRate,
    upperGuardrail = DEFAULT_GK_UPPER_GUARDRAIL,
    lowerGuardrail = DEFAULT_GK_LOWER_GUARDRAIL,
    yearsRemaining,
  } = params;

  if (portfolio <= 0) {
    return { guardrailTriggered: 'none', planRate: 0 };
  }

  const planRate = (plannedSpending / portfolio) * 100;
  const center = withdrawalRate;

  if (planRate > center * upperGuardrail) {
    // Capital Preservation Rule — only applies with more than 15 years left.
    const canApplyCapitalPreservation = yearsRemaining === undefined || yearsRemaining > GK_15_YEAR_RULE_THRESHOLD;
    return { guardrailTriggered: canApplyCapitalPreservation ? 'capital-preservation' : 'none', planRate };
  }

  if (planRate < center * lowerGuardrail) {
    return { guardrailTriggered: 'prosperity', planRate };
  }

  return { guardrailTriggered: 'none', planRate };
}

/** How a Guyton-Klinger guardrail adjustment lands on discretionary spending. */
export interface GKDiscretionaryAdjustment {
  /** Multiply each discretionary expense by this (1 = no change). */
  ratio: number;
  /** The intended adjustment: adjustmentPercent% of TOTAL spending (canonical GK). */
  targetAdjustment: number;
  /** Dollars actually moved out of / into discretionary. */
  appliedAdjustment: number;
  /** Cut dollars that could NOT be absorbed by discretionary (cuts only). */
  shortfall: number;
  /** True when a cut needed more than the available discretionary — the plan can't comply. */
  failed: boolean;
}

/**
 * Size a Guyton-Klinger guardrail adjustment and land it on discretionary.
 *
 * Canonical GK moves the WITHDRAWAL (≈ total spending) by `adjustmentPercent`%.
 * In this app the only flexible spending is discretionary (fixed costs — housing,
 * debt — can't be cut), so the full dollar move comes out of (cut) or goes into
 * (boost) discretionary:
 * - cut needs `targetAdjustment` removed from discretionary; if that exceeds the
 *   discretionary available, only what's there is cut and the remainder is a
 *   `shortfall` → `failed` (you can't reduce spending enough to preserve capital).
 * - boost adds `targetAdjustment` to discretionary (never fails).
 *
 * Returns a `ratio` to scale each discretionary expense by. Pure.
 */
export function computeGKDiscretionaryAdjustment(params: {
  guardrailTriggered: GuardrailTrigger;
  totalSpending: number;
  discretionary: number;
  adjustmentPercent?: number;
}): GKDiscretionaryAdjustment {
  const {
    guardrailTriggered,
    totalSpending,
    discretionary,
    adjustmentPercent = DEFAULT_GK_ADJUSTMENT_PERCENT,
  } = params;

  if (guardrailTriggered === 'none') {
    return { ratio: 1, targetAdjustment: 0, appliedAdjustment: 0, shortfall: 0, failed: false };
  }

  const targetAdjustment = (adjustmentPercent / 100) * totalSpending;
  const isCut = guardrailTriggered === 'capital-preservation';
  const appliedAdjustment = isCut ? Math.min(targetAdjustment, discretionary) : targetAdjustment;
  const shortfall = isCut ? targetAdjustment - appliedAdjustment : 0;
  const failed = shortfall > 0.5;
  const newDiscretionary = isCut ? discretionary - appliedAdjustment : discretionary + appliedAdjustment;
  const ratio = discretionary > 0 ? newDiscretionary / discretionary : 1;

  return { ratio, targetAdjustment, appliedAdjustment, shortfall, failed };
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
  /** Prior year's portfolio total return (%) for the GK Withdrawal Rule down-year freeze. */
  lastYearReturn?: number;
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
    lastYearReturn,
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
        lastYearReturn,
        isFirstYear,
      });

    default:
      // Fallback to percentage
      return calculatePercentageWithdrawal(portfolio, rate);
  }
}
