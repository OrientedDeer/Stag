/**
 * Financial Ratios Tab
 *
 * Displays key financial health ratios with benchmarks and trends.
 */

import React, { useMemo, useState, useContext } from 'react';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import {
  calculateFinancialRatios,
  calculateRatioTrends,
  getRatingColor,
  getRatingBgColor,
  getRatingLabel,
  RatioResult,
  FinancialRatios,
} from '../../../services/FinancialRatioService';
import { formatCompactCurrency } from './FutureUtils';
import { Tooltip } from '../../../components/Layout/InputFields/Tooltip';
import { SavedAccount, InvestedAccount, DebtAccount, DeficitDebtAccount, PropertyAccount } from '../../../components/Objects/Accounts/models';
import { AssumptionsContext } from '../../../components/Objects/Assumptions/AssumptionsContext';

interface FinancialRatiosTabProps {
  simulationData: SimulationYear[];
}

// Ratio card component
const RatioCard: React.FC<{
  title: string;
  ratio: RatioResult;
  format?: 'percent' | 'months' | 'multiple' | 'ratio';
}> = ({ title, ratio, format = 'percent' }) => {
  const formatValue = (value: number): string => {
    if (!isFinite(value)) return 'N/A';
    switch (format) {
      case 'percent':
        return `${(value * 100).toFixed(1)}%`;
      case 'months':
        return `${value.toFixed(1)} mo`;
      case 'multiple':
        return `${value.toFixed(1)}x`;
      case 'ratio':
        return value.toFixed(2);
      default:
        return value.toFixed(2);
    }
  };

  return (
    <div className={`rounded-xl p-4 border ${getRatingBgColor(ratio.rating)}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="text-gray-300 text-sm font-medium">{title}</div>
        <Tooltip text={ratio.description}>
          <span className="text-gray-400 cursor-help">?</span>
        </Tooltip>
      </div>
      <div className={`text-2xl font-bold ${getRatingColor(ratio.rating)}`}>
        {formatValue(ratio.value)}
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className={`text-xs font-medium ${getRatingColor(ratio.rating)}`}>
          {getRatingLabel(ratio.rating)}
        </span>
        <span className="text-xs text-gray-400">{ratio.benchmark}</span>
      </div>
    </div>
  );
};

// Section header component
const SectionHeader: React.FC<{ title: string; description: string }> = ({
  title,
  description,
}) => (
  <div className="mb-4">
    <h3 className="text-lg font-semibold text-white">{title}</h3>
    <p className="text-sm text-gray-400">{description}</p>
  </div>
);

// Year selector component
const YearSelector: React.FC<{
  years: number[];
  selectedYear: number;
  onSelect: (year: number) => void;
}> = ({ years, selectedYear, onSelect }) => (
  <div className="flex items-center gap-2 mb-6">
    <span className="text-gray-400 text-sm">View Year:</span>
    <select
      value={selectedYear}
      onChange={(e) => onSelect(Number(e.target.value))}
      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm"
    >
      {years.map((year) => (
        <option key={year} value={year}>
          {year}
        </option>
      ))}
    </select>
  </div>
);

// Debug panel component
const DebugPanel: React.FC<{ simulationYear: SimulationYear; forceExact: boolean }> = ({ simulationYear, forceExact }) => {
  const [isOpen, setIsOpen] = useState(false);

  const { accounts, cashflow } = simulationYear;

  // Categorize accounts
  const savedAccounts = accounts.filter((acc): acc is SavedAccount => acc instanceof SavedAccount);
  const investedAccounts = accounts.filter((acc): acc is InvestedAccount => acc instanceof InvestedAccount);
  const debtAccounts = accounts.filter((acc): acc is DebtAccount | DeficitDebtAccount =>
    acc instanceof DebtAccount || acc instanceof DeficitDebtAccount
  );
  const propertyAccounts = accounts.filter((acc): acc is PropertyAccount => acc instanceof PropertyAccount);

  // Calculate totals
  const totalLiquid = savedAccounts.reduce((sum, acc) => sum + acc.amount, 0);
  const totalInvested = investedAccounts.reduce((sum, acc) => sum + acc.amount, 0);
  const totalDebt = debtAccounts.reduce((sum, acc) => sum + acc.amount, 0);
  const totalProperty = propertyAccounts.reduce((sum, acc) => sum + acc.amount, 0);
  const totalAssets = totalLiquid + totalInvested + totalProperty;
  const netWorth = totalAssets - totalDebt;

  // Calculate living expenses (exclude taxes and payroll deductions)
  const taxesAndDeductions = (simulationYear.taxDetails.fed || 0) +
    (simulationYear.taxDetails.state || 0) +
    (simulationYear.taxDetails.fica || 0) +
    (simulationYear.taxDetails.preTax || 0) +
    (simulationYear.taxDetails.insurance || 0) +
    (simulationYear.taxDetails.postTax || 0) +
    (simulationYear.taxDetails.capitalGains || 0);
  const livingExpenses = Math.max(0, cashflow.totalExpense - taxesAndDeductions);
  const monthlyLivingExpenses = livingExpenses / 12;
  const emergencyMonths = monthlyLivingExpenses > 0 ? totalLiquid / monthlyLivingExpenses : 0;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 mb-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between text-left"
      >
        <span className="text-sm font-medium text-gray-300">
          🔍 Debug: Calculation Breakdown
        </span>
        <span className="text-gray-400">{isOpen ? '▼' : '▶'}</span>
      </button>

      {isOpen && (
        <div className="p-4 pt-0 space-y-4 text-sm">
          {/* Accounts Breakdown */}
          <div>
            <h4 className="text-gray-400 font-medium mb-2">Accounts by Type</h4>
            <div className="space-y-2">
              {/* Saved Accounts - LIQUID */}
              <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-green-400 font-medium">Savings (Liquid) ✓</span>
                  <span className="text-green-400 font-bold">{formatCompactCurrency(totalLiquid, { forceExact })}</span>
                </div>
                {savedAccounts.length === 0 ? (
                  <div className="text-gray-400 text-xs">No savings accounts</div>
                ) : (
                  savedAccounts.map((acc) => (
                    <div key={acc.id} className="flex justify-between text-xs text-gray-300">
                      <span>• {acc.name}</span>
                      <span>{formatCompactCurrency(acc.amount, { forceExact })}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Invested Accounts - NOT LIQUID */}
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-gray-400 font-medium">Invested (Not Liquid)</span>
                  <span className="text-gray-400">{formatCompactCurrency(totalInvested, { forceExact })}</span>
                </div>
                {investedAccounts.length === 0 ? (
                  <div className="text-gray-400 text-xs">No invested accounts</div>
                ) : (
                  investedAccounts.map((acc) => (
                    <div key={acc.id} className="flex justify-between text-xs text-gray-400">
                      <span>• {acc.name} ({acc.taxType})</span>
                      <span>{formatCompactCurrency(acc.amount, { forceExact })}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Property Accounts */}
              {propertyAccounts.length > 0 && (
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-gray-400 font-medium">Property (Not Liquid)</span>
                    <span className="text-gray-400">{formatCompactCurrency(totalProperty, { forceExact })}</span>
                  </div>
                  {propertyAccounts.map((acc) => (
                    <div key={acc.id} className="flex justify-between text-xs text-gray-400">
                      <span>• {acc.name}</span>
                      <span>{formatCompactCurrency(acc.amount, { forceExact })}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Debt Accounts */}
              {debtAccounts.length > 0 && (
                <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-red-400 font-medium">Debt</span>
                    <span className="text-red-400">-{formatCompactCurrency(totalDebt, { forceExact })}</span>
                  </div>
                  {debtAccounts.map((acc) => (
                    <div key={acc.id} className="flex justify-between text-xs text-gray-300">
                      <span>• {acc.name}</span>
                      <span>-{formatCompactCurrency(acc.amount, { forceExact })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Emergency Fund Calculation */}
          <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3">
            <h4 className="text-blue-400 font-medium mb-2">Emergency Fund Calculation</h4>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">Liquid Assets (Savings only):</span>
                <span className="text-white">{formatCompactCurrency(totalLiquid, { forceExact })}</span>
              </div>
              <div className="border-t border-blue-700/20 my-2"></div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Expenses:</span>
                <span className="text-white">{formatCompactCurrency(cashflow.totalExpense, { forceExact })}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span className="pl-2">− Federal Tax:</span>
                <span>-{formatCompactCurrency(simulationYear.taxDetails.fed || 0, { forceExact })}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span className="pl-2">− State Tax:</span>
                <span>-{formatCompactCurrency(simulationYear.taxDetails.state || 0, { forceExact })}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span className="pl-2">− FICA:</span>
                <span>-{formatCompactCurrency(simulationYear.taxDetails.fica || 0, { forceExact })}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span className="pl-2">− 401k/Pre-tax:</span>
                <span>-{formatCompactCurrency(simulationYear.taxDetails.preTax || 0, { forceExact })}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span className="pl-2">− Insurance:</span>
                <span>-{formatCompactCurrency(simulationYear.taxDetails.insurance || 0, { forceExact })}</span>
              </div>
              {(simulationYear.taxDetails.postTax || 0) > 0 && (
                <div className="flex justify-between text-gray-400">
                  <span className="pl-2">− Post-tax:</span>
                  <span>-{formatCompactCurrency(simulationYear.taxDetails.postTax || 0, { forceExact })}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-blue-700/30 pt-1">
                <span className="text-gray-300">= Living Expenses:</span>
                <span className="text-white font-medium">{formatCompactCurrency(livingExpenses, { forceExact })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Monthly Living Expenses:</span>
                <span className="text-white">{formatCompactCurrency(monthlyLivingExpenses, { forceExact })}</span>
              </div>
              <div className="flex justify-between border-t border-blue-700/30 pt-1 mt-1">
                <span className="text-blue-400 font-medium">Emergency Fund Months:</span>
                <span className="text-blue-400 font-bold">
                  {formatCompactCurrency(totalLiquid, { forceExact })} ÷ {formatCompactCurrency(monthlyLivingExpenses, { forceExact })} = {emergencyMonths.toFixed(1)} mo
                </span>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-800 rounded-lg p-3">
            <h4 className="text-gray-300 font-medium mb-2">Summary</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Assets:</span>
                <span className="text-white">{formatCompactCurrency(totalAssets, { forceExact })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Debt:</span>
                <span className="text-red-400">-{formatCompactCurrency(totalDebt, { forceExact })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Net Worth:</span>
                <span className="text-green-400">{formatCompactCurrency(netWorth, { forceExact })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Income:</span>
                <span className="text-white">{formatCompactCurrency(cashflow.totalIncome, { forceExact })}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Overall health score component
const HealthScore: React.FC<{ ratios: FinancialRatios }> = ({ ratios }) => {
  // Calculate overall score based on ratings
  const ratingToScore = (rating: string): number => {
    switch (rating) {
      case 'excellent': return 5;
      case 'good': return 4;
      case 'fair': return 3;
      case 'poor': return 2;
      case 'critical': return 1;
      default: return 0;
    }
  };

  const scores = [
    ratingToScore(ratios.savingsRate.rating),
    ratingToScore(ratios.emergencyFundMonths.rating),
    ratingToScore(ratios.debtToIncomeRatio.rating),
    ratingToScore(ratios.netWorthToIncomeRatio.rating),
    ratingToScore(ratios.investmentAllocation.rating),
  ];

  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const percentage = (avgScore / 5) * 100;

  let color = 'text-red-400';
  let label = 'Needs Attention';
  if (percentage >= 80) { color = 'text-green-400'; label = 'Excellent'; }
  else if (percentage >= 60) { color = 'text-blue-400'; label = 'Good'; }
  else if (percentage >= 40) { color = 'text-yellow-400'; label = 'Fair'; }

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Financial Health Score</h2>
          <p className="text-gray-400 text-sm mt-1">
            Based on 5 key financial ratios
          </p>
        </div>
        <div className="text-right">
          <div className={`text-4xl font-bold ${color}`}>
            {percentage.toFixed(0)}
          </div>
          <div className={`text-sm font-medium ${color}`}>{label}</div>
        </div>
      </div>

      {/* Score bar */}
      <div className="mt-4 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${
            percentage >= 80 ? 'bg-green-500' :
            percentage >= 60 ? 'bg-blue-500' :
            percentage >= 40 ? 'bg-yellow-500' : 'bg-red-500'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

export const FinancialRatiosTab: React.FC<FinancialRatiosTabProps> = React.memo(
  ({ simulationData }) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;

    // Get available years
    const years = useMemo(
      () => simulationData.map((y) => y.year),
      [simulationData]
    );

    // Default to first year (current)
    const [selectedYearIndex, setSelectedYearIndex] = useState(0);

    // Calculate ratios for selected year
    const ratios = useMemo(() => {
      if (simulationData.length === 0) return null;
      const currentYear = simulationData[selectedYearIndex];
      const previousYear = selectedYearIndex > 0 ? simulationData[selectedYearIndex - 1] : undefined;
      return calculateFinancialRatios(currentYear, previousYear);
    }, [simulationData, selectedYearIndex]);

    // Calculate trends
    const trends = useMemo(
      () => calculateRatioTrends(simulationData),
      [simulationData]
    );

    if (!ratios || simulationData.length === 0) {
      return (
        <div className="p-6 text-center text-gray-400">
          <p>No simulation data available. Add accounts, income, and expenses to see financial ratios.</p>
        </div>
      );
    }

    const selectedYear = years[selectedYearIndex];

    const currentSimYear = simulationData[selectedYearIndex];

    return (
      <div className="p-4 md:p-6 space-y-8">
        {/* Year selector */}
        <YearSelector
          years={years}
          selectedYear={selectedYear}
          onSelect={(year) => setSelectedYearIndex(years.indexOf(year))}
        />

        {/* Debug Panel */}
        <DebugPanel simulationYear={currentSimYear} forceExact={forceExact} />

        {/* Overall Health Score */}
        <HealthScore ratios={ratios} />

        {/* Income & Savings Section */}
        <section>
          <SectionHeader
            title="Income & Savings"
            description="How well you're converting income into savings"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RatioCard title="Savings Rate" ratio={ratios.savingsRate} format="percent" />
            <RatioCard title="Expense Ratio" ratio={ratios.expenseRatio} format="percent" />
          </div>
        </section>

        {/* Liquidity Section */}
        <section>
          <SectionHeader
            title="Liquidity & Emergency Fund"
            description="Your ability to handle unexpected expenses"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RatioCard
              title="Emergency Fund"
              ratio={ratios.emergencyFundMonths}
              format="months"
            />
            <RatioCard
              title="Liquidity Ratio"
              ratio={ratios.liquidityRatio}
              format="ratio"
            />
          </div>
        </section>

        {/* Debt Section */}
        <section>
          <SectionHeader
            title="Debt Management"
            description="How manageable your debt load is"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RatioCard
              title="Debt-to-Income"
              ratio={ratios.debtToIncomeRatio}
              format="percent"
            />
            <RatioCard
              title="Debt-to-Assets"
              ratio={ratios.debtToAssetRatio}
              format="percent"
            />
          </div>
        </section>

        {/* Wealth Section */}
        <section>
          <SectionHeader
            title="Wealth Building"
            description="Your progress toward financial independence"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RatioCard
              title="Net Worth to Income"
              ratio={ratios.netWorthToIncomeRatio}
              format="multiple"
            />
            <RatioCard
              title="Investment Allocation"
              ratio={ratios.investmentAllocation}
              format="percent"
            />
          </div>
        </section>

        {/* Growth Section (if available) */}
        {(ratios.netWorthGrowthRate || ratios.assetGrowthRate) && (
          <section>
            <SectionHeader
              title="Growth Rates"
              description="Year-over-year changes in your financial position"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ratios.netWorthGrowthRate && (
                <RatioCard
                  title="Net Worth Growth"
                  ratio={ratios.netWorthGrowthRate}
                  format="percent"
                />
              )}
              {ratios.assetGrowthRate && (
                <RatioCard
                  title="Asset Growth"
                  ratio={ratios.assetGrowthRate}
                  format="percent"
                />
              )}
            </div>
          </section>
        )}

        {/* Trends Summary */}
        {trends.length > 1 && (
          <section>
            <SectionHeader
              title="Ratio Trends"
              description="How your key metrics change over time"
            />
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left p-3 text-gray-400 font-medium">Year</th>
                    <th className="text-right p-3 text-gray-400 font-medium">Savings Rate</th>
                    <th className="text-right p-3 text-gray-400 font-medium">Debt/Income</th>
                    <th className="text-right p-3 text-gray-400 font-medium">Net Worth</th>
                    <th className="text-right p-3 text-gray-400 font-medium">Emergency Fund</th>
                  </tr>
                </thead>
                <tbody>
                  {trends.slice(0, 10).map((trend) => (
                    <tr
                      key={trend.year}
                      className={`border-b border-gray-700/50 ${
                        trend.year === selectedYear ? 'bg-gray-700/30' : ''
                      }`}
                    >
                      <td className="p-3 text-white font-medium">{trend.year}</td>
                      <td className="p-3 text-right text-gray-300">
                        {(trend.savingsRate * 100).toFixed(1)}%
                      </td>
                      <td className="p-3 text-right text-gray-300">
                        {(trend.debtToIncome * 100).toFixed(1)}%
                      </td>
                      <td className="p-3 text-right text-gray-300">
                        {formatCompactCurrency(trend.netWorth, { forceExact })}
                      </td>
                      <td className="p-3 text-right text-gray-300">
                        {trend.emergencyFundMonths.toFixed(1)} mo
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {trends.length > 10 && (
                <div className="p-3 text-center text-gray-400 text-sm">
                  Showing first 10 years of {trends.length} total
                </div>
              )}
            </div>
          </section>
        )}

        {/* Help Section */}
        <section className="bg-gray-800/30 rounded-xl p-4 border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Understanding These Ratios</h3>
          <div className="text-xs text-gray-400 space-y-2">
            <p>
              <strong className="text-gray-300">Savings Rate:</strong> The percentage of your income
              that goes toward savings and investments. 20%+ is considered healthy.
            </p>
            <p>
              <strong className="text-gray-300">Emergency Fund:</strong> How many months of expenses
              your liquid savings can cover. 6+ months provides good security.
            </p>
            <p>
              <strong className="text-gray-300">Debt-to-Income:</strong> Your total debt relative to
              annual income. Lenders typically prefer under 36%.
            </p>
            <p>
              <strong className="text-gray-300">Net Worth to Income:</strong> A common rule of thumb
              is to have 1x income saved by 30, 3x by 40, 6x by 50, and 10x+ by retirement.
            </p>
          </div>
        </section>
      </div>
    );
  }
);

export default FinancialRatiosTab;
