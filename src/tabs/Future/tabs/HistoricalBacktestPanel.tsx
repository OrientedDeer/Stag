import React, { useState, useMemo } from 'react';
import {
  runHistoricalBacktest,
  getBacktestDataRange,
  type BacktestConfig,
  type BacktestSummary,
} from '../../../services/HistoricalBacktest';
import { formatCompactCurrency, calculateNetWorth } from './FutureUtils';
import { useAssumptions, getBirthYear, getRetirementAge, getLifeExpectancy } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { CurrencyInput } from '../../../components/Layout/InputFields/CurrencyInput';
import { DropdownInput } from '../../../components/Layout/InputFields/DropdownInput';
import { PercentageInput } from '../../../components/Layout/InputFields/PercentageInput';
import { AlertBanner } from '../../../components/Layout/AlertBanner';

interface HistoricalBacktestPanelProps {
  simulationData: SimulationYear[];
}

type WithdrawalStrategyName = 'None' | 'Needs Based' | 'Fixed Real' | 'Percentage' | 'Guyton Klinger';

/** The withdrawal-strategy slice the backtest panel reads off `assumptions.investments`. */
interface BacktestStrategyAssumptions {
  withdrawalStrategy?: WithdrawalStrategyName;
  withdrawalRate?: number;
  gkUpperGuardrail?: number;
  gkLowerGuardrail?: number;
  gkAdjustmentPercent?: number;
}

interface ResolvedBacktestStrategySettings {
  withdrawalStrategy: WithdrawalStrategyName;
  withdrawalRate: number;
  gkUpperGuardrail: number;
  gkLowerGuardrail: number;
  gkAdjustmentPercent: number;
}

