import { memo } from 'react';
import { Phase } from '../../../services/simulation/TaxOptimizedWithdrawal';

export interface OptimizationSummary {
    projectedBalance: number;
    avgConversionPerYear: number;
    maxConversionInPlan: number;
    firstYearConversion: number;
    currentTraditionalBalance: number;
    totalConversions: number;
    conversionYearsCount: number;
    rmdAge: number;
    yearsUntilRMD: number;
    phase: Phase;
}

export interface ComparisonResult {
    taxesWithStrategy: number;
    taxesStdDedOnly: number;
    savings: number;
}

interface OptimizationSummaryCardProps {
    summary: OptimizationSummary;
    comparisonResult: ComparisonResult | null;
    isRecalculating: boolean;
    formatMoney: (amount: number) => string;
}

function OptimizationSummaryCardInner({
    summary,
    comparisonResult,
    isRecalculating,
    formatMoney,
}: OptimizationSummaryCardProps) {
    return (
        <div className={`mb-6 bg-positive-tint/20 border border-positive-strong/50 rounded-xl p-4 relative ${isRecalculating ? 'opacity-60' : ''}`}>
            {isRecalculating && (
                <div className="absolute inset-0 flex items-center justify-center bg-surface-raised/40 rounded-xl z-10">
                    <div className="flex items-center gap-2 text-positive-bright text-sm">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Recalculating...
                    </div>
                </div>
            )}
            {/* Header with Phase Badge */}
            <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-positive-bright flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Tax Optimization Active
                </h3>
                <span className={`px-2 py-0.5 text-xs rounded ${
                    summary.phase === 'BROKERAGE_AVAILABLE' ? 'bg-accent' :
                    summary.phase === 'BROKERAGE_TRANSITION' ? 'bg-warning-solid' :
                    summary.phase === 'BROKERAGE_DEPLETED' ? 'bg-cat-orange-solid' :
                    'bg-negative-solid'
                }`}>
                    {summary.phase === 'BROKERAGE_AVAILABLE' ? 'Accumulation' :
                     summary.phase === 'BROKERAGE_TRANSITION' ? 'Transition' :
                     summary.phase === 'BROKERAGE_DEPLETED' ? 'Roth Phase' :
                     'Traditional Only'}
                </span>
            </div>

            {/* Main Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                    <div className="flex justify-between">
                        <span className="text-content-muted">Projected Traditional at RMD:</span>
                        <span className="text-white font-semibold">{formatMoney(summary.projectedBalance)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-content-muted">Current Traditional:</span>
                        <span className="text-white">{formatMoney(summary.currentTraditionalBalance)}</span>
                    </div>
                </div>
                <div className="space-y-2">
                    <div className="flex justify-between">
                        <span className="text-content-muted">Years Until RMD:</span>
                        <span className="text-white">{summary.yearsUntilRMD} years (age {summary.rmdAge})</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-content-muted">Avg. Conversion/Year:</span>
                        <span className="text-white">{formatMoney(summary.avgConversionPerYear)}</span>
                    </div>
                    {summary.maxConversionInPlan > summary.avgConversionPerYear * 1.2 && (
                        <div className="flex justify-between">
                            <span className="text-content-muted">Peak Conversion:</span>
                            <span className="text-warning-bright">{formatMoney(summary.maxConversionInPlan)}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* First Year Conversion */}
            {summary.firstYearConversion > 0 && (
                <div className="mt-4 pt-4 border-t border-positive-strong/50">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="text-sm font-semibold text-content-default">First Year Conversion</h4>
                            <p className="text-xs text-content-subtle">Starts the conversion ladder to reduce future RMDs</p>
                        </div>
                        <span className="text-lg font-bold text-positive">{formatMoney(summary.firstYearConversion)}</span>
                    </div>
                </div>
            )}

            {/* Tax Savings Comparison — auto-updates with every simulation recalc */}
            <div className="mt-4 pt-4 border-t border-positive-strong/50">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-content-default">Lifetime Tax Comparison</h4>
                </div>

                {comparisonResult ? (
                    <div className="bg-surface-overlay/50 rounded-lg p-3 space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-content-muted">Your strategy:</span>
                            <span className="text-white">{formatMoney(comparisonResult.taxesWithStrategy)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-content-muted">Std-ded conversions only:</span>
                            <span className="text-white">{formatMoney(comparisonResult.taxesStdDedOnly)}</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-border-default">
                            <span className="text-content-default font-medium">Lifetime Tax Savings:</span>
                            <span className={`font-bold ${comparisonResult.savings > 0 ? 'text-positive' : comparisonResult.savings < 0 ? 'text-negative' : 'text-content-muted'}`}>
                                {comparisonResult.savings > 0 ? '+' : ''}{formatMoney(comparisonResult.savings)}
                            </span>
                        </div>
                        <p className="pt-2 text-xs text-content-subtle">
                            Reference: a simulation that converts only the always-free
                            standard-deduction headroom each year (no tax cost). Anyone using
                            auto-Roth would do this as a floor.
                        </p>
                    </div>
                ) : (
                    <p className="text-xs text-content-subtle">
                        Comparison unavailable — run a full simulation first.
                    </p>
                )}
            </div>

            <p className="mt-4 text-xs text-content-subtle">
                Roth conversions are sized by rate-match: each year, fill brackets where today's
                rate is at least the configured gap below the projected RMD-age rate. Conversions
                taper naturally as the projected RMD bracket drops. Withdrawals are automatically
                ordered to minimize taxes.
            </p>
        </div>
    );
}

export const OptimizationSummaryCard = memo(OptimizationSummaryCardInner);
