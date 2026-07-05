import { ReactElement, useContext, useMemo, useState } from "react";
import { AssumptionsContext } from "../../../components/Objects/Assumptions/AssumptionsContext";
import { ExpenseContext } from "../../../components/Objects/Expense/ExpenseContext";
import { PercentageInput } from "../../../components/Layout/InputFields/PercentageInput";
import { ToggleInput } from "../../../components/Layout/InputFields/ToggleInput";
import { SegmentedInput } from "../../../components/Layout/InputFields/SegmentedInput";
import { ChevronIcon } from "../../../components/Layout/Icons/ChevronIcon";
import { Panel } from "../../../components/Layout/Primitives";

/**
 * Collapsible Advanced Settings: simulation model details (rarely-touched
 * rates and modes) and plain app preferences (display/dev toggles).
 */
export function AdvancedSettingsSection(): ReactElement {
    const { state, dispatch } = useContext(AssumptionsContext);
    const { expenses } = useContext(ExpenseContext);
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Lifestyle creep only means something when discretionary expenses exist.
    const hasDiscretionaryExpenses = useMemo(
        () => expenses.some((exp) => exp.isDiscretionary),
        [expenses],
    );

    return (
        <>
            <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-content-muted hover:text-white transition-colors mb-4"
            >
                <ChevronIcon expanded={showAdvanced} />
                <span className="text-sm font-medium">Advanced Settings</span>
                {!showAdvanced && <span className="text-xs text-content-muted">(model details & app preferences)</span>}
            </button>

            {showAdvanced && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 animate-in fade-in duration-200">
                    {/* Model Details — assumptions that feed the simulation */}
                    <Panel padding="none" className="p-5 shadow-lg space-y-4">
                        <h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider border-b border-border-subtle pb-2">Model Details</h3>

                        <PercentageInput
                            label="Healthcare Inflation"
                            value={state.macro.healthcareInflation}
                            onChange={(val) => dispatch({ type: "UPDATE_MACRO", payload: { healthcareInflation: val } })}
                            isAboveInflation={state.macro.inflationAdjusted}
                        />
                        <PercentageInput
                            label="Salary Growth"
                            value={state.income.salaryGrowth}
                            onChange={(val) => dispatch({ type: "UPDATE_INCOME", payload: { salaryGrowth: val } })}
                            isAboveInflation={state.macro.inflationAdjusted}
                        />
                        <ToggleInput
                            label="Qualifies for Social Security"
                            enabled={state.income.qualifiesForSocialSecurity}
                            setEnabled={(val) => dispatch({ type: "UPDATE_INCOME", payload: { qualifiesForSocialSecurity: val } })}
                            tooltip="Turn off to hide the 'Social Security Not Configured' warning."
                        />
                        {state.income.qualifiesForSocialSecurity && (
                            <PercentageInput
                                label="SS Benefit Level"
                                value={state.income.socialSecurityFundingPercent}
                                onChange={(val) => dispatch({ type: "UPDATE_INCOME", payload: { socialSecurityFundingPercent: val } })}
                                max={100}
                                tooltip="Expected percentage of promised SS benefits you'll receive. Use 100% if optimistic, 75-80% if concerned about SS solvency, or lower for conservative planning."
                            />
                        )}
                        <PercentageInput
                            label="Lifestyle Creep"
                            value={hasDiscretionaryExpenses ? state.expenses.lifestyleCreep : 0}
                            onChange={(val) => dispatch({ type: "UPDATE_EXPENSES", payload: { lifestyleCreep: val } })}
                            tooltip={hasDiscretionaryExpenses
                                ? "% of each raise that increases discretionary spending"
                                : "No discretionary expenses - mark expenses as discretionary in the Expenses tab to enable this"}
                            disabled={!hasDiscretionaryExpenses}
                        />
                        <PercentageInput
                            label="Housing Appreciation"
                            value={state.expenses.housingAppreciation}
                            onChange={(val) => dispatch({ type: "UPDATE_EXPENSES", payload: { housingAppreciation: val } })}
                            isAboveInflation={state.macro.inflationAdjusted}
                        />
                        <PercentageInput
                            label="Rent Inflation"
                            value={state.expenses.rentInflation}
                            onChange={(val) => dispatch({ type: "UPDATE_EXPENSES", payload: { rentInflation: val } })}
                            isAboveInflation={state.macro.inflationAdjusted}
                        />
                        <ToggleInput
                            label="Prior Year Mode"
                            enabled={state.demographics.priorYearMode ?? false}
                            setEnabled={(val) => dispatch({ type: "UPDATE_DEMOGRAPHICS", payload: { priorYearMode: val } })}
                            tooltip="Start simulation from last year using verified data. Current year will be estimated using inflation rates."
                        />
                    </Panel>

                    {/* App Settings — plain app preferences; they don't change the projection */}
                    <Panel padding="none" className="p-5 shadow-lg space-y-4">
                        <h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider border-b border-border-subtle pb-2">App Settings</h3>
                        <p className="text-xs text-content-muted">App preferences — these don't change the projection.</p>

                        <SegmentedInput<boolean>
                            label="Number Display"
                            value={state.display?.useCompactCurrency !== false}
                            options={[
                                { value: true, label: "Compact", caption: "Shows $1.2M instead of $1,200,000" },
                                { value: false, label: "Full", caption: "Shows full numbers like $1,200,000" },
                            ]}
                            onChange={(val) => dispatch({ type: "UPDATE_DISPLAY", payload: { useCompactCurrency: val } })}
                        />
                        <ToggleInput
                            label="Experimental"
                            enabled={state.display?.showExperimentalFeatures ?? false}
                            setEnabled={(val) => dispatch({ type: "UPDATE_DISPLAY", payload: { showExperimentalFeatures: val } })}
                            tooltip="Show experimental calculators in the Testing tab"
                        />
                        <ToggleInput
                            label="Developer tools"
                            enabled={state.display?.showDevTools ?? false}
                            setEnabled={(val) => dispatch({ type: "UPDATE_DISPLAY", payload: { showDevTools: val } })}
                            tooltip="Show the Testing tab and chart self-check diagnostics."
                        />
                    </Panel>
                </div>
            )}
        </>
    );
}
