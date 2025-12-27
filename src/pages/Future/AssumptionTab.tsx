import { useContext } from "react";
import { AssumptionsContext } from "../../components/Assumptions/AssumptionsContext";
import { NumberInput } from "../../components/Layout/NumberInput";
import { PercentageInput } from "../../components/Layout/PercentageInput";
import { DropdownInput } from "../../components/Layout/DropdownInput";

export default function AssumptionTab() {
  const { state, dispatch } = useContext(AssumptionsContext);

  return (
    <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6">
        <div className="w-full px-8 max-w-screen-2xl">
            <h2 className="text-2xl font-bold text-white mb-6 border-b border-gray-800 pb-2">
                Assumptions
            </h2>

            <h2 className="text-xl font-semibold text-gray-300 mb-6 col-span-full">Assumption Settings</h2>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Column 1 */}
                <div className="bg-gray-900 border border-gray-800 p-6 rounded-2xl shadow-xl h-fit space-y-6">
                    {/* Macro Assumptions */}
                    <div>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-800 pb-2">Macro</h3>
                        <div className="space-y-4">
                            <div className={`transition-opacity duration-300 ${!state.macro.inflationAdjusted ? 'opacity-50' : 'opacity-100'}`}>
                                <PercentageInput
                                    label="Inflation Rate"
                                    value={state.macro.inflationRate}
                                    onChange={(val) => dispatch({ type: 'UPDATE_MACRO', payload: { inflationRate: val } })}
                                    disabled={!state.macro.inflationAdjusted}
                                />
                            </div>
                            <PercentageInput
                                label="Healthcare Inflation"
                                value={state.macro.healthcareInflation}
                                onChange={(val) => dispatch({ type: 'UPDATE_MACRO', payload: { healthcareInflation: val } })}
                                isAboveInflation={state.macro.inflationAdjusted}
                            />
                            <div>
                                <label className="block text-xs font-medium text-gray-500 uppercase mb-2">
                                    Inflation Adjusted
                                </label>
                                <div className="flex bg-gray-800 p-1 rounded-lg border border-gray-700">
                                    <button
                                        onClick={() => dispatch({ type: "UPDATE_MACRO", payload: { inflationAdjusted: true } })}
                                        className={`flex-1 py-2 text-sm rounded-md transition-all ${state.macro.inflationAdjusted ? "bg-green-600 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                                    >
                                        Enabled
                                    </button>
                                    <button
                                        onClick={() => dispatch({ type: "UPDATE_MACRO", payload: { inflationAdjusted: false } })}
                                        className={`flex-1 py-2 text-sm rounded-md transition-all ${!state.macro.inflationAdjusted ? "bg-green-600 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                                    >
                                        Disabled
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Income Assumptions */}
                    <div className="pt-6 border-t border-gray-800">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-800 pb-2">Investments</h3>
                        <div className="space-y-4">
                            <PercentageInput
                                label="Estimated Rate of Return"
                                value={state.investments.returnRates.ror}
                                onChange={(val) => dispatch({ type: 'UPDATE_INVESTMENT_RATES', payload: { ror: val } })}
                                isAboveInflation={state.macro.inflationAdjusted}
                            />

                        </div>
                        
                    </div>
                </div>

                {/* Column 2 */}
                <div className="bg-gray-900 border border-gray-800 p-6 rounded-2xl shadow-xl h-fit space-y-6">
                    {/* Expenses Assumptions */}
                    <div>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-800 pb-2">Income</h3>
                        <div className="space-y-4">
                            <PercentageInput
                                label="Salary Growth"
                                value={state.income.salaryGrowth}
                                onChange={(val) => dispatch({ type: 'UPDATE_INCOME', payload: { salaryGrowth: val } })}
                                isAboveInflation={state.macro.inflationAdjusted}
                            />
                            <NumberInput
                                label="Social Security Start Age"
                                value={state.income.socialSecurityStartAge}
                                onChange={(val) => dispatch({ type: 'UPDATE_INCOME', payload: { socialSecurityStartAge: val } })}
                            />
                        </div>
                    </div>

                    {/* Investments Assumptions (part 1) */}
                    <div className="pt-6 border-t border-gray-800">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-800 pb-2">Expenses</h3>
                        <div className="space-y-4">
                            <PercentageInput
                                label="Lifestyle Creep (% of Raise Spent)"
                                value={state.expenses.lifestyleCreep}
                                onChange={(val) => dispatch({ type: 'UPDATE_EXPENSES', payload: { lifestyleCreep: val } })}
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
                </div>

                {/* Column 3 */}
                <div className="bg-gray-900 border border-gray-800 p-6 rounded-2xl shadow-xl h-fit space-y-6">
                    {/* Investments Assumptions (part 2) */}
                    <div>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-800 pb-2">Investment Strategy</h3>
                        <div className="space-y-4">
                            <DropdownInput
                                label="Withdrawal Strategy"
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
                    </div>

                    {/* Demographics Assumptions */}
                    <div className="pt-6 border-t border-gray-800">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-800 pb-2">Demographics</h3>
                        <div className="space-y-4">
                            <NumberInput
                                label="Retirement Age"
                                value={state.demographics.retirementAge}
                                onChange={(val) => dispatch({ type: 'UPDATE_DEMOGRAPHICS', payload: { retirementAge: val } })}
                            />
                            <NumberInput
                                label="Life Expectancy"
                                value={state.demographics.lifeExpectancy}
                                onChange={(val) => dispatch({ type: 'UPDATE_DEMOGRAPHICS', payload: { lifeExpectancy: val } })}
                            />
                        </div>
                    </div>

                    {/* Reset Defaults Button */}
                    <div className="pt-6 border-t border-gray-800">
                        <button
                            onClick={() => dispatch({ type: 'RESET_DEFAULTS' })}
                            className="w-full text-sm font-bold text-red-500 hover:text-red-400 transition-colors uppercase py-2 border border-red-900/50 rounded-md hover:bg-red-900/10"
                        >
                            Reset to Defaults
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
}