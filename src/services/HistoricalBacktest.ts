/**
 * Historical Backtesting Engine
 *
 * Runs retirement scenarios against actual historical market data
 * to show which historical periods would have succeeded or failed.
 *
 * Now supports withdrawal strategies (Fixed Real, Percentage, Guyton-Klinger)
 * so the backtest reflects the user's selected strategy.
 */

import {
  INFLATION_RATES,
  AVAILABLE_YEARS,
  getBlendedReturn,
  NOTABLE_PERIODS,
} from '../data/HistoricalReturns';
import {
  calculateStrategyWithdrawal,
  WithdrawalResult,
  GuardrailTrigger,
} from './WithdrawalStrategies';

/**
 * Result of a single historical backtest starting in a specific year
 */
export interface BacktestResult {
  /** Year the retirement started */
  startYear: number;
  /** Year the simulation ended (either depleted or reached end) */
  endYear: number;
  /** Whether the portfolio lasted the entire period */
  succeeded: boolean;
  /** Final balance at end of simulation (0 if depleted early) */
  finalBalance: number;
  /** Lowest balance during the simulation */
  lowestBalance: number;
  /** Year when lowest balance occurred */
  lowestYear: number;
  /** Year portfolio was depleted (null if never) */
  yearOfDepletion: number | null;
  /** Inflation-adjusted final balance (in start-year dollars) */
  realFinalBalance: number;
  /** Array of yearly snapshots for detailed analysis */
  yearlySnapshots: YearlySnapshot[];
}

/**
 * Snapshot of portfolio state at end of each year
 */
export interface YearlySnapshot {
  year: number;
  balance: number;
  nominalReturn: number;
  inflation: number;
  withdrawal: number;
  /** For Guyton-Klinger: which guardrail was triggered this year */
  guardrailTriggered?: GuardrailTrigger;
}

/**
 * Configuration for historical backtest
 */
export interface BacktestConfig {
  /** Number of years in retirement */
  retirementYears: number;
  /** Starting portfolio balance */
  startingBalance: number;
  /** Annual withdrawal amount (in today's dollars) - used as base for strategies */
  annualWithdrawal: number;
  /** Stock allocation as decimal (0-1, e.g., 0.6 for 60% stocks) */
  stockAllocation: number;
  /** Whether to adjust withdrawals for inflation each year (for simple mode) */
  inflationAdjustedWithdrawals: boolean;
  /** Withdrawal strategy to use (defaults to inflation-adjusted fixed for backward compatibility) */
  withdrawalStrategy?: 'Fixed Real' | 'Percentage' | 'Guyton Klinger';
  /** Withdrawal rate as percentage (e.g., 4 for 4%) */
  withdrawalRate?: number;
  /** Guyton-Klinger upper guardrail (default 1.2) */
  gkUpperGuardrail?: number;
  /** Guyton-Klinger lower guardrail (default 0.8) */
  gkLowerGuardrail?: number;
  /** Guyton-Klinger adjustment percentage (default 10) */
  gkAdjustmentPercent?: number;
}

/**
 * Summary of all backtest results
 */
export interface BacktestSummary {
  /** All individual backtest results */
  results: BacktestResult[];
  /** Number of successful periods */
  successCount: number;
  /** Total number of periods tested */
  totalPeriods: number;
  /** Success rate as percentage */
  successRate: number;
  /** Best performing period */
  bestCase: BacktestResult;
  /** Worst performing period (among successes) */
  worstSuccess: BacktestResult | null;
  /** First failing period */
  worstCase: BacktestResult;
  /** Median final balance (among all periods) */
  medianFinalBalance: number;
  /** Average final balance */
  averageFinalBalance: number;
  /** Notable periods with descriptions */
  notablePeriods: Array<{
    result: BacktestResult;
    description: string;
  }>;
}

/**
 * Run a single historical backtest starting in a specific year
 */