/**
 * Resolve the backtest's withdrawal-strategy settings from the assumptions
 * investments slice, applying defaults only when a field is genuinely missing.
 *
 * Uses `??` (not `||`) so an explicit 0 — reachable by clearing a
 * PercentageInput, which emits `onChange(0)` — survives instead of being
 * coerced back to the default in both the config that runs and the label.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure settings-resolution helper exported for unit testing alongside this panel component
export function resolveBacktestStrategySettings(
  investments: BacktestStrategyAssumptions | undefined,
): ResolvedBacktestStrategySettings {
  return {
    withdrawalStrategy: investments?.withdrawalStrategy ?? 'Fixed Real',
    withdrawalRate: investments?.withdrawalRate ?? 4,
    gkUpperGuardrail: investments?.gkUpperGuardrail ?? 1.2,
    gkLowerGuardrail: investments?.gkLowerGuardrail ?? 0.8,
    gkAdjustmentPercent: investments?.gkAdjustmentPercent ?? 10,
  };
}

/**
 * Build the Guyton-Klinger adjustment label. The upper and lower guardrails are
 * independent config fields, so render both bounds rather than mirroring the
 * upper figure (which is wrong for asymmetric guardrails).
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure label-formatting helper exported for unit testing alongside this panel component
export function formatGuardrailAdjustmentLabel({
  gkAdjustmentPercent,
  gkUpperGuardrail,
  gkLowerGuardrail,
}: Pick<ResolvedBacktestStrategySettings, 'gkAdjustmentPercent' | 'gkUpperGuardrail' | 'gkLowerGuardrail'>): string {
  const upperPct = Math.round((gkUpperGuardrail - 1) * 100);
  const lowerPct = Math.round((1 - gkLowerGuardrail) * 100);
  return `(±${gkAdjustmentPercent}% adjustments at +${upperPct}% / -${lowerPct}% guardrails)`;
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
    const birthYear = getBirthYear(assumptions.milestones);
    const startYear = assumptions.demographics?.priorYearMode ? currentYear - 1 : currentYear;
    const startAge = startYear - birthYear;
    const retirementAge = getRetirementAge(assumptions.milestones);
    const lifeExpectancy = getLifeExpectancy(assumptions.milestones);

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
  }, [simulationData, assumptions.milestones, assumptions.demographics?.priorYearMode]);

  // Get withdrawal strategy settings from assumptions. Uses `??` so an explicit
  // 0 (e.g. a cleared PercentageInput) is preserved instead of falling back.
  const {
    withdrawalStrategy,
    withdrawalRate: withdrawalRateFromAssumptions,
    gkUpperGuardrail,
    gkLowerGuardrail,
    gkAdjustmentPercent,
  } = resolveBacktestStrategySettings(assumptions.investments);

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

  // Re-sync config when the simulation defaults or the assumptions-derived
  // strategy settings change. The sim-default fields are only overwritten while
  // the user hasn't modified them; strategy settings always track assumptions.
  // Comparing against the previous inputs during render is React's recommended
  // alternative to a syncing effect (and `simulationDefaults` is memoized, so
  // this can't loop).
  const [hasUserModified, setHasUserModified] = useState(false);
  const [prevSync, setPrevSync] = useState({
    simulationDefaults,
    hasUserModified,
    withdrawalStrategy,
    withdrawalRateFromAssumptions,
    gkUpperGuardrail,
    gkLowerGuardrail,
    gkAdjustmentPercent,
  });
  if (
    prevSync.simulationDefaults !== simulationDefaults ||
    prevSync.hasUserModified !== hasUserModified ||
    prevSync.withdrawalStrategy !== withdrawalStrategy ||
    prevSync.withdrawalRateFromAssumptions !== withdrawalRateFromAssumptions ||
    prevSync.gkUpperGuardrail !== gkUpperGuardrail ||
    prevSync.gkLowerGuardrail !== gkLowerGuardrail ||
    prevSync.gkAdjustmentPercent !== gkAdjustmentPercent
  ) {
    setPrevSync({
      simulationDefaults,
      hasUserModified,
      withdrawalStrategy,
      withdrawalRateFromAssumptions,
      gkUpperGuardrail,
      gkLowerGuardrail,
      gkAdjustmentPercent,
    });
    setConfig(prev => {
      const next = {
        ...prev,
        withdrawalStrategy,
        withdrawalRate: withdrawalRateFromAssumptions,
        gkUpperGuardrail,
        gkLowerGuardrail,
        gkAdjustmentPercent,
      };
      if (!hasUserModified) {
        next.startingBalance = simulationDefaults.startingBalance;
        next.annualWithdrawal = simulationDefaults.annualWithdrawal;
        next.retirementYears = simulationDefaults.retirementYears;
      }
      return next;
    });
  }

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
    if (rate >= 95) return 'bg-positive-soft';
    if (rate >= 80) return 'bg-warning-soft';
    if (rate >= 60) return 'bg-cat-orange-soft';
    return 'bg-negative-soft';
  };

  const getSuccessRateTextColor = (rate: number) => {
    if (rate >= 95) return 'text-positive';
    if (rate >= 80) return 'text-warning';
    if (rate >= 60) return 'text-cat-orange';
    return 'text-negative';
  };

  // Calculate withdrawal rate
  const withdrawalRate = config.startingBalance > 0
    ? ((config.annualWithdrawal / config.startingBalance) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default">
      <h3 className="text-white font-semibold mb-2">Historical Backtesting</h3>
      <p className="text-content-muted text-sm mb-2">
        Test your plan against every {config.retirementYears}-year period since {dataRange.firstYear}.
      </p>
      <p className="text-content-muted text-sm mb-4">
        Using <span className="text-positive font-medium">{config.withdrawalStrategy}</span> withdrawal strategy
        {config.withdrawalStrategy === 'Guyton Klinger' && (
          <span className="text-content-muted"> {formatGuardrailAdjustmentLabel({ gkAdjustmentPercent, gkUpperGuardrail, gkLowerGuardrail })}</span>
        )}
      </p>

      {config.withdrawalStrategy === 'Guyton Klinger' && (
        <div className="mb-4">
          <AlertBanner severity="info" size="sm" title="How Guyton-Klinger is modeled here">
            The backtest models GK as a fixed-rate (single-track) withdrawal — rate × balance,
            inflation-adjusted, with ±{gkAdjustmentPercent}% guardrail moves applied directly to the
            withdrawal — replayed across historical return/inflation sequences. This differs from the
            projection, where GK is budget-anchored: you spend your itemized plan, with a
            ±{gkAdjustmentPercent}% discretionary adjustment only at the
            +{Math.round((gkUpperGuardrail - 1) * 100)}% / -{Math.round((1 - gkLowerGuardrail) * 100)}%
            guardrails. (Both sides read the same guardrail settings.)
          </AlertBanner>
        </div>
      )}

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
          <span className="text-content-muted text-xs">{withdrawalRate}% withdrawal rate</span>
        </div>

        <div>
          <PercentageInput
            label="Stock Allocation"
            value={config.stockAllocation * 100}
            onChange={(val) => updateConfig('stockAllocation', val / 100)}
            tooltip="Percentage invested in stocks vs bonds"
          />
          <span className="text-content-muted text-xs">
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
            ? 'bg-surface-hover text-content-muted cursor-not-allowed'
            : 'bg-positive-solid hover:bg-positive-soft text-white'
          }`}
      >
        {isRunning ? 'Running...' : 'Run Historical Backtest'}
      </button>

      {/* Results */}
      {summary && (
        <div className="mt-4 space-y-4">
          {/* Success Rate Bar */}
          <div className="bg-surface-raised/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-content-default font-medium">Historical Success Rate</span>
              <span className={`text-2xl font-bold ${getSuccessRateTextColor(summary.successRate)}`}>
                {summary.successRate}%
              </span>
            </div>
            <div className="w-full h-4 bg-surface-input rounded-full overflow-hidden">
              <div
                className={`h-full ${getSuccessRateColor(summary.successRate)} transition-all duration-500`}
                style={{ width: `${summary.successRate}%` }}
              />
            </div>
            <p className="text-content-muted text-xs mt-2">
              {summary.successCount} of {summary.totalPeriods} historical periods succeeded
            </p>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-surface-raised/50 rounded-lg p-3">
              <div className="text-content-muted text-xs uppercase">Best Case</div>
              <div className="text-positive font-bold truncate">
                {formatCompactCurrency(summary.bestCase.finalBalance, { forceExact })}
              </div>
              <div className="text-content-muted text-xs">Started {summary.bestCase.startYear}</div>
            </div>
            <div className="bg-surface-raised/50 rounded-lg p-3">
              <div className="text-content-muted text-xs uppercase">Median</div>
              <div className="text-content-default font-bold truncate">
                {formatCompactCurrency(summary.medianFinalBalance, { forceExact })}
              </div>
            </div>
            <div className="bg-surface-raised/50 rounded-lg p-3">
              <div className="text-content-muted text-xs uppercase">Worst Success</div>
              <div className="text-warning font-bold truncate">
                {summary.worstSuccess
                  ? formatCompactCurrency(summary.worstSuccess.finalBalance, { forceExact })
                  : 'N/A'}
              </div>
              {summary.worstSuccess && (
                <div className="text-content-muted text-xs">Started {summary.worstSuccess.startYear}</div>
              )}
            </div>
            <div className="bg-surface-raised/50 rounded-lg p-3">
              <div className="text-content-muted text-xs uppercase">Worst Case</div>
              <div className="text-negative font-bold truncate">
                {formatCompactCurrency(summary.worstCase.finalBalance, { forceExact })}
              </div>
              <div className="text-content-muted text-xs">
                {summary.worstCase.succeeded ? 'Survived' : `Depleted ${summary.worstCase.yearOfDepletion}`}
              </div>
            </div>
          </div>

          {/* Notable Periods */}
          {summary.notablePeriods.length > 0 && (
            <div className="bg-surface-raised/50 rounded-lg p-4">
              <h4 className="text-content-default font-medium mb-3">Notable Historical Periods</h4>
              <div className="space-y-2">
                {summary.notablePeriods.map(({ result, description }) => (
                  <div
                    key={result.startYear}
                    className="flex items-center justify-between text-sm py-1 border-b border-border-subtle last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className={result.succeeded ? 'text-positive' : 'text-negative'}>
                        {result.succeeded ? '✓' : '✗'}
                      </span>
                      <span className="text-content-muted">{result.startYear}:</span>
                      <span className="text-content-default">{description}</span>
                    </div>
                    <span className={`font-medium ${result.succeeded ? 'text-content-default' : 'text-negative'}`}>
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
            className="text-content-muted hover:text-content-emphasis text-sm transition-colors"
          >
            {showAllPeriods ? '▼ Hide All Periods' : '▶ Show All Periods'}
          </button>

          {showAllPeriods && (
            <div className="bg-surface-raised/50 rounded-lg p-4 max-h-96 overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {summary.results.map(result => (
                  <div
                    key={result.startYear}
                    className={`text-xs p-2 rounded ${
                      result.succeeded
                        ? 'bg-surface-overlay text-content-default'
                        : 'bg-negative-tint/30 text-negative'
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
          <div className="text-content-muted text-xs">
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
