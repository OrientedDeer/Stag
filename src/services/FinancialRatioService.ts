/**
 * Financial Ratio Analysis Service
 *
 * Calculates key financial health ratios with benchmarks and ratings.
 */

import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { AnyAccount, SavedAccount, InvestedAccount, DebtAccount, DeficitDebtAccount } from '../components/Objects/Accounts/models';

// Rating levels for benchmarks
export type RatingLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

export interface RatioResult {
  value: number;
  rating: RatingLevel;
  benchmark: string;
  description: string;
}

export interface FinancialRatios {
  // Income & Savings
  savingsRate: RatioResult;
  expenseRatio: RatioResult;

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
function rateSavingsRate(rate: number): RatingLevel {
  if (rate >= 0.20) return 'excellent';
  if (rate >= 0.15) return 'good';
  if (rate >= 0.10) return 'fair';
  if (rate >= 0) return 'poor';
  return 'critical';
}

/**
 * Rate emergency fund (target: 3-6 months)
 * Common advice: 3 months minimum, 6+ for stability
 */
function rateEmergencyFund(months: number): RatingLevel {
  if (months >= 6) return 'excellent';
  if (months >= 3) return 'good';
  if (months >= 1) return 'fair';
  if (months >= 0.5) return 'poor';
  return 'critical';
}

/**
 * Rate debt-to-income ratio (target: <36%)
 */
function rateDebtToIncome(ratio: number): RatingLevel {
  if (ratio <= 0.20) return 'excellent';
  if (ratio <= 0.36) return 'good';
  if (ratio <= 0.43) return 'fair';
  if (ratio <= 0.50) return 'poor';
  return 'critical';
}

/**
 * Rate debt-to-asset ratio (target: <30%)
 */
function rateDebtToAsset(ratio: number): RatingLevel {
  if (ratio <= 0.20) return 'excellent';
  if (ratio <= 0.30) return 'good';
  if (ratio <= 0.50) return 'fair';
  if (ratio <= 0.80) return 'poor';
  return 'critical';
}

/**
 * Rate net worth to income ratio (target: age-dependent, simplified)
 * Rule of thumb: 1x by 30, 3x by 40, 6x by 50, 10x by retirement
 * Adjusted to be more realistic - most people are behind these targets
 */
function rateNetWorthToIncome(ratio: number): RatingLevel {
  if (ratio >= 3) return 'excellent';  // On track for solid retirement
  if (ratio >= 1) return 'good';       // Ahead of most peers
  if (ratio >= 0.5) return 'fair';     // Building wealth
  if (ratio >= 0) return 'poor';       // Starting out
  return 'critical';                   // Negative net worth
}

/**
 * Rate investment allocation (target: 40%+)
 * Higher is better for long-term wealth building
 */
function rateInvestmentAllocation(ratio: number): RatingLevel {
  if (ratio >= 0.60) return 'excellent';
  if (ratio >= 0.40) return 'good';
  if (ratio >= 0.20) return 'fair';
  if (ratio >= 0.10) return 'poor';
  return 'critical';
}

/**
 * Rate growth rate
 */
function rateGrowthRate(rate: number): RatingLevel {
  if (rate >= 0.15) return 'excellent';
  if (rate >= 0.08) return 'good';
  if (rate >= 0.03) return 'fair';
  if (rate >= 0) return 'poor';
  return 'critical';
}

/**
 * Calculate all financial ratios for a simulation year
 */
export function calculateFinancialRatios(
  currentYear: SimulationYear,
  previousYear?: SimulationYear
): FinancialRatios {
  const { accounts, cashflow, taxDetails } = currentYear;
  const { totalIncome, totalExpense } = cashflow;

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
  const monthlyLivingExpenses = livingExpenses / 12;

  // 1. Savings Rate = (Income - Expenses) / Income
  const savingsAmount = totalIncome - totalExpense;
  const savingsRateValue = totalIncome > 0 ? savingsAmount / totalIncome : 0;

  // 2. Expense Ratio = Expenses / Income
  const expenseRatioValue = totalIncome > 0 ? totalExpense / totalIncome : 1;

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

  // Growth rates (require previous year)
  let netWorthGrowthRate: RatioResult | null = null;
  let assetGrowthRate: RatioResult | null = null;

  if (previousYear) {
    const prevNetWorth = getNetWorth(previousYear.accounts);
    const prevAssets = getTotalAssets(previousYear.accounts);

    // 9. Net Worth Growth Rate
    if (prevNetWorth > 0) {
      const nwGrowth = (netWorth - prevNetWorth) / prevNetWorth;
      netWorthGrowthRate = {
        value: nwGrowth,
        rating: rateGrowthRate(nwGrowth),
        benchmark: '8%+ good, 15%+ excellent',
        description: 'Year-over-year change in net worth',
      };
    }

    // 10. Asset Growth Rate
    if (prevAssets > 0) {
      const assetGrowth = (totalAssets - prevAssets) / prevAssets;
      assetGrowthRate = {
        value: assetGrowth,
        rating: rateGrowthRate(assetGrowth),
        benchmark: '8%+ good, 15%+ excellent',
        description: 'Year-over-year change in total assets',
      };
    }
  }

  return {
    savingsRate: {
      value: savingsRateValue,
      rating: rateSavingsRate(savingsRateValue),
      benchmark: '15%+ good, 20%+ excellent',
      description: 'Percentage of income saved or invested',
    },
    expenseRatio: {
      value: expenseRatioValue,
      rating: rateSavingsRate(1 - expenseRatioValue), // Inverse of savings rate
      benchmark: '<85% good, <80% excellent',
      description: 'Percentage of income spent on expenses',
    },
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
      rating: rateNetWorthToIncome(netWorthToIncomeValue),
      benchmark: '1x+ good, 3x+ excellent',
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
    const monthlyLivingExpenses = livingExpenses / 12;

    return {
      year: year.year,
      savingsRate: cashflow.totalIncome > 0
        ? (cashflow.totalIncome - cashflow.totalExpense) / cashflow.totalIncome
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
    case 'excellent': return 'text-green-400';
    case 'good': return 'text-blue-400';
    case 'fair': return 'text-yellow-400';
    case 'poor': return 'text-orange-400';
    case 'critical': return 'text-red-400';
  }
}

/**
 * Get background color class for rating level
 */
export function getRatingBgColor(rating: RatingLevel): string {
  switch (rating) {
    case 'excellent': return 'bg-green-500/20 border-green-500/30';
    case 'good': return 'bg-blue-500/20 border-blue-500/30';
    case 'fair': return 'bg-yellow-500/20 border-yellow-500/30';
    case 'poor': return 'bg-orange-500/20 border-orange-500/30';
    case 'critical': return 'bg-red-500/20 border-red-500/30';
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
