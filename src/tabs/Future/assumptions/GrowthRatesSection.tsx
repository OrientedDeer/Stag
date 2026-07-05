import { ReactElement, useContext } from "react";
import { AssumptionsContext } from "../../../components/Objects/Assumptions/AssumptionsContext";
import { PercentageInput } from "../../../components/Layout/InputFields/PercentageInput";
import { SegmentedInput } from "../../../components/Layout/InputFields/SegmentedInput";

/**
 * Growth Rates section (Inflation, Investment Return, Inflation Adjusted mode).
 * Rendered inside the left Assumptions panel, below Plan Basics.
 */
export function GrowthRatesSection(): ReactElement {
    const { state, dispatch } = useContext(AssumptionsContext);

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
                    label="Investment Return"
                    value={state.investments.returnRates.ror}
                    onChange={(val) => dispatch({ type: "UPDATE_INVESTMENT_RATES", payload: { ror: val } })}
                    isAboveInflation={state.macro.inflationAdjusted}
                    tooltip="With Inflation Adjusted ON, this is your REAL (after-inflation) return: investments grow at this rate PLUS inflation (e.g. 7% here + 2.5% inflation = 9.5% nominal growth), while expenses and tax brackets inflate too. With it OFF, everything runs in today's dollars and this rate applies directly."
                />
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
