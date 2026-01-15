import { useContext, useState } from "react";
import { AssumptionsContext } from "../../components/Objects/Assumptions/AssumptionsContext";
import { NumberInput } from "../../components/Layout/InputFields/NumberInput";
import { PercentageInput } from "../../components/Layout/InputFields/PercentageInput";
import { DropdownInput } from "../../components/Layout/InputFields/DropdownInput";
import { ToggleInput } from "../../components/Layout/InputFields/ToggleInput";

export default function AssumptionTab() {
  const { state, dispatch } = useContext(AssumptionsContext);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6 pb-12">
        <div className="w-full px-4 sm:px-8 max-w-screen-xl">
            <div className="flex items-center justify-between mb-6 border-b border-gray-800 pb-2">
                <h2 className="text-2xl font-bold text-white">Assumptions</h2>
                <button
                    onClick={() => setShowHelp(!showHelp)}
                    className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {showHelp ? 'Hide help' : 'How this works'}
                </button>
            </div>

            {/* Expandable Help Section */}
            {showHelp && (
                <div className="mb-6 bg-blue-900/20 border border-blue-800/50 rounded-xl p-4 text-sm">
                    <h3 className="font-semibold text-blue-300 mb-2">Understanding Assumptions</h3>
                    <p className="text-gray-300 mb-3">
                        These settings control how your financial future is projected. Small changes here can have large impacts over decades, so choose values that reflect your expectations.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div className="space-y-2">
                            <h4 className="font-semibold text-gray-200">Key Settings:</h4>
                            <ul className="text-gray-400 space-y-1">
                                <li><span className="text-white">Retirement Age</span> — When work income stops</li>
                                <li><span className="text-white">Investment Return</span> — Expected annual growth (7% is historical avg)</li>
                                <li><span className="text-white">Inflation</span> — How fast prices rise (3% is typical)</li>
                                <li><span className="text-white">Withdrawal Rate</span> — % of portfolio taken yearly in retirement</li>
                            </ul>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-semibold text-gray-200">Inflation Adjusted Mode:</h4>
                            <ul className="text-gray-400 space-y-1">
                                <li><span className="text-green-400">Enabled</span> — Shows future values in future dollars (larger numbers)</li>
                                <li><span className="text-yellow-400">Disabled</span> — Shows everything in today's dollars (easier to understand)</li>
                            </ul>
                            <p className="text-gray-500 mt-2">Most people prefer disabled—$1M in 30 years means the same as $1M today.</p>
                        </div>
                    </div>
                    <p className="text-gray-400 mt-3 text-xs">
                        <span className="text-gray-300">Tip:</span> The 4% withdrawal rule suggests you can safely withdraw 4% of your portfolio annually. More conservative planners use 3-3.5%.
                    </p>
                </div>
            )}

            {/* Essential Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                {/* Left Column - Demographics & Returns */}
                <div className="bg-gray-900 border border-gray-800 p-5 rounded-xl shadow-lg space-y-5">
                    <h3 className="text-sm font-semibold text-white border-b border-gray-700 pb-2">Demographics</h3>

                    <div className="grid grid-cols-3 gap-3">
                        <NumberInput
                            label="Current Age"
                            value={state.demographics.startAge}
                            onChange={(val) => dispatch({ type: 'UPDATE_DEMOGRAPHICS', payload: { startAge: val } })}
                            tooltip="Your age today. Used to calculate your birth year for Social Security and other age-based projections."
                        />
                        <NumberInput
                            label="Retirement Age"
                            value={state.demographics.retirementAge}
                            onChange={(val) => dispatch({ type: 'UPDATE_DEMOGRAPHICS', payload: { retirementAge: val } })}
                            tooltip="Target age to stop working. At this age, work income stops and you'll begin withdrawing from investments. Check the Overview tab to see if you're on track."
                        />
                        <NumberInput
                            label="Life Expectancy"
                            value={state.demographics.lifeExpectancy}
                            onChange={(val) => dispatch({ type: 'UPDATE_DEMOGRAPHICS', payload: { lifeExpectancy: val } })}
                            tooltip="Age to project your finances to. Average US life expectancy is ~78, but many plan to 90+ for safety."
                        />
                    </div>

                    <div className="pt-4 border-t border-gray-800">
                        <h3 className="text-sm font-semibold text-white border-b border-gray-700 pb-2 mb-4">Growth Rates</h3>
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
                            <h4 className="text-xs uppercase text-gray-400 font-semibold mb-2">Inflation Adjusted</h4>
                            <div className="flex bg-gray-800 p-1 rounded-lg border border-gray-700">
                                <button
                                    onClick={() => dispatch({ type: "UPDATE_MACRO", payload: { inflationAdjusted: true } })}
                                    className={`flex-1 py-1.5 text-xs rounded-md transition-all ${state.macro.inflationAdjusted ? "bg-green-600 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                                >
                                    Enabled
                                </button>
                                <button
                                    onClick={() => dispatch({ type: "UPDATE_MACRO", payload: { inflationAdjusted: false } })}
                                    className={`flex-1 py-1.5 text-xs rounded-md transition-all ${!state.macro.inflationAdjusted ? "bg-green-600 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                                >
                                    Disabled
                                </button>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                                {state.macro.inflationAdjusted ? "Values grow with inflation over time" : "All values shown in today's dollars"}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Right Column - Withdrawal Strategy */}
                <div className="bg-gray-900 border border-gray-800 p-5 rounded-xl shadow-lg space-y-5">
                    <h3 className="text-sm font-semibold text-white border-b border-gray-700 pb-2">Retirement Withdrawals</h3>

                    <div className="grid grid-cols-2 gap-3">
                        <DropdownInput
                            label="Strategy"
                            value={state.investments.withdrawalStrategy}
                            options={['Fixed Real', 'Percentage', 'Guyton Klinger']}
                            onChange={(val) => dispatch({ type: 'UPDATE_INVESTMENTS', payload: { withdrawalStrategy: val as 'Fixed Real' | 'Percentage' | 'Guyton Klinger' } })}
                        />
                        <PercentageInput
                            label="Withdrawal Rate"
                            value={state.investments.withdrawalRate}
                            onChange={(val) => dispatch({ type: 'UPDATE_INVESTMENTS', payload: { withdrawalRate: val } })}
                        />
                    </div>

                    {/* Strategy Description */}
                    <div className="text-xs text-gray-400 bg-gray-800/50 rounded-lg p-3">
                        {state.investments.withdrawalStrategy === 'Fixed Real' && (
                            <p><span className="text-gray-300 font-medium">Fixed Real:</span> Withdraw a fixed percentage of your initial portfolio, adjusted for inflation each year. Predictable income that maintains purchasing power.</p>
                        )}
                        {state.investments.withdrawalStrategy === 'Percentage' && (
                            <p><span className="text-gray-300 font-medium">Percentage:</span> Withdraw a fixed percentage of your current portfolio each year. Income varies with market performance but portfolio never fully depletes.</p>
                        )}
                        {state.investments.withdrawalStrategy === 'Guyton Klinger' && (
                            <p><span className="text-gray-300 font-medium">Guyton-Klinger:</span> Dynamic strategy that adjusts spending based on portfolio performance. Cuts discretionary expenses in bad markets, increases them in good markets.</p>
                        )}
                    </div>

                    {/* Guyton-Klinger Settings */}
                    {state.investments.withdrawalStrategy === 'Guyton Klinger' && (
                        <div className="p-3 bg-emerald-900/20 rounded-lg border border-emerald-700/50 space-y-3">
                            <h4 className="text-xs uppercase text-emerald-400 font-semibold">Guardrail Settings</h4>
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

                </div>
            </div>

            {/* Advanced Settings Toggle */}
            <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4"
            >
                <span className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
                <span className="text-sm font-medium">Advanced Settings</span>
                {!showAdvanced && <span className="text-xs text-gray-400">(inflation details, income growth, expense assumptions)</span>}
            </button>

            {/* Advanced Settings Panel */}
            {showAdvanced && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 animate-in fade-in duration-200">
                    {/* Inflation & Display */}
                    <div className="bg-gray-900 border border-gray-800 p-5 rounded-xl shadow-lg space-y-4">
                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-800 pb-2">Inflation & Display</h3>

                        <PercentageInput
                            label="Healthcare Inflation"
                            value={state.macro.healthcareInflation}
                            onChange={(val) => dispatch({ type: 'UPDATE_MACRO', payload: { healthcareInflation: val } })}
                            isAboveInflation={state.macro.inflationAdjusted}
                        />

                        <div>
                            <h4 className="text-xs uppercase text-gray-400 font-semibold mb-2">Number Display</h4>
                            <div className="flex bg-gray-800 p-1 rounded-lg border border-gray-700">
                                <button
                                    onClick={() => dispatch({ type: "UPDATE_DISPLAY", payload: { useCompactCurrency: true } })}
                                    className={`flex-1 py-1.5 text-xs rounded-md transition-all ${state.display?.useCompactCurrency !== false ? "bg-green-600 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                                >
                                    Compact
                                </button>
                                <button
                                    onClick={() => dispatch({ type: "UPDATE_DISPLAY", payload: { useCompactCurrency: false } })}
                                    className={`flex-1 py-1.5 text-xs rounded-md transition-all ${state.display?.useCompactCurrency === false ? "bg-green-600 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                                >
                                    Full
                                </button>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                                {state.display?.useCompactCurrency !== false
                                    ? "Shows $1.2M instead of $1,200,000"
                                    : "Shows full numbers like $1,200,000"}
                            </p>
                        </div>

                        <ToggleInput
                            label="Experimental"
                            enabled={state.display?.showExperimentalFeatures ?? false}
                            setEnabled={(val) => dispatch({ type: "UPDATE_DISPLAY", payload: { showExperimentalFeatures: val } })}
                            tooltip="Show Tax, Scenarios, and Ratios tabs"
                        />

                        <ToggleInput
                            label="Auto Roth Conversions"
                            enabled={state.investments.autoRothConversions ?? false}
                            setEnabled={(val) => dispatch({ type: 'UPDATE_INVESTMENTS', payload: { autoRothConversions: val } })}
                            tooltip="During retirement, automatically convert Traditional to Roth to fill lower tax brackets (up to 22%). Assumes withdrawals in retirement would be taxed at 22% or higher."
                        />

                        <NumberInput
                            label="Starting Year"
                            value={state.demographics.startYear}
                            onChange={(val) => dispatch({ type: 'UPDATE_DEMOGRAPHICS', payload: { startYear: val } })}
                        />
                    </div>

                    {/* Income Settings */}
                    <div className="bg-gray-900 border border-gray-800 p-5 rounded-xl shadow-lg space-y-4">
                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-800 pb-2">Income</h3>

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
                            tooltip="Turn off if you won't receive Social Security benefits (e.g., some government employees, non-US citizens)."
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
                    </div>

                    {/* Expense Settings */}
                    <div className="bg-gray-900 border border-gray-800 p-5 rounded-xl shadow-lg space-y-4">
                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-800 pb-2">Expenses</h3>

                        <PercentageInput
                            label="Lifestyle Creep"
                            value={state.expenses.lifestyleCreep}
                            onChange={(val) => dispatch({ type: 'UPDATE_EXPENSES', payload: { lifestyleCreep: val } })}
                            tooltip="% of each raise that increases spending"
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
                    </div>
                </div>
            )}

            {/* Footer Actions */}
            <div className="flex items-center justify-end pt-4 border-t border-gray-800">
                <button
                    onClick={() => dispatch({ type: 'RESET_DEFAULTS' })}
                    className="text-xs font-medium text-red-500 hover:text-red-400 transition-colors px-3 py-1.5 border border-red-900/50 rounded hover:bg-red-900/10"
                >
                    Reset to Defaults
                </button>
            </div>
        </div>
    </div>
  );
}
