/**
 * Financial Ratio Analysis Service
 *
 * Calculates key financial health ratios with benchmarks and ratings.
 */

import { type SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { type AnyAccount, SavedAccount, InvestedAccount, DebtAccount, DeficitDebtAccount } from '../components/Objects/Accounts/models';

// ============================================================================
// Constants - Rating Thresholds
// ============================================================================

/** Savings rate thresholds (percentage of income) */
const SAVINGS_RATE_EXCELLENT = 0.20;
const SAVINGS_RATE_GOOD = 0.15;
const SAVINGS_RATE_FAIR = 0.10;

/** Emergency fund thresholds (months of expenses) */
const EMERGENCY_FUND_EXCELLENT = 6;
const EMERGENCY_FUND_GOOD = 3;
const EMERGENCY_FUND_FAIR = 1;
const EMERGENCY_FUND_POOR = 0.5;

/** Debt-to-income ratio thresholds */
const DEBT_TO_INCOME_EXCELLENT = 0.20;
const DEBT_TO_INCOME_GOOD = 0.36;
const DEBT_TO_INCOME_FAIR = 0.43;
const DEBT_TO_INCOME_POOR = 0.50;

/** Debt-to-asset ratio thresholds */
const DEBT_TO_ASSET_EXCELLENT = 0.20;
const DEBT_TO_ASSET_GOOD = 0.30;
const DEBT_TO_ASSET_FAIR = 0.50;
const DEBT_TO_ASSET_POOR = 0.80;

/** Net worth to income age-based targets (Fidelity rule of thumb) */
const NET_WORTH_AGE_TARGETS: [number, number][] = [
  [25, 0.5],
  [30, 1],
  [35, 2],
  [40, 3],
  [45, 4],
  [50, 6],
  [55, 7],
  [60, 8],
  [67, 10],
];

/** Investment allocation thresholds (percentage of total assets) */
const INVESTMENT_ALLOCATION_EXCELLENT = 0.60;
const INVESTMENT_ALLOCATION_GOOD = 0.40;
const INVESTMENT_ALLOCATION_FAIR = 0.20;
const INVESTMENT_ALLOCATION_POOR = 0.10;

/** Growth rate thresholds */
const GROWTH_RATE_EXCELLENT = 0.15;
const GROWTH_RATE_GOOD = 0.08;
const GROWTH_RATE_FAIR = 0.03;

/** Number of months in a year (for monthly expense calculations) */
const MONTHS_PER_YEAR = 12;

// ============================================================================
// Types
// ============================================================================

// Rating levels for benchmarks
export type RatingLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

export interface RatioResult {
  value: number;
  rating: RatingLevel;
  benchmark: string;
  description: string;
}

export interface FinancialRatios {
  // Income & Savings (pre-retirement) / Retirement Spending (post-retirement)
  savingsRate: RatioResult;
  expenseRatio: RatioResult;

  // Retirement-specific
  withdrawalRate: RatioResult | null;
  portfolioYears: RatioResult | null;

  // Liquidity
  emergencyFundMonths: RatioResult;
  liquidityRatio: RatioResult;

  // Debt
  debtToIncomeRatio: RatioResult;
  debtToAssetRatio: RatioResult;

  // Wealth
  netWorthToIncomeRatio: RatioResult;
  investmentAllocation: RatioResult;

  // Growth (requires multiple years)
  netWorthGrowthRate: RatioResult | null;
  assetGrowthRate: RatioResult | null;

  // Context
  isRetired: boolean;
}

export interface RatioTrend {
  year: number;
  savingsRate: number;
  debtToIncome: number;
  netWorth: number;
  emergencyFundMonths: number;
}

/**
 * Get total liquid assets (savings accounts)
 */
function getLiquidAssets(accounts: AnyAccount[]): number {
  return accounts
    .filter((acc): acc is SavedAccount => acc instanceof SavedAccount)
    .reduce((sum, acc) => sum + acc.amount, 0);
}

/**
 * Get total invested assets
 */
function getInvestedAssets(accounts: AnyAccount[]): number {
  return accounts
    .filter((acc): acc is InvestedAccount => acc instanceof InvestedAccount)
    .reduce((sum, acc) => sum + acc.amount, 0);
}

/**
 * Get total debt
 */
function getTotalDebt(accounts: AnyAccount[]): number {
  return accounts
    .filter((acc): acc is DebtAccount | DeficitDebtAccount =>
      acc instanceof DebtAccount || acc instanceof DeficitDebtAccount
    )
    .reduce((sum, acc) => sum + acc.amount, 0);
}

/**
 * Get total assets (excluding debt)
 */
function getTotalAssets(accounts: AnyAccount[]): number {
  return accounts
    .filter(acc => !(acc instanceof DebtAccount) && !(acc instanceof DeficitDebtAccount))
    .reduce((sum, acc) => sum + acc.amount, 0);
}

/**
 * Get net worth
 */
function getNetWorth(accounts: AnyAccount[]): number {
  return getTotalAssets(accounts) - getTotalDebt(accounts);
}

/**
 * Rate savings rate (target: 15%+)
 * Common advice: Save at least 10-15% of income
 */
export function rateSavingsRate(rate: number): RatingLevel {
  if (rate >= SAVINGS_RATE_EXCELLENT) return 'excellent';
  if (rate >= SAVINGS_RATE_GOOD) return 'good';
  if (rate >= SAVINGS_RATE_FAIR) return 'fair';
  if (rate >= 0) return 'poor';
  return 'critical';
}

/**
 * Rate emergency fund (target: 3-6 months)
 * Common advice: 3 months minimum, 6+ for stability
 */
export function rateEmergencyFund(months: number): RatingLevel {
  if (months >= EMERGENCY_FUND_EXCELLENT) return 'excellent';
  if (months >= EMERGENCY_FUND_GOOD) return 'good';
  if (months >= EMERGENCY_FUND_FAIR) return 'fair';
  if (months >= EMERGENCY_FUND_POOR) return 'poor';
  return 'critical';
}

/**
 * Rate debt-to-income ratio (target: <36%)
 */
export function rateDebtToIncome(ratio: number): RatingLevel {
  if (ratio <= DEBT_TO_INCOME_EXCELLENT) return 'excellent';
  if (ratio <= DEBT_TO_INCOME_GOOD) return 'good';
  if (ratio <= DEBT_TO_INCOME_FAIR) return 'fair';
  if (ratio <= DEBT_TO_INCOME_POOR) return 'poor';
  return 'critical';
}

/**
 * Rate debt-to-asset ratio (target: <30%)
 */
export function rateDebtToAsset(ratio: number): RatingLevel {
  if (ratio <= DEBT_TO_ASSET_EXCELLENT) return 'excellent';
  if (ratio <= DEBT_TO_ASSET_GOOD) return 'good';
  if (ratio <= DEBT_TO_ASSET_FAIR) return 'fair';
  if (ratio <= DEBT_TO_ASSET_POOR) return 'poor';
  return 'critical';
}

/**
 * Get the target net worth multiple for a given age using interpolation
 */
export function getNetWorthTarget(age: number): number {
  if (age <= NET_WORTH_AGE_TARGETS[0][0]) return NET_WORTH_AGE_TARGETS[0][1];
  if (age >= NET_WORTH_AGE_TARGETS[NET_WORTH_AGE_TARGETS.length - 1][0]) {
    return NET_WORTH_AGE_TARGETS[NET_WORTH_AGE_TARGETS.length - 1][1];
  }

  // Interpolate between nearest brackets
  for (let i = 0; i < NET_WORTH_AGE_TARGETS.length - 1; i++) {
    const [age1, target1] = NET_WORTH_AGE_TARGETS[i];
    const [age2, target2] = NET_WORTH_AGE_TARGETS[i + 1];
    if (age >= age1 && age <= age2) {
      const progress = (age - age1) / (age2 - age1);
      return target1 + progress * (target2 - target1);
    }
  }
  return 1;
}

/**
 * Rate net worth to income ratio based on age-appropriate targets
 * Uses Fidelity rule of thumb: 1x by 30, 3x by 40, 6x by 50, 10x by 67
 */
export function rateNetWorthToIncome(ratio: number, age?: number): RatingLevel {
  if (ratio < 0) return 'critical';

  const target = age !== undefined ? getNetWorthTarget(age) : 3;

  if (ratio >= target) return 'excellent';
  if (ratio >= target * 0.75) return 'good';
  if (ratio >= target * 0.50) return 'fair';
  return 'poor';
}

/**
 * Rate investment allocation (target: 40%+)
 * Higher is better for long-term wealth building
 */
export function rateInvestmentAllocation(ratio: number): RatingLevel {
  if (ratio >= INVESTMENT_ALLOCATION_EXCELLENT) return 'excellent';
  if (ratio >= INVESTMENT_ALLOCATION_GOOD) return 'good';
  if (ratio >= INVESTMENT_ALLOCATION_FAIR) return 'fair';
  if (ratio >= INVESTMENT_ALLOCATION_POOR) return 'poor';
  return 'critical';
}

/**
 * Rate growth rate, adjusted for whether values include inflation.
 * When inflation is not included (real returns), thresholds are lowered.
 */
export function rateGrowthRate(rate: number, inflationOffset: number = 0): RatingLevel {
  if (rate >= GROWTH_RATE_EXCELLENT + inflationOffset) return 'excellent';
  if (rate >= GROWTH_RATE_GOOD + inflationOffset) return 'good';
  if (rate >= GROWTH_RATE_FAIR + inflationOffset) return 'fair';
  if (rate >= inflationOffset) return 'poor';
  return 'critical';
}

// ============================================================================
// Retirement-specific rating functions
// ============================================================================

/**
 * Get sustainable withdrawal rate based on years remaining.
 * For 30+ years, the 4% rule applies. For shorter horizons, 1/N is safe.
 */
export function getSustainableRate(yearsRemaining: number): number {
  if (yearsRemaining <= 0) return 1.0;
  return Math.max(0.04, 1 / yearsRemaining);
}

/**
 * Rate withdrawal rate for retirees, scaled by years remaining.
 * With fewer years left, higher withdrawal rates are appropriate.
 */
export function rateWithdrawalRate(rate: number, yearsRemaining?: number): RatingLevel {
  const sustainable = getSustainableRate(yearsRemaining ?? 30);
  if (rate <= sustainable * 0.75) return 'excellent';
  if (rate <= sustainable * 1.05) return 'good';
  if (rate <= sustainable * 1.30) return 'fair';
  if (rate <= sustainable * 1.55) return 'poor';
  return 'critical';
}

/**
 * Rate savings rate for retirees
 * During retirement, breaking even or slight drawdown is expected
 */
export function rateRetirementSavingsRate(rate: number): RatingLevel {
  if (rate >= 0) return 'excellent';      // Building wealth in retirement
  if (rate >= -0.03) return 'good';       // Sustainable drawdown
  if (rate >= -0.05) return 'fair';       // Moderate drawdown
  if (rate >= -0.10) return 'poor';       // High drawdown
  return 'critical';                       // Rapid depletion
}

/**
 * Rate growth rate for retirees, adjusted for inflation mode.
 * Negative growth is expected during drawdown; preserving capital is excellent.
 */
export function rateRetirementGrowthRate(rate: number, inflationOffset: number = 0): RatingLevel {
  if (rate >= 0.05 + inflationOffset) return 'excellent';
  if (rate >= inflationOffset) return 'good';
  if (rate >= -0.03 + inflationOffset) return 'fair';
  if (rate >= -0.05 + inflationOffset) return 'poor';
  return 'critical';
}


/**
 * Rate portfolio longevity for retirees, scaled by years remaining.
 * Hybrid: relative to life expectancy with absolute floor (25 yrs = at least fair).
 */
export function ratePortfolioYears(years: number, yearsRemaining?: number): RatingLevel {
  const yrs = Math.max(1, yearsRemaining ?? 30);
  if (years >= yrs * 1.5) return 'excellent';
  if (years >= yrs * 1.2) return 'good';
  // Absolute floor: 25+ years of coverage is never worse than "fair"
  if (years >= yrs || years >= 25) return 'fair';
  if (years >= yrs * 0.75 || years >= 20) return 'poor';
  return 'critical';
}

/**
 * Calculate all financial ratios for a simulation year
 */
export function calculateFinancialRatios(
  currentYear: SimulationYear,
  previousYear?: SimulationYear,
  age?: number,
  isRetired?: boolean,
  lifeExpectancy?: number,
  inflationAdjusted?: boolean,
  inflationRate?: number
): FinancialRatios {
  const { accounts, cashflow, taxDetails } = currentYear;
  const { totalIncome, totalExpense } = cashflow;
  const retired = isRetired ?? false;

  // Pre-retirement: base thresholds are nominal (15%/8%/3%).
  // When showing real returns, lower thresholds by inflation rate.
  const growthInflationOffset = (inflationAdjusted === false && inflationRate)
    ? -(inflationRate / 100)
    : 0;

  // Retirement: base thresholds are real (5%/0%/-3%/-5% = purchasing power terms).
  // When showing nominal values, raise thresholds by inflation rate (need to grow by
  // inflation just to maintain purchasing power).
  const retirementGrowthOffset = (inflationAdjusted !== false && inflationRate)
    ? (inflationRate / 100)
    : 0;

  // Calculate base values
  const liquidAssets = getLiquidAssets(accounts);
  const investedAssets = getInvestedAssets(accounts);
  const totalAssets = getTotalAssets(accounts);
  const totalDebt = getTotalDebt(accounts);
  const netWorth = getNetWorth(accounts);

  // Calculate living expenses (exclude taxes and payroll deductions)
  // These are costs you wouldn't have if unemployed
  const taxesAndDeductions = (taxDetails.fed || 0) +
    (taxDetails.state || 0) +
    (taxDetails.fica || 0) +
    (taxDetails.preTax || 0) +
    (taxDetails.insurance || 0) +
    (taxDetails.postTax || 0) +
    (taxDetails.capitalGains || 0);
  const livingExpenses = Math.max(0, totalExpense - taxesAndDeductions);
  const monthlyLivingExpenses = livingExpenses / MONTHS_PER_YEAR;

  // 1. Savings Rate = (Income - Expenses + Retirement Savings) / Income
  // 401k, HSA, and Roth 401k contributions are savings, not expenses
  const retirementSavings = (taxDetails.preTax || 0) + (taxDetails.postTax || 0);
  const savingsAmount = totalIncome - totalExpense + retirementSavings;
  const savingsRateValue = totalIncome > 0 ? savingsAmount / totalIncome : 0;

  // 2. Expense Ratio = (Expenses - Retirement Savings) / Income
  // Exclude 401k/HSA/Roth since those are savings, not spending
  const actualExpenses = totalExpense - retirementSavings;
  const expenseRatioValue = totalIncome > 0 ? actualExpenses / totalIncome : 1;

  // 3. Emergency Fund Months = Liquid Assets / Monthly Living Expenses
  const emergencyMonths = monthlyLivingExpenses > 0 ? liquidAssets / monthlyLivingExpenses : 0;

  // 4. Liquidity Ratio = Liquid Assets / Total Debt (if debt exists)
  const liquidityRatioValue = totalDebt > 0 ? liquidAssets / totalDebt : Infinity;

  // 5. Debt-to-Income Ratio = Total Debt / Annual Income
  const debtToIncomeValue = totalIncome > 0 ? totalDebt / totalIncome : 0;

  // 6. Debt-to-Asset Ratio = Total Debt / Total Assets
  const debtToAssetValue = totalAssets > 0 ? totalDebt / totalAssets : 0;

  // 7. Net Worth to Income Ratio
  const netWorthToIncomeValue = totalIncome > 0 ? netWorth / totalIncome : 0;

  // 8. Investment Allocation = Invested / Total Assets
  const investmentAllocationValue = totalAssets > 0 ? investedAssets / totalAssets : 0;

  // Retirement-specific metrics
  let withdrawalRate: RatioResult | null = null;
  let portfolioYears: RatioResult | null = null;

  if (retired) {
    const withdrawals = cashflow.withdrawals || 0;
    const yearsRemaining = (age !== undefined && lifeExpectancy !== undefined)
      ? Math.max(0, lifeExpectancy - age)
      : undefined;

    // Withdrawal Rate = withdrawals / total assets
    if (totalAssets > 0) {
      const withdrawalRateValue = withdrawals / totalAssets;
      const sustainable = getSustainableRate(yearsRemaining ?? 30);
      withdrawalRate = {
        value: withdrawalRateValue,
        rating: rateWithdrawalRate(withdrawalRateValue, yearsRemaining),
        benchmark: `<${Math.round(sustainable * 100)}% sustainable (${yearsRemaining ?? '~30'} yrs left)`,
        description: 'Annual portfolio withdrawal as percentage of assets',
      };
    }

    // Portfolio Years = net worth / annual living expenses
    if (livingExpenses > 0) {
      const yearsValue = netWorth / livingExpenses;
      const target = yearsRemaining ?? 30;
      const benchmarkText = yearsValue >= 55
        ? 'Consider increasing spending'
        : `${target}+ yrs needed, ${Math.round(target * 1.5)}+ excellent`;
      portfolioYears = {
        value: yearsValue,
        rating: ratePortfolioYears(yearsValue, yearsRemaining),
        benchmark: benchmarkText,
        description: 'Years of expenses your portfolio can sustain',
      };
    }
  }

  // Growth rates (require previous year)
  let netWorthGrowthRate: RatioResult | null = null;
  let assetGrowthRate: RatioResult | null = null;

  if (previousYear) {
    const prevNetWorth = getNetWorth(previousYear.accounts);
    const prevAssets = getTotalAssets(previousYear.accounts);

    // 9. Net Worth Growth Rate
    if (prevNetWorth > 0) {
      const nwGrowth = (netWorth - prevNetWorth) / prevNetWorth;
      const offset = retired ? retirementGrowthOffset : growthInflationOffset;
      const goodThreshold = Math.round((retired ? offset : 0.08 + offset) * 100);
      const excellentThreshold = Math.round((retired ? 0.05 + offset : 0.15 + offset) * 100);
      netWorthGrowthRate = {
        value: nwGrowth,
        rating: retired ? rateRetirementGrowthRate(nwGrowth, offset) : rateGrowthRate(nwGrowth, offset),
        benchmark: retired
          ? `${goodThreshold}%+ preserving, ${excellentThreshold}%+ growing`
          : `${goodThreshold}%+ good, ${excellentThreshold}%+ excellent`,
        description: 'Year-over-year change in net worth',
      };
    }

    // 10. Asset Growth Rate
    if (prevAssets > 0) {
      const assetGrowth = (totalAssets - prevAssets) / prevAssets;
      const offset = retired ? retirementGrowthOffset : growthInflationOffset;
      const goodThreshold = Math.round((retired ? offset : 0.08 + offset) * 100);
      const excellentThreshold = Math.round((retired ? 0.05 + offset : 0.15 + offset) * 100);
      assetGrowthRate = {
        value: assetGrowth,
        rating: retired ? rateRetirementGrowthRate(assetGrowth, offset) : rateGrowthRate(assetGrowth, offset),
        benchmark: retired
          ? `${goodThreshold}%+ preserving, ${excellentThreshold}%+ growing`
          : `${goodThreshold}%+ good, ${excellentThreshold}%+ excellent`,
        description: 'Year-over-year change in total assets',
      };
    }
  }

  return {
    savingsRate: {
      value: savingsRateValue,
      rating: retired ? rateRetirementSavingsRate(savingsRateValue) : rateSavingsRate(savingsRateValue),
      benchmark: retired ? '0%+ sustaining, >-3% sustainable' : '15%+ good, 20%+ excellent',
      description: retired ? 'Net income after expenses (drawdown rate)' : 'Percentage of income saved or invested',
    },
    expenseRatio: {
      value: expenseRatioValue,
      rating: retired ? rateRetirementSavingsRate(1 - expenseRatioValue) : rateSavingsRate(1 - expenseRatioValue),
      benchmark: retired ? '≤100% income covers expenses' : '<85% good, <80% excellent',
      description: retired ? 'Expenses relative to income (SS + pension + withdrawals)' : 'Percentage of income spent on expenses',
    },
    withdrawalRate,
    portfolioYears,
    emergencyFundMonths: {
      value: emergencyMonths,
      rating: rateEmergencyFund(emergencyMonths),
      benchmark: '3+ months good, 6+ excellent',
      description: 'Months of expenses covered by liquid savings',
    },
    liquidityRatio: {
      value: liquidityRatioValue,
      rating: liquidityRatioValue === Infinity ? 'excellent' : (liquidityRatioValue >= 1 ? 'good' : 'fair'),
      benchmark: '1.0+ means liquid assets cover debt',
      description: 'Liquid assets relative to total debt',
    },
    debtToIncomeRatio: {
      value: debtToIncomeValue,
      rating: rateDebtToIncome(debtToIncomeValue),
      benchmark: '<36% good, <20% excellent',
      description: 'Total debt relative to annual income',
    },
    debtToAssetRatio: {
      value: debtToAssetValue,
      rating: rateDebtToAsset(debtToAssetValue),
      benchmark: '<30% good, <20% excellent',
      description: 'Total debt relative to total assets',
    },
    netWorthToIncomeRatio: {
      value: netWorthToIncomeValue,
      rating: rateNetWorthToIncome(netWorthToIncomeValue, age),
      benchmark: age !== undefined
        ? `Target: ${getNetWorthTarget(age).toFixed(1)}x for age ${age}`
        : '1x by 30, 3x by 40, 10x by 67',
      description: 'Net worth as multiple of annual income',
    },
    investmentAllocation: {
      value: investmentAllocationValue,
      rating: rateInvestmentAllocation(investmentAllocationValue),
      benchmark: '40%+ good, 60%+ excellent',
      description: 'Percentage of assets in investments',
    },
    netWorthGrowthRate,
    assetGrowthRate,
    isRetired: retired,
  };
}

/**
 * Calculate ratio trends over multiple years
 */
export function calculateRatioTrends(simulation: SimulationYear[]): RatioTrend[] {
  return simulation.map((year) => {
    const { accounts, cashflow, taxDetails } = year;
    const liquidAssets = getLiquidAssets(accounts);

    // Calculate living expenses (exclude taxes and payroll deductions)
    const taxesAndDeductions = (taxDetails.fed || 0) +
      (taxDetails.state || 0) +
      (taxDetails.fica || 0) +
      (taxDetails.preTax || 0) +
      (taxDetails.insurance || 0) +
      (taxDetails.postTax || 0) +
      (taxDetails.capitalGains || 0);
    const livingExpenses = Math.max(0, cashflow.totalExpense - taxesAndDeductions);
    const monthlyLivingExpenses = livingExpenses / MONTHS_PER_YEAR;

    const retirementSavings = (taxDetails.preTax || 0) + (taxDetails.postTax || 0);

    return {
      year: year.year,
      savingsRate: cashflow.totalIncome > 0
        ? (cashflow.totalIncome - cashflow.totalExpense + retirementSavings) / cashflow.totalIncome
        : 0,
      debtToIncome: cashflow.totalIncome > 0
        ? getTotalDebt(accounts) / cashflow.totalIncome
        : 0,
      netWorth: getNetWorth(accounts),
      emergencyFundMonths: monthlyLivingExpenses > 0 ? liquidAssets / monthlyLivingExpenses : 0,
    };
  });
}

/**
 * Get color class for rating level
 */
export function getRatingColor(rating: RatingLevel): string {
  switch (rating) {
    case 'excellent': return 'text-positive';
    case 'good': return 'text-info';
    case 'fair': return 'text-warning';
    case 'poor': return 'text-cat-orange';
    case 'critical': return 'text-negative';
  }
}

/**
 * Get background color class for rating level
 */
export function getRatingBgColor(rating: RatingLevel): string {
  switch (rating) {
    case 'excellent': return 'bg-positive-soft/20 border-positive-soft/30';
    case 'good': return 'bg-info-tint/20 border-info-strong/30';
    case 'fair': return 'bg-warning-soft/20 border-warning-soft/30';
    case 'poor': return 'bg-cat-orange-soft/20 border-cat-orange-soft/30';
    case 'critical': return 'bg-negative-soft/20 border-negative-soft/30';
  }
}

/**
 * Get label for rating level
 */
export function getRatingLabel(rating: RatingLevel): string {
  switch (rating) {
    case 'excellent': return 'Excellent';
    case 'good': return 'Good';
    case 'fair': return 'Fair';
    case 'poor': return 'Needs Work';
    case 'critical': return 'Critical';
  }
}
