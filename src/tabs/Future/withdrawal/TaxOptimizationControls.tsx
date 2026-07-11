import { memo, useCallback } from 'react';
import { type AssumptionsState } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { ToggleInput } from '../../../components/Layout/InputFields/ToggleInput';
import { Panel } from "../../../components/Layout/Primitives";

type InvestmentsPatch = Partial<AssumptionsState['investments']>;
type SelectableStrategy = 'dp-precomputed' | 'std-ded-only';

interface TaxOptimizationControlsProps {
    investments: AssumptionsState['investments'];
    onUpdateInvestments: (payload: InvestmentsPatch) => void;
}

function TaxOptimizationControlsInner({
    investments,
    onUpdateInvestments,
}: TaxOptimizationControlsProps) {
    const taxOptimizationEnabled = investments.taxOptimizationEnabled;
    // Only two selectable strategies now: the max-wealth DP (default) and the conservative
    // standard-deduction-only floor. Legacy 'rate-match' (UI-removed) coalesces to std-ded-only
    // for display — persisted values are migrated on load (migrateAssumptions), so this only
    // matters for a not-yet-resaved session.
    const strategy: SelectableStrategy =
        (investments.rothConversionStrategy ?? 'dp-precomputed') === 'dp-precomputed'
            ? 'dp-precomputed'
            : 'std-ded-only';

    const setTaxOptimization = useCallback((enabled: boolean) => {
        onUpdateInvestments({ taxOptimizationEnabled: enabled });
    }, [onUpdateInvestments]);

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
                            {([
                                ['dp-precomputed', 'Maximize after-tax wealth', 'Whole-horizon optimizer that maximizes after-tax wealth.'],
                                ['std-ded-only', 'Standard deduction only', 'Convert only the always-free standard-deduction headroom each year — no tax cost.'],
                            ] as const).map(([option, optionLabel, optionDesc]) => {
                                const active = strategy === option;
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
                </div>
            )}
        </Panel>
    );
}

export const TaxOptimizationControls = memo(TaxOptimizationControlsInner);
