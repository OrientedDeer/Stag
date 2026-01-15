import React, { useState, useMemo, useEffect } from 'react';
import {
  runHistoricalBacktest,
  getBacktestDataRange,
  BacktestConfig,
  BacktestSummary,
} from '../../../services/HistoricalBacktest';
import { formatCompactCurrency, calculateNetWorth } from './FutureUtils';
import { useAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { CurrencyInput } from '../../../components/Layout/InputFields/CurrencyInput';
import { DropdownInput } from '../../../components/Layout/InputFields/DropdownInput';
import { PercentageInput } from '../../../components/Layout/InputFields/PercentageInput';

interface HistoricalBacktestPanelProps {
  simulationData: SimulationYear[];
}

/**
 * Historical Backtesting Panel Component
 * Tests retirement plans against actual historical market data
 */
export const HistoricalBacktestPanel = React.memo(({ simulationData }: HistoricalBacktestPanelProps) => {
  const { assumptions } = useAssumptions();
  const forceExact = assumptions.display?.useCompactCurrency === false;

  // Calculate defaults from simulation data using retirement age
  const simulationDefaults = useMemo(() => {
    if (!simulationData || simulationData.length === 0) {
      return { startingBalance: 1000000, annualWithdrawal: 40000, retirementYears: 30 };
    }

    const currentYear = new Date().getFullYear();
    const startYear = assumptions.demographics?.startYear || currentYear;
    const startAge = assumptions.demographics?.startAge || 30;
    const retirementAge = assumptions.demographics?.retirementAge || 65;
    const lifeExpectancy = assumptions.demographics?.lifeExpectancy || 90;

    // Calculate retirement year and get the year AFTER retirement for stable numbers
    const retirementYear = startYear + (retirementAge - startAge);
    const targetYear = retirementYear + 1;

    // Find that year in simulation
    let targetYearData = simulationData.find(y => y.year === targetYear);
    if (!targetYearData) {
      // Fallback to last year of simulation if retirement year is beyond it
      targetYearData = simulationData[simulationData.length - 1];
    }

    const startingBalance = calculateNetWorth(targetYearData.accounts);
    const annualWithdrawal = targetYearData.cashflow?.totalExpense || 40000;

    // Calculate retirement length based on life expectancy
    const retirementYears = Math.max(20, Math.min(40, lifeExpectancy - retirementAge));

    return {
      startingBalance: Math.round(startingBalance),
      annualWithdrawal: Math.round(annualWithdrawal),
      retirementYears: Math.round(retirementYears / 5) * 5 // Round to nearest 5
    };
  }, [simulationData, assumptions.demographics?.startYear, assumptions.demographics?.startAge, assumptions.demographics?.retirementAge, assumptions.demographics?.lifeExpectancy]);

  // Get withdrawal strategy settings from assumptions
  const withdrawalStrategy = assumptions.investments?.withdrawalStrategy || 'Fixed Real';
  const withdrawalRateFromAssumptions = assumptions.investments?.withdrawalRate || 4;
  const gkUpperGuardrail = assumptions.investments?.gkUpperGuardrail || 1.2;
  const gkLowerGuardrail = assumptions.investments?.gkLowerGuardrail || 0.8;
  const gkAdjustmentPercent = assumptions.investments?.gkAdjustmentPercent || 10;

  // Configuration state - now includes withdrawal strategy settings
  const [config, setConfig] = useState<BacktestConfig>({
    retirementYears: simulationDefaults.retirementYears,
    startingBalance: simulationDefaults.startingBalance,
    annualWithdrawal: simulationDefaults.annualWithdrawal,
    stockAllocation: 0.6,
    inflationAdjustedWithdrawals: true, // Fallback for legacy mode
    // Use strategy from assumptions
    withdrawalStrategy,
    withdrawalRate: withdrawalRateFromAssumptions,
    gkUpperGuardrail,
    gkLowerGuardrail,
    gkAdjustmentPercent,
  });

  // Update config when simulation defaults or strategy settings change (but only if user hasn't modified)
  const [hasUserModified, setHasUserModified] = useState(false);
  useEffect(() => {
    if (!hasUserModified) {
      setConfig(prev => ({
        ...prev,
        startingBalance: simulationDefaults.startingBalance,
        annualWithdrawal: simulationDefaults.annualWithdrawal,
        retirementYears: simulationDefaults.retirementYears,
      }));
    }
    // Always update strategy settings from assumptions
    setConfig(prev => ({
      ...prev,
      withdrawalStrategy,
      withdrawalRate: withdrawalRateFromAssumptions,
      gkUpperGuardrail,
      gkLowerGuardrail,
      gkAdjustmentPercent,
    }));
  }, [simulationDefaults, hasUserModified, withdrawalStrategy, withdrawalRateFromAssumptions, gkUpperGuardrail, gkLowerGuardrail, gkAdjustmentPercent]);

  // Results state
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showAllPeriods, setShowAllPeriods] = useState(false);

  // Data range info
  const dataRange = useMemo(() => getBacktestDataRange(), []);

  // Run backtest
  const handleRunBacktest = () => {
    setIsRunning(true);
    // Use setTimeout to allow UI to update
    setTimeout(() => {
      const result = runHistoricalBacktest(config);
      setSummary(result);
      setIsRunning(false);
    }, 10);
  };

  // Update config field
  const updateConfig = (field: keyof BacktestConfig, value: number | boolean) => {
    setHasUserModified(true);
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  // Get success rate color
  const getSuccessRateColor = (rate: number) => {
    if (rate >= 95) return 'bg-green-500';
    if (rate >= 80) return 'bg-yellow-500';
    if (rate >= 60) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getSuccessRateTextColor = (rate: number) => {
    if (rate >= 95) return 'text-green-400';
    if (rate >= 80) return 'text-yellow-400';
    if (rate >= 60) return 'text-orange-400';
    return 'text-red-400';
  };

  // Calculate withdrawal rate
  const withdrawalRate = config.startingBalance > 0
    ? ((config.annualWithdrawal / config.startingBalance) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
      <h3 className="text-white font-semibold mb-2">Historical Backtesting</h3>
      <p className="text-gray-400 text-sm mb-2">
        Test your plan against every {config.retirementYears}-year period since {dataRange.firstYear}.
      </p>
      <p className="text-gray-400 text-sm mb-4">
        Using <span className="text-emerald-400 font-medium">{config.withdrawalStrategy}</span> withdrawal strategy
        {config.withdrawalStrategy === 'Guyton Klinger' && (
          <span className="text-gray-400"> (±{gkAdjustmentPercent}% adjustments at ±{Math.round((gkUpperGuardrail - 1) * 100)}% guardrails)</span>
        )}
      </p>

      {/* Configuration */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <DropdownInput
          label="Retirement Years"
          value={config.retirementYears.toString()}
          onChange={(val) => updateConfig('retirementYears', Number(val))}
          options={[
            { value: '20', label: '20 years' },
            { value: '25', label: '25 years' },
            { value: '30', label: '30 years' },
            { value: '35', label: '35 years' },
            { value: '40', label: '40 years' },
          ]}
        />

        <CurrencyInput
          label="Starting Balance"
          value={config.startingBalance}
          onChange={(val) => updateConfig('startingBalance', val)}
          tooltip="Portfolio value at the start of retirement"
        />

        <div>
          <CurrencyInput
            label="Annual Withdrawal"
            value={config.annualWithdrawal}
            onChange={(val) => updateConfig('annualWithdrawal', val)}
            tooltip="Amount withdrawn each year for living expenses"
          />
          <span className="text-gray-400 text-xs">{withdrawalRate}% withdrawal rate</span>
        </div>

        <div>
          <PercentageInput
            label="Stock Allocation"
            value={config.stockAllocation * 100}
            onChange={(val) => updateConfig('stockAllocation', val / 100)}
            tooltip="Percentage invested in stocks vs bonds"
          />
          <span className="text-gray-400 text-xs">
            {Math.round((1 - config.stockAllocation) * 100)}% bonds
          </span>
        </div>
      </div>

      {/* Run Button */}
      <button
        onClick={handleRunBacktest}
        disabled={isRunning}
        className={`px-6 py-2 rounded-lg font-medium transition-colors mb-4
          ${isRunning
            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
      >
        {isRunning ? 'Running...' : 'Run Historical Backtest'}
      </button>

      {/* Results */}
      {summary && (
        <div className="mt-4 space-y-4">
          {/* Success Rate Bar */}
          <div className="bg-gray-900/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-300 font-medium">Historical Success Rate</span>
              <span className={`text-2xl font-bold ${getSuccessRateTextColor(summary.successRate)}`}>
                {summary.successRate}%
              </span>
            </div>
            <div className="w-full h-4 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full ${getSuccessRateColor(summary.successRate)} transition-all duration-500`}
                style={{ width: `${summary.successRate}%` }}
              />
            </div>
            <p className="text-gray-400 text-xs mt-2">
              {summary.successCount} of {summary.totalPeriods} historical periods succeeded
            </p>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gray-900/50 rounded-lg p-3">
              <div className="text-gray-400 text-xs uppercase">Best Case</div>
              <div className="text-green-400 font-bold truncate">
                {formatCompactCurrency(summary.bestCase.finalBalance, { forceExact })}
              </div>
              <div className="text-gray-400 text-xs">Started {summary.bestCase.startYear}</div>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-3">
              <div className="text-gray-400 text-xs uppercase">Median</div>
              <div className="text-gray-300 font-bold truncate">
                {formatCompactCurrency(summary.medianFinalBalance, { forceExact })}
              </div>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-3">
              <div className="text-gray-400 text-xs uppercase">Worst Success</div>
              <div className="text-yellow-400 font-bold truncate">
                {summary.worstSuccess
                  ? formatCompactCurrency(summary.worstSuccess.finalBalance, { forceExact })
                  : 'N/A'}
              </div>
              {summary.worstSuccess && (
                <div className="text-gray-400 text-xs">Started {summary.worstSuccess.startYear}</div>
              )}
            </div>
            <div className="bg-gray-900/50 rounded-lg p-3">
              <div className="text-gray-400 text-xs uppercase">Worst Case</div>
              <div className="text-red-400 font-bold truncate">
                {formatCompactCurrency(summary.worstCase.finalBalance, { forceExact })}
              </div>
              <div className="text-gray-400 text-xs">
                {summary.worstCase.succeeded ? 'Survived' : `Depleted ${summary.worstCase.yearOfDepletion}`}
              </div>
            </div>
          </div>

          {/* Notable Periods */}
          {summary.notablePeriods.length > 0 && (
            <div className="bg-gray-900/50 rounded-lg p-4">
              <h4 className="text-gray-300 font-medium mb-3">Notable Historical Periods</h4>
              <div className="space-y-2">
                {summary.notablePeriods.map(({ result, description }) => (
                  <div
                    key={result.startYear}
                    className="flex items-center justify-between text-sm py-1 border-b border-gray-800 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className={result.succeeded ? 'text-green-400' : 'text-red-400'}>
                        {result.succeeded ? '✓' : '✗'}
                      </span>
                      <span className="text-gray-400">{result.startYear}:</span>
                      <span className="text-gray-300">{description}</span>
                    </div>
                    <span className={`font-medium ${result.succeeded ? 'text-gray-300' : 'text-red-400'}`}>
                      {result.succeeded
                        ? formatCompactCurrency(result.finalBalance, { forceExact })
                        : `Depleted ${result.yearOfDepletion}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All Periods Expansion */}
          <button
            onClick={() => setShowAllPeriods(!showAllPeriods)}
            className="text-gray-400 hover:text-gray-200 text-sm transition-colors"
          >
            {showAllPeriods ? '▼ Hide All Periods' : '▶ Show All Periods'}
          </button>

          {showAllPeriods && (
            <div className="bg-gray-900/50 rounded-lg p-4 max-h-96 overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {summary.results.map(result => (
                  <div
                    key={result.startYear}
                    className={`text-xs p-2 rounded ${
                      result.succeeded
                        ? 'bg-gray-800 text-gray-300'
                        : 'bg-red-900/30 text-red-400'
                    }`}
                  >
                    <div className="font-medium">{result.startYear}</div>
                    <div className="truncate">
                      {result.succeeded
                        ? formatCompactCurrency(result.finalBalance, { forceExact })
                        : `Fail ${result.yearOfDepletion}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Interpretation */}
          <div className="text-gray-400 text-xs">
            <p>
              Historical backtesting shows how your plan would have performed if you retired in any year
              from {dataRange.firstYear} to {dataRange.lastYear - config.retirementYears}. The success rate
              indicates what percentage of those {config.retirementYears}-year periods your portfolio survived.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
