import { type ReactElement, useContext } from "react";
import { AssumptionsContext } from "../../../components/Objects/Assumptions/AssumptionsContext";
import { PercentageInput } from "../../../components/Layout/InputFields/PercentageInput";
import { SegmentedInput } from "../../../components/Layout/InputFields/SegmentedInput";
import { ToggleInput } from "../../../components/Layout/InputFields/ToggleInput";
import { NumberInput } from "../../../components/Layout/InputFields/NumberInput";
import { AlertBanner } from "../../../components/Layout/AlertBanner";
import { blendRate } from "../../../services/simulation/allocation";

/** Shape defaults for a glidepath the user has never configured. */
const glideDefaults = {
    enabled: false,
    startAge: 40,
    endAge: 65,
    startStockPct: 100,
    endStockPct: 60,
};

/**
 * Growth Rates section (Inflation, Stock/Bond Return, default allocation + glidepath,
 * Inflation Adjusted mode). Rendered inside the left Assumptions panel, below Plan Basics.
 */
export function GrowthRatesSection(): ReactElement {
    const { state, dispatch } = useContext(AssumptionsContext);

    const stockPct = state.investments.defaultAllocation?.stockPct ?? 100;
    const glide = state.investments.allocationGlidepath;
    const blendedDefault = blendRate(
        stockPct,
        state.investments.returnRates.ror,
        state.investments.returnRates.bondRor ?? state.investments.returnRates.ror,
    );
    const updateGlide = (patch: Partial<typeof glideDefaults>) => dispatch({
        type: "UPDATE_INVESTMENTS",
        payload: { allocationGlidepath: { ...glideDefaults, ...glide, ...patch, enabled: true } },
    });

    return (
        <div className="pt-4 border-t border-border-subtle">
            <h3 className="text-sm font-semibold text-white border-b border-border-default pb-2 mb-3">Growth Rates</h3>
            <p className="text-xs text-info">All growth rates are real (above inflation), not nominal.</p>
            <div className="grid grid-cols-2 gap-3">
                <div className={`transition-opacity duration-300 ${!state.macro.inflationAdjusted ? "opacity-50" : "opacity-100"}`}>
                    <PercentageInput
                        label="Inflation"
                        value={state.macro.inflationRate}
                        onChange={(val) => dispatch({ type: "UPDATE_MACRO", payload: { inflationRate: val } })}
                        disabled={!state.macro.inflationAdjusted}
                    />
                </div>
                <PercentageInput
                    label="Stock Return"
                    value={state.investments.returnRates.ror}
                    onChange={(val) => dispatch({ type: "UPDATE_INVESTMENT_RATES", payload: { ror: val } })}
                    isAboveInflation={state.macro.inflationAdjusted}
                    tooltip="The return on the STOCK (equity) share of your portfolio. With Inflation Adjusted ON, this is your REAL (after-inflation) return: investments grow at this rate PLUS inflation (e.g. 7% here + 2.5% inflation = 9.5% nominal growth), while expenses and tax brackets inflate too. With it OFF, everything runs in today's dollars and this rate applies directly."
                />
                <PercentageInput
                    label="Bond Return"
                    value={state.investments.returnRates.bondRor ?? 0}
                    onChange={(val) => dispatch({ type: "UPDATE_INVESTMENT_RATES", payload: { bondRor: val } })}
                    isAboveInflation={state.macro.inflationAdjusted}
                    tooltip="The return on the BOND (fixed income) share of your portfolio. Only affects accounts whose allocation is below 100% stock."
                />
                <PercentageInput
                    label="Stock Allocation"
                    value={stockPct}
                    onChange={(val) => dispatch({
                        type: "UPDATE_INVESTMENTS",
                        payload: { defaultAllocation: { stockPct: Math.min(100, Math.max(0, val)) } },
                    })}
                    tooltip="The default stock share for every investment account. The rest is bonds — 60 here means 60% stock / 40% bonds. Individual accounts can override this."
                />
            </div>

            <p className="text-xs text-content-muted mt-2">
                Default mix: {stockPct}% stock / {100 - stockPct}% bonds — a blended{" "}
                {blendedDefault.toFixed(2)}% return.
            </p>

            <div className="mt-4 pt-3 border-t border-border-subtle">
                <ToggleInput
                    label="Shift allocation over time (glidepath)"
                    enabled={glide?.enabled ?? false}
                    setEnabled={(enabled) => dispatch({
                        type: "UPDATE_INVESTMENTS",
                        payload: { allocationGlidepath: { ...glideDefaults, ...glide, enabled } },
                    })}
                />
                {glide?.enabled && (
                    <>
                        <p className="text-xs text-content-muted mt-2">
                            Moves the DEFAULT allocation linearly with age, holding flat outside the
                            band. Accounts with their own allocation are not affected.
                        </p>
                        <div className="grid grid-cols-2 gap-3 mt-3">
                            <NumberInput
                                label="Start Age"
                                value={glide.startAge}
                                onChange={(val) => updateGlide({ startAge: val })}
                            />
                            <PercentageInput
                                label="Stock % at Start"
                                value={glide.startStockPct}
                                onChange={(val) => updateGlide({ startStockPct: Math.min(100, Math.max(0, val)) })}
                            />
                            <NumberInput
                                label="End Age"
                                value={glide.endAge}
                                onChange={(val) => updateGlide({ endAge: val })}
                            />
                            <PercentageInput
                                label="Stock % at End"
                                value={glide.endStockPct}
                                onChange={(val) => updateGlide({ endStockPct: Math.min(100, Math.max(0, val)) })}
                            />
                        </div>
                        {glide.endAge <= glide.startAge && (
                            <AlertBanner severity="warning" size="sm" className="mt-3">
                                End age must be after start age — the whole plan currently uses the
                                end allocation ({glide.endStockPct}% stock).
                            </AlertBanner>
                        )}
                    </>
                )}
            </div>

            <SegmentedInput<boolean>
                className="mt-4"
                label="Inflation Adjusted"
                value={state.macro.inflationAdjusted}
                options={[
                    { value: true, label: "Enabled", caption: "Values grow with inflation over time" },
                    { value: false, label: "Disabled", caption: "All values shown in today's dollars" },
                ]}
                onChange={(val) => dispatch({ type: "UPDATE_MACRO", payload: { inflationAdjusted: val } })}
            />
        </div>
    );
}
