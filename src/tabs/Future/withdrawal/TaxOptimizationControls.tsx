import { memo, useCallback } from 'react';
import { AssumptionsState } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { ToggleInput } from '../../../components/Layout/InputFields/ToggleInput';
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider';
import { Panel } from "../../../components/Layout/Primitives";

type InvestmentsPatch = Partial<AssumptionsState['investments']>;

interface TaxOptimizationControlsProps {
    investments: AssumptionsState['investments'];
    onUpdateInvestments: (payload: InvestmentsPatch) => void;
}

const formatRateGap = (v: number) => `${v.toFixed(1)}pp gap`;

function TaxOptimizationControlsInner({
    investments,
    onUpdateInvestments,
}: TaxOptimizationControlsProps) {
    const taxOptimizationEnabled = investments.taxOptimizationEnabled;
    const strategy = investments.rothConversionStrategy ?? 'rate-match';

    const setTaxOptimization = useCallback((enabled: boolean) => {
        onUpdateInvestments({ taxOptimizationEnabled: enabled });
    }, [onUpdateInvestments]);

    const commitMinRateGap = useCallback((displayPct: number) => {
        onUpdateInvestments({ rothConversionMinRateGap: displayPct / 100 });
    }, [onUpdateInvestments]);

    const setUserSituation = useCallback((situation: 'self-liquidate' | 'bequeath') => {
        onUpdateInvestments({ rothConversionUserSituation: situation });
    }, [onUpdateInvestments]);

    const minRateGapPct = (investments.rothConversionMinRateGap ?? 0.05) * 100;
    // Default 'self-liquidate' (ratified, #89): spend-down is the sensible default;
    // the user can switch to 'leave to heirs'.
    const userSituation = investments.rothConversionUserSituation ?? 'self-liquidate';

    return (
        <Panel className="mb-6 bg-surface-raised/50">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-content-emphasis">Tax Optimization</h3>
                    <p className="text-sm text-content-muted mt-1">
                        {taxOptimizationEnabled
                            ? 'Automatically optimizes withdrawals and Roth conversions for after-tax efficiency.'
                            : 'Enable to automatically manage withdrawals and Roth conversions for tax efficiency.'}
                    </p>
                </div>
                <ToggleInput
                    label=""
                    enabled={taxOptimizationEnabled}
                    setEnabled={setTaxOptimization}
                />
            </div>
            {taxOptimizationEnabled && (
                <div className="mt-4 pt-4 border-t border-border-subtle">
                    <label className="block mb-4">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-content-emphasis">
                                Conversion algorithm
                            </span>
                        </div>
                        <div className="flex gap-2">
                            {(['rate-match', 'dp-precomputed'] as const).map(option => {
                                const active = strategy === option;
                                const optionLabel = option === 'rate-match' ? 'Rate match' : 'Maximize after-tax wealth';
                                const optionDesc = option === 'rate-match'
                                    ? 'Per-year bracket walk vs. projected RMD-age rate.'
                                    : 'Whole-horizon DP that maximizes after-tax wealth.';
                                return (
                                    <button
                                        key={option}
                                        type="button"
                                        onClick={() => onUpdateInvestments({ rothConversionStrategy: option })}
                                        className={`flex-1 text-left px-3 py-2 rounded-md border transition-colors ${
                                            active
                                                ? 'bg-info-tint/30 border-info-strong/50 text-info-bright'
                                                : 'bg-surface-raised/40 border-border-subtle text-content-default hover:border-border-default'
                                        }`}
                                    >
                                        <div className="text-sm font-medium">{optionLabel}</div>
                                        <div className="text-xs text-content-muted mt-0.5">{optionDesc}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </label>
                    {strategy === 'rate-match' && (
                    <RangeSlider
                        label="Conversion aggressiveness"
                        value={minRateGapPct}
                        min={0}
                        max={20}
                        step={1}
                        formatTooltip={formatRateGap}
                        onChange={commitMinRateGap}
                    />
                    )}
                    {strategy === 'rate-match' && (
                    <details className="mt-2 group">
                        <summary className="text-xs text-content-muted cursor-pointer hover:text-content-default select-none list-none flex items-center gap-1">
                            More info
                            <svg
                                className="w-3 h-3 transition-transform duration-200 group-open:rotate-180"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                            >
                                <path
                                    fillRule="evenodd"
                                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                                    clipRule="evenodd"
                                />
                            </svg>
                        </summary>
                        <p className="text-xs text-content-subtle mt-2">
                            Minimum percentage-point savings between today's rate and projected RMD-age rate
                            required to convert. Lower = more aggressive (converts even when small savings).
                            Higher = more conservative (only converts on big savings). Default 5pp.
                        </p>
                        <p className="text-xs text-content-subtle mt-2">
                            Risks of a lower gap:
                        </p>
                        <ul className="text-xs text-content-subtle mt-1 ml-5 list-disc space-y-0.5">
                            <li>
                                <span className="text-content-muted">Sequence of returns:</span> a market
                                crash after a conversion locks in tax paid on dollars that may never
                                recover.
                            </li>
                            <li>
                                <span className="text-content-muted">Growth too high:</span> lower real
                                returns mean a smaller future RMD bracket than projected, so you save
                                less.
                            </li>
                            <li>
                                <span className="text-content-muted">Future tax brackets drop:</span> if
                                rates fall, today's conversion was overpriced.
                            </li>
                        </ul>
                    </details>
                    )}
                    {strategy === 'dp-precomputed' && (
                    <label className="block">
                        <span className="text-sm font-medium text-content-emphasis">
                            What happens to leftover Traditional?
                        </span>
                        <p className="text-xs text-content-muted mt-0.5 mb-2">
                            Sets how aggressively to convert: leftover you'll spend down yourself comes
                            out cheaply (keep more), leftover an heir inherits comes out at their high
                            rate (convert more now).
                        </p>
                        <div className="flex gap-2">
                            {([
                                ['self-liquidate', 'Spend it down', "I'll draw it down in retirement (std-deduction & low brackets)."],
                                ['bequeath', 'Leave to heirs', 'It passes to a working heir who drains it within 10 years.'],
                            ] as const).map(([value, label, desc]) => {
                                const active = userSituation === value;
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setUserSituation(value)}
                                        className={`flex-1 text-left px-3 py-2 rounded-md border transition-colors ${
                                            active
                                                ? 'bg-info-tint/30 border-info-strong/50 text-info-bright'
                                                : 'bg-surface-raised/40 border-border-subtle text-content-default hover:border-border-default'
                                        }`}
                                    >
                                        <div className="text-sm font-medium">{label}</div>
                                        <div className="text-xs text-content-muted mt-0.5">{desc}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </label>
                    )}
                </div>
            )}
        </Panel>
    );
}

export const TaxOptimizationControls = memo(TaxOptimizationControlsInner);
