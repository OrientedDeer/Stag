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
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider';
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

  const scores = ratios.isRetired
    ? [
        ratios.withdrawalRate ? ratingToScore(ratios.withdrawalRate.rating) : 3,
        ratios.portfolioYears ? ratingToScore(ratios.portfolioYears.rating) : 3,
        ratingToScore(ratios.investmentAllocation.rating),
        ratios.netWorthGrowthRate ? ratingToScore(ratios.netWorthGrowthRate.rating) : 3,
      ]
    : [
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

    const birthYear = assumptions.demographics?.birthYear;
    const retirementAge = assumptions.demographics?.retirementAge;
    const lifeExpectancy = assumptions.demographics?.lifeExpectancy;
    const inflationAdjusted = assumptions.macro?.inflationAdjusted;
    const inflationRate = assumptions.macro?.inflationRate;

    // Get available years
    const years = useMemo(
      () => simulationData.map((y) => y.year),
      [simulationData]
    );

    const startYear = years[0] ?? new Date().getFullYear();
    const endYear = years[years.length - 1] ?? startYear;

    // Default to first year (current)
    const [selectedYear, setSelectedYear] = useState(startYear);
    const selectedYearIndex = years.indexOf(selectedYear);

    // Calculate ratios for selected year
    const ratios = useMemo(() => {
      if (simulationData.length === 0 || selectedYearIndex < 0) return null;
      const currentYear = simulationData[selectedYearIndex];
      const previousYear = selectedYearIndex > 0 ? simulationData[selectedYearIndex - 1] : undefined;
      const age = birthYear ? currentYear.year - birthYear : undefined;
      const isRetired = (age !== undefined && retirementAge !== undefined) ? age >= retirementAge : false;
      return calculateFinancialRatios(currentYear, previousYear, age, isRetired, lifeExpectancy, inflationAdjusted, inflationRate);
    }, [simulationData, selectedYearIndex, birthYear, retirementAge, lifeExpectancy, inflationAdjusted, inflationRate]);

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

    return (
      <div className="p-4 md:p-6 space-y-8">
        {/* Year slider */}
        <div className="p-4 bg-gray-900 rounded-xl border border-gray-800 shadow-lg">
          <h3 className="text-lg font-bold text-white mb-2">Year Details: {selectedYear}</h3>
          <div className="w-full">
            <RangeSlider
              value={selectedYear}
              min={startYear}
              max={endYear}
              onChange={(val) => setSelectedYear(val as number)}
              hideHeader={true}
            />
          </div>
        </div>

        {/* Overall Health Score */}
        <HealthScore ratios={ratios} />

        {/* Income & Savings / Retirement Spending Section */}
        <section>
          <SectionHeader
            title={ratios.isRetired ? "Retirement Spending" : "Income & Savings"}
            description={ratios.isRetired
              ? "How sustainable your retirement withdrawals are"
              : "How well you're converting income into savings"
            }
          />
          {ratios.isRetired ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ratios.withdrawalRate && (
                <RatioCard title="Withdrawal Rate" ratio={ratios.withdrawalRate} format="percent" />
              )}
              {ratios.portfolioYears && (
                <RatioCard title="Portfolio Years" ratio={ratios.portfolioYears} format="ratio" />
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <RatioCard title="Savings Rate" ratio={ratios.savingsRate} format="percent" />
              <RatioCard title="Expense Ratio" ratio={ratios.expenseRatio} format="percent" />
            </div>
          )}
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
            title={ratios.isRetired ? "Portfolio Health" : "Wealth Building"}
            description={ratios.isRetired
              ? "How well your portfolio is positioned"
              : "Your progress toward financial independence"
            }
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!ratios.isRetired && (
              <RatioCard
                title="Net Worth to Income"
                ratio={ratios.netWorthToIncomeRatio}
                format="multiple"
              />
            )}
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
            {ratios.isRetired ? (
              <>
                <p>
                  <strong className="text-gray-300">Withdrawal Rate:</strong> Percentage of your portfolio
                  withdrawn annually. Scales with life expectancy — higher rates are fine with fewer years remaining.
                </p>
                <p>
                  <strong className="text-gray-300">Portfolio Years:</strong> How many years of expenses
                  your current net worth can sustain at current spending levels.
                </p>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </section>
      </div>
    );
  }
);

export default FinancialRatiosTab;
