import { useContext, useState, useMemo } from "react";
import { AssumptionsContext } from "../../components/Objects/Assumptions/AssumptionsContext";
import { ExpenseContext } from "../../components/Objects/Expense/ExpenseContext";
import { PercentageInput } from "../../components/Layout/InputFields/PercentageInput";
import { DropdownInput } from "../../components/Layout/InputFields/DropdownInput";
import { ToggleInput } from "../../components/Layout/InputFields/ToggleInput";
import MilestoneModal from "../../components/Objects/Assumptions/MilestoneModal";
import { Panel } from "../../components/Layout/Primitives";

export default function AssumptionTab() {
  const { state, dispatch } = useContext(AssumptionsContext);
  const { expenses } = useContext(ExpenseContext);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);

  // Check if there are any discretionary expenses
  const hasDiscretionaryExpenses = useMemo(() => {
    return expenses.some(exp => exp.isDiscretionary);
  }, [expenses]);

  return (
    <div className="w-full min-h-full flex bg-surface-base justify-center pt-6 pb-24">
        <div className="w-full px-4 sm:px-8 max-w-7-xl">
            <div className="flex items-center justify-between mb-6 border-b border-border-subtle pb-2">
                <h2 className="text-2xl font-bold text-white">Assumptions</h2>
                <button
                    onClick={() => setShowHelp(!showHelp)}
                    className="text-xs text-content-muted hover:text-white flex items-center gap-1 transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {showHelp ? 'Hide help' : 'How this works'}
                </button>
            </div>

            {/* Expandable Help Section */}
            {showHelp && (
                <div className="mb-6 bg-info-tint/20 border border-info-strong/50 rounded-xl p-4 text-sm">
                    <h3 className="font-semibold text-info-bright mb-2">Understanding Assumptions</h3>
                    <p className="text-content-default mb-3">
                        These settings control how your financial future is projected. Small changes here can have large impacts over decades, so choose values that reflect your expectations.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div className="space-y-2">
                            <h4 className="font-semibold text-content-emphasis">Key Settings:</h4>
                            <ul className="text-content-muted space-y-1">
                                <li><span className="text-white">Milestones</span> — Birth year, retirement age, life expectancy</li>
                                <li><span className="text-white">Investment Return</span> — Expected annual growth (7% is historical avg)</li>
                                <li><span className="text-white">Inflation</span> — How fast prices rise (3% is typical)</li>
                                <li><span className="text-white">Withdrawal Rate</span> — % of portfolio taken yearly in retirement</li>
                            </ul>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-semibold text-content-emphasis">Inflation Adjusted Mode:</h4>
                            <ul className="text-content-muted space-y-1">
                                <li><span className="text-positive">Enabled</span> — Shows future values in future dollars (larger numbers)</li>
                                <li><span className="text-warning">Disabled</span> — Shows everything in today's dollars (easier to understand)</li>
                            </ul>
                            <p className="text-content-subtle mt-2">Most people prefer disabled—$1M in 30 years means the same as $1M today.</p>
                        </div>
                    </div>
                    <p className="text-content-muted mt-3 text-xs">
                        <span className="text-content-default">Tip:</span> The 4% withdrawal rule suggests you can safely withdraw 4% of your portfolio annually. More conservative planners use 3-3.5%.
                    </p>
                </div>
            )}

            {/* Essential Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                {/* Left Column - Milestones & Growth Rates */}
                <Panel padding="none" className="p-5 shadow-lg space-y-5">
                    <div>
                        <h3 className="text-sm font-semibold text-white border-b border-border-default pb-2 mb-3">Milestones</h3>
                        <button
                            onClick={() => setShowMilestoneModal(true)}
                            className="w-full flex items-center justify-between px-3 py-2 bg-surface-overlay hover:bg-surface-input border border-border-default rounded-lg text-sm font-medium text-content-emphasis transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-cat-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                                </svg>
                                <span>Edit Milestones</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-content-muted">{state.milestones?.length || 0} defined</span>
                                <svg className="w-4 h-4 text-content-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </div>
                        </button>
                        <p className="text-xs text-content-muted mt-2">Birth year, retirement age, life expectancy, and custom goals.</p>
                    </div>

                    <div className="pt-4 border-t border-border-subtle">
                        <h3 className="text-sm font-semibold text-white border-b border-border-default pb-2 mb-3">Growth Rates</h3>
                    <p className="text-xs text-info">All growth rates are real (above inflation), not nominal.</p>
                    <div className="grid grid-cols-2 gap-3">
                        <div className={`transition-opacity duration-300 ${!state.macro.inflationAdjusted ? 'opacity-50' : 'opacity-100'}`}>
                            <PercentageInput
                                label="Inflation"
                                value={state.macro.inflationRate}
                                onChange={(val) => dispatch({ type: 'UPDATE_MACRO', payload: { inflationRate: val } })}
                                disabled={!state.macro.inflationAdjusted}
                            />
                        </div>
                        <PercentageInput
                            label="Investment Return"
                            value={state.investments.returnRates.ror}
                            onChange={(val) => dispatch({ type: 'UPDATE_INVESTMENT_RATES', payload: { ror: val } })}
                            isAboveInflation={state.macro.inflationAdjusted}
                        />
                    </div>

                    <div className="mt-4">
                        <h4 className="text-xs uppercase text-content-muted font-semibold mb-2">Inflation Adjusted</h4>
                        <div className="flex bg-surface-overlay p-1 rounded-lg border border-border-default">
                            <button
                                onClick={() => dispatch({ type: "UPDATE_MACRO", payload: { inflationAdjusted: true } })}
                                className={`flex-1 py-1.5 text-xs rounded-md transition-all ${state.macro.inflationAdjusted ? "bg-positive-solid text-white shadow-lg" : "text-content-muted hover:text-white"}`}
                            >
                                Enabled
                            </button>
                            <button
                                onClick={() => dispatch({ type: "UPDATE_MACRO", payload: { inflationAdjusted: false } })}
                                className={`flex-1 py-1.5 text-xs rounded-md transition-all ${!state.macro.inflationAdjusted ? "bg-positive-solid text-white shadow-lg" : "text-content-muted hover:text-white"}`}
                            >
                                Disabled
                            </button>
                        </div>
                        <p className="text-xs text-content-muted mt-1">
                            {state.macro.inflationAdjusted ? "Values grow with inflation over time" : "All values shown in today's dollars"}
                        </p>
                    </div>
                    </div>
                </Panel>

                {/* Right Column - Withdrawal Strategy */}
                <Panel padding="none" className="p-5 shadow-lg space-y-5">
                    <h3 className="text-sm font-semibold text-white border-b border-border-default pb-2">Retirement Withdrawals</h3>

                    <div className="grid grid-cols-2 gap-3">
                        <DropdownInput
                            label="Strategy"
                            value={state.investments.withdrawalStrategy}
                            options={['None', 'Needs Based', 'Fixed Real', 'Percentage', 'Guyton Klinger']}
                            onChange={(val) => dispatch({ type: 'UPDATE_INVESTMENTS', payload: { withdrawalStrategy: val as 'None' | 'Needs Based' | 'Fixed Real' | 'Percentage' | 'Guyton Klinger' } })}
                        />
                        {state.investments.withdrawalStrategy !== 'None' && state.investments.withdrawalStrategy !== 'Needs Based' && (
                        <PercentageInput
                            label="Withdrawal Rate"
                            value={state.investments.withdrawalRate}
                            onChange={(val) => dispatch({ type: 'UPDATE_INVESTMENTS', payload: { withdrawalRate: val } })}
                        />
                        )}
                    </div>

                    {/* Strategy Description */}
                    <div className="text-xs text-content-muted bg-surface-overlay/50 rounded-lg p-3">
                        {state.investments.withdrawalStrategy === 'None' && (
                            <p><span className="text-content-default font-medium">None:</span> Withdraw exactly what your listed expenses require. No target rate — accounts are drawn down as needed to cover your planned spending.</p>
                        )}
                        {state.investments.withdrawalStrategy === 'Needs Based' && (
                            <p><span className="text-content-default font-medium">Needs Based:</span> Withdraw exactly what your expenses require — no more, no less. Surplus income is invested; deficits are covered by withdrawals. Discretionary spending is never adjusted.</p>
                        )}
                        {state.investments.withdrawalStrategy === 'Fixed Real' && (
                            <p><span className="text-content-default font-medium">Fixed Real:</span> Withdraw a fixed percentage of your initial portfolio, adjusted for inflation each year. Discretionary expenses are adjusted (up or down) to match this budget.</p>
                        )}
                        {state.investments.withdrawalStrategy === 'Percentage' && (
                            <p><span className="text-content-default font-medium">Percentage:</span> Withdraw a fixed percentage of your current portfolio each year. Discretionary expenses are adjusted (up or down) to fit the budget, which naturally varies with market performance.</p>
                        )}
                        {state.investments.withdrawalStrategy === 'Guyton Klinger' && (
                            <p><span className="text-content-default font-medium">Guyton-Klinger:</span> Dynamic strategy that adjusts spending based on portfolio performance. Cuts discretionary expenses in bad markets, increases them in good markets.</p>
                        )}
                    </div>

                    {/* Guyton-Klinger Info */}
                    {state.investments.withdrawalStrategy === 'Guyton Klinger' && (
                        <div className="p-3 bg-info-tint/20 rounded-lg border border-info-strong/50 text-xs text-info-bright">
                            <p className="font-medium text-info-bright mb-1">Note: Large Spending Swings Possible</p>
                            <p>The Guyton-Klinger strategy adjusts spending by {state.investments.gkAdjustmentPercent}% of your withdrawal amount when guardrails trigger. This can result in significant year-over-year changes in discretionary expenses, especially when your portfolio performs very well (prosperity) or poorly (capital preservation).</p>
                        </div>
                    )}

                    {/* Guyton-Klinger Settings */}
                    {state.investments.withdrawalStrategy === 'Guyton Klinger' && (
                        <div className="p-3 bg-positive-tint/20 rounded-lg border border-positive-strong/50 space-y-3">
                            <h4 className="text-xs uppercase text-positive font-semibold">Guardrail Settings</h4>
                            <div className="grid grid-cols-3 gap-2">
                                <PercentageInput
                                    label="Upper"
                                    value={Math.round((state.investments.gkUpperGuardrail - 1) * 10000) / 100}
                                    onChange={(val) => dispatch({ type: 'UPDATE_INVESTMENTS', payload: { gkUpperGuardrail: 1 + val / 100 } })}
                                    tooltip="Cut spending when withdrawal rate exceeds target by this %"
                                />
                                <PercentageInput
                                    label="Lower"
                                    value={Math.round((1 - state.investments.gkLowerGuardrail) * 10000) / 100}
                                    onChange={(val) => dispatch({ type: 'UPDATE_INVESTMENTS', payload: { gkLowerGuardrail: 1 - val / 100 } })}
                                    tooltip="Increase spending when withdrawal rate is below target by this %"
                                />
                                <PercentageInput
                                    label="Adjustment"
                                    value={state.investments.gkAdjustmentPercent}
                                    onChange={(val) => dispatch({ type: 'UPDATE_INVESTMENTS', payload: { gkAdjustmentPercent: val } })}
                                    tooltip="How much to cut/increase discretionary expenses"
                                />
                            </div>
                        </div>
                    )}

                </Panel>
            </div>

            {/* Advanced Settings Toggle */}
            <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-content-muted hover:text-white transition-colors mb-4"
            >
                <svg
                    className={`w-4 h-4 transition-transform duration-200 ${showAdvanced ? 'rotate-0' : '-rotate-90'}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                >
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-medium">Advanced Settings</span>
                {!showAdvanced && <span className="text-xs text-content-muted">(inflation details, income growth, expense assumptions)</span>}
            </button>

            {/* Advanced Settings Panel */}
            {showAdvanced && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 animate-in fade-in duration-200">
                    {/* Inflation & Display */}
                    <Panel padding="none" className="p-5 shadow-lg space-y-4">
                        <h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider border-b border-border-subtle pb-2">Inflation & Display</h3>

                        <PercentageInput
                            label="Healthcare Inflation"
                            value={state.macro.healthcareInflation}
                            onChange={(val) => dispatch({ type: 'UPDATE_MACRO', payload: { healthcareInflation: val } })}
                            isAboveInflation={state.macro.inflationAdjusted}
                        />

                        <div>
                            <h4 className="text-xs uppercase text-content-muted font-semibold mb-2">Number Display</h4>
                            <div className="flex bg-surface-overlay p-1 rounded-lg border border-border-default">
                                <button
                                    onClick={() => dispatch({ type: "UPDATE_DISPLAY", payload: { useCompactCurrency: true } })}
                                    className={`flex-1 py-1.5 text-xs rounded-md transition-all ${state.display?.useCompactCurrency !== false ? "bg-positive-solid text-white shadow-lg" : "text-content-muted hover:text-white"}`}
                                >
                                    Compact
                                </button>
                                <button
                                    onClick={() => dispatch({ type: "UPDATE_DISPLAY", payload: { useCompactCurrency: false } })}
                                    className={`flex-1 py-1.5 text-xs rounded-md transition-all ${state.display?.useCompactCurrency === false ? "bg-positive-solid text-white shadow-lg" : "text-content-muted hover:text-white"}`}
                                >
                                    Full
                                </button>
                            </div>
                            <p className="text-xs text-content-muted mt-1">
                                {state.display?.useCompactCurrency !== false
                                    ? "Shows $1.2M instead of $1,200,000"
                                    : "Shows full numbers like $1,200,000"}
                            </p>
                        </div>

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

                        <ToggleInput
                            label="ACA-Aware Conversions"
                            enabled={state.investments.acaAware ?? true}
                            setEnabled={(val) => dispatch({ type: 'UPDATE_INVESTMENTS', payload: { acaAware: val } })}
                            tooltip="Limit Roth conversions before age 65 to stay under the ACA subsidy cliff. Turn off to allow larger conversions if you have non-ACA health coverage."
                        />

                        <ToggleInput
                            label="Prior Year Mode"
                            enabled={state.demographics.priorYearMode ?? false}
                            setEnabled={(val) => dispatch({ type: 'UPDATE_DEMOGRAPHICS', payload: { priorYearMode: val } })}
                            tooltip="Start simulation from last year using verified data. Current year will be estimated using inflation rates."
                        />
                    </Panel>

                    {/* Income Settings */}
                    <Panel padding="none" className="p-5 shadow-lg space-y-4">
                        <h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider border-b border-border-subtle pb-2">Income</h3>

                        <PercentageInput
                            label="Salary Growth"
                            value={state.income.salaryGrowth}
                            onChange={(val) => dispatch({ type: 'UPDATE_INCOME', payload: { salaryGrowth: val } })}
                            isAboveInflation={state.macro.inflationAdjusted}
                        />
                        <ToggleInput
                            label="Qualifies for Social Security"
                            enabled={state.income.qualifiesForSocialSecurity}
                            setEnabled={(val) => dispatch({ type: 'UPDATE_INCOME', payload: { qualifiesForSocialSecurity: val } })}
                            tooltip="Turn off to hide the 'Social Security Not Configured' warning."
                        />
                        {state.income.qualifiesForSocialSecurity && (
                            <PercentageInput
                                label="SS Benefit Level"
                                value={state.income.socialSecurityFundingPercent}
                                onChange={(val) => dispatch({ type: 'UPDATE_INCOME', payload: { socialSecurityFundingPercent: val } })}
                                max={100}
                                tooltip="Expected percentage of promised SS benefits you'll receive. Use 100% if optimistic, 75-80% if concerned about SS solvency, or lower for conservative planning."
                            />
                        )}
                    </Panel>

                    {/* Expense Settings */}
                    <Panel padding="none" className="p-5 shadow-lg space-y-4">
                        <h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider border-b border-border-subtle pb-2">Expenses</h3>

                        <PercentageInput
                            label="Lifestyle Creep"
                            value={hasDiscretionaryExpenses ? state.expenses.lifestyleCreep : 0}
                            onChange={(val) => dispatch({ type: 'UPDATE_EXPENSES', payload: { lifestyleCreep: val } })}
                            tooltip={hasDiscretionaryExpenses
                                ? "% of each raise that increases discretionary spending"
                                : "No discretionary expenses - mark expenses as discretionary in the Expenses tab to enable this"}
                            disabled={!hasDiscretionaryExpenses}
                        />
                        <PercentageInput
                            label="Housing Appreciation"
                            value={state.expenses.housingAppreciation}
                            onChange={(val) => dispatch({ type: 'UPDATE_EXPENSES', payload: { housingAppreciation: val } })}
                            isAboveInflation={state.macro.inflationAdjusted}
                        />
                        <PercentageInput
                            label="Rent Inflation"
                            value={state.expenses.rentInflation}
                            onChange={(val) => dispatch({ type: 'UPDATE_EXPENSES', payload: { rentInflation: val } })}
                            isAboveInflation={state.macro.inflationAdjusted}
                        />
                    </Panel>
                </div>
            )}

            {/* Footer Actions */}
            <div className="flex items-center justify-end pt-4 border-t border-border-subtle">
                <button
                    onClick={() => dispatch({ type: 'RESET_DEFAULTS' })}
                    className="text-xs font-medium text-negative-soft hover:text-negative transition-colors px-3 py-1.5 border border-negative-tint/50 rounded hover:bg-negative-tint/10"
                >
                    Reset to Defaults
                </button>
            </div>
        </div>

        <MilestoneModal
            isOpen={showMilestoneModal}
            onClose={() => setShowMilestoneModal(false)}
        />
    </div>
  );
}