export function runSingleBacktest(
  startYear: number,
  config: BacktestConfig
): BacktestResult | null {
  const {
    retirementYears,
    startingBalance,
    annualWithdrawal,
    stockAllocation,
    inflationAdjustedWithdrawals,
    withdrawalStrategy,
    withdrawalRate,
    gkUpperGuardrail = 1.2,
    gkLowerGuardrail = 0.8,
    gkAdjustmentPercent = 10,
  } = config;

  // Check if we have enough data for this period
  const endYear = startYear + retirementYears - 1;
  if (!AVAILABLE_YEARS.includes(startYear) || !AVAILABLE_YEARS.includes(endYear)) {
    return null;
  }

  let balance = startingBalance;
  let lowestBalance = startingBalance;
  let lowestYear = startYear;
  let yearOfDepletion: number | null = null;
  let cumulativeInflation = 1;
  const yearlySnapshots: YearlySnapshot[] = [];

  // For withdrawal strategy tracking
  let previousWithdrawalResult: WithdrawalResult | undefined;
  const useStrategy = withdrawalStrategy && withdrawalRate !== undefined;

  for (let i = 0; i < retirementYears; i++) {
    const year = startYear + i;

    // Get blended return for this year
    const nominalReturn = getBlendedReturn(year, stockAllocation);
    const inflation = INFLATION_RATES[year];

    if (nominalReturn === null || inflation === undefined) {
      return null; // Missing data
    }

    let withdrawal: number;
    let guardrailTriggered: GuardrailTrigger = 'none';

    if (useStrategy) {
      // Use the withdrawal strategy system
      const result = calculateStrategyWithdrawal({
        strategy: withdrawalStrategy!,
        withdrawalRate: withdrawalRate!,
        currentPortfolio: balance,
        inflationRate: inflation, // Use actual historical inflation
        yearsInRetirement: i,
        previousWithdrawal: previousWithdrawalResult,
        gkUpperGuardrail,
        gkLowerGuardrail,
        gkAdjustmentPercent,
        yearsRemaining: retirementYears - i, // For GK 15-year rule
      });

      withdrawal = result.amount;
      guardrailTriggered = result.guardrailTriggered;
      previousWithdrawalResult = result;
    } else {
      // Legacy mode: simple inflation-adjusted or fixed withdrawal
      withdrawal = inflationAdjustedWithdrawals
        ? annualWithdrawal * cumulativeInflation
        : annualWithdrawal;
    }

    // Apply return to balance (before withdrawal, like real market)
    balance = balance * (1 + nominalReturn / 100);

    // Subtract withdrawal
    balance = balance - withdrawal;

    // Track cumulative inflation for next year (legacy mode)
    cumulativeInflation = cumulativeInflation * (1 + inflation / 100);

    // Record snapshot
    yearlySnapshots.push({
      year,
      balance: Math.max(0, balance),
      nominalReturn,
      inflation,
      withdrawal,
      guardrailTriggered,
    });

    // Track lowest balance
    if (balance < lowestBalance) {
      lowestBalance = balance;
      lowestYear = year;
    }

    // Check for depletion
    if (balance <= 0) {
      yearOfDepletion = year;
      balance = 0;
      break;
    }
  }

  // Calculate real (inflation-adjusted) final balance
  const realFinalBalance = balance / cumulativeInflation;

  return {
    startYear,
    endYear: yearOfDepletion ?? endYear,
    succeeded: yearOfDepletion === null,
    finalBalance: Math.max(0, balance),
    lowestBalance: Math.max(0, lowestBalance),
    lowestYear,
    yearOfDepletion,
    realFinalBalance: Math.max(0, realFinalBalance),
    yearlySnapshots,
  };
}

/**
 * Run historical backtest across all available starting years
 */
export function runHistoricalBacktest(config: BacktestConfig): BacktestSummary {
  const { retirementYears } = config;
  const results: BacktestResult[] = [];

  // Find all valid starting years (need enough data for full retirement period)
  const maxStartYear = Math.max(...AVAILABLE_YEARS) - retirementYears + 1;
  const validStartYears = AVAILABLE_YEARS.filter(year => year <= maxStartYear);

  // Run backtest for each starting year
  for (const startYear of validStartYears) {
    const result = runSingleBacktest(startYear, config);
    if (result) {
      results.push(result);
    }
  }

  // Sort results by start year
  results.sort((a, b) => a.startYear - b.startYear);

  // Calculate statistics
  const successCount = results.filter(r => r.succeeded).length;
  const successRate = results.length > 0 ? (successCount / results.length) * 100 : 0;

  // Find best and worst cases
  const sortedByFinal = [...results].sort((a, b) => b.finalBalance - a.finalBalance);
  const bestCase = sortedByFinal[0];
  const worstCase = sortedByFinal[sortedByFinal.length - 1];

  // Find worst success (among successful periods)
  const successfulResults = results.filter(r => r.succeeded);
  const worstSuccess = successfulResults.length > 0
    ? successfulResults.sort((a, b) => a.finalBalance - b.finalBalance)[0]
    : null;

  // Calculate median and average
  const finalBalances = results.map(r => r.finalBalance).sort((a, b) => a - b);
  const medianFinalBalance = finalBalances.length > 0
    ? finalBalances[Math.floor(finalBalances.length / 2)]
    : 0;
  const averageFinalBalance = results.length > 0
    ? finalBalances.reduce((sum, b) => sum + b, 0) / results.length
    : 0;

  // Find notable periods
  const notablePeriods: Array<{ result: BacktestResult; description: string }> = [];

  for (const [, period] of Object.entries(NOTABLE_PERIODS)) {
    const result = results.find(r => r.startYear === period.year);
    if (result) {
      notablePeriods.push({
        result,
        description: period.description,
      });
    }
  }

  return {
    results,
    successCount,
    totalPeriods: results.length,
    successRate: Math.round(successRate * 10) / 10,
    bestCase,
    worstSuccess,
    worstCase,
    medianFinalBalance,
    averageFinalBalance,
    notablePeriods,
  };
}

/**
 * Get safe withdrawal rate for a given success rate target
 * Uses binary search to find the withdrawal rate that achieves the target success rate
 */
export function findSafeWithdrawalRate(
  startingBalance: number,
  retirementYears: number,
  stockAllocation: number,
  targetSuccessRate: number = 95,
  inflationAdjustedWithdrawals: boolean = true
): { withdrawalRate: number; annualWithdrawal: number } {
  let low = 0;
  let high = 0.15; // 15% max withdrawal rate
  let bestRate = 0;

  // Binary search for the highest withdrawal rate that achieves target success
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    const annualWithdrawal = startingBalance * mid;

    const summary = runHistoricalBacktest({
      retirementYears,
      startingBalance,
      annualWithdrawal,
      stockAllocation,
      inflationAdjustedWithdrawals,
    });

    if (summary.successRate >= targetSuccessRate) {
      bestRate = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  return {
    withdrawalRate: Math.round(bestRate * 1000) / 10, // As percentage with 1 decimal
    annualWithdrawal: startingBalance * bestRate,
  };
}

/**
 * Get the historical data range available for backtesting
 */
export function getBacktestDataRange(): { firstYear: number; lastYear: number; yearsAvailable: number } {
  return {
    firstYear: Math.min(...AVAILABLE_YEARS),
    lastYear: Math.max(...AVAILABLE_YEARS),
    yearsAvailable: AVAILABLE_YEARS.length,
  };
}
