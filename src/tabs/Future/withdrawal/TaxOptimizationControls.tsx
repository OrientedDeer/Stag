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
const formatBackloadDelta = (v: number) => `${v.toFixed(1)}% / yr`;

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

    const commitBackloadDelta = useCallback((displayPct: number) => {
        onUpdateInvestments({ rothConversionDPBackloadDelta: displayPct / 100 });
    }, [onUpdateInvestments]);

    const minRateGapPct = (investments.rothConversionMinRateGap ?? 0.05) * 100;
    const backloadDeltaPct = (investments.rothConversionDPBackloadDelta ?? 0.015) * 100;

    return (
        <Panel className="mb-6 bg-surface-raised/50">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-content-emphasis">Tax Optimization</h3>
                    <p className="text-sm text-content-muted mt-1">
                        {taxOptimizationEnabled
                            ? 'Automatically optimizes withdrawals and Roth conversions to minimize lifetime taxes.'
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
                                const optionLabel = option === 'rate-match' ? 'Rate match' : 'Dynamic programming';
                                const optionDesc = option === 'rate-match'
                                    ? 'Per-year bracket walk vs. projected RMD-age rate.'
                                    : 'Backward-induction DP over the full horizon (experimental).';
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
                    <RangeSlider
                        label="DP back-load preference (δ)"
                        value={backloadDeltaPct}
                        min={0}
                        max={10}
                        step={0.5}
                        formatTooltip={formatBackloadDelta}
                        onChange={commitBackloadDelta}
                    />
                    )}
                    {strategy === 'dp-precomputed' && (
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
                            DP solves a backward-induction over the full retirement horizon, picking
                            the per-year conversion that minimizes lifetime tax. &delta; is a "back-load
                            preference" &mdash; at &delta; = 0, DP picks the strict lifetime-optimal plan
                            (mildly front-loaded). &delta; &gt; 0 makes future tax look cheaper, biasing
                            the plan toward later conversions at a small lifetime-tax cost.
                        </p>
                        <p className="text-xs text-content-subtle mt-2">
                            Why turn it up:
                        </p>
                        <ul className="text-xs text-content-subtle mt-1 ml-5 list-disc space-y-0.5">
                            <li>
                                <span className="text-content-muted">Sequence-of-returns risk:</span> a market
                                crash early in retirement is more damaging than late. Higher &delta; shifts
                                conversions later, after you've passed the most fragile years.
                            </li>
                            <li>
                                <span className="text-content-muted">Less commitment now:</span> if you're
                                unsure about future tax law or your spending pattern, smaller early
                                conversions = more optionality.
                            </li>
                        </ul>
                        <p className="text-xs text-content-subtle mt-2">
                            Default 1.5%/yr. Try 3-5% for noticeable back-loading. 0 = strict
                            lifetime-tax-optimal.
                        </p>
                    </details>
                    )}
                </div>
            )}
        </Panel>
    );
}

export const TaxOptimizationControls = memo(TaxOptimizationControlsInner);
