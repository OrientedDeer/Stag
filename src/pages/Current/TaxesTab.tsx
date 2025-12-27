import { useContext } from "react";
import { IncomeContext } from "../../components/Income/IncomeContext";
import { ExpenseContext } from "../../components/Expense/ExpenseContext";
import { TaxContext } from "../../components/Taxes/TaxContext";
import { TAX_DATABASE, FilingStatus } from "../../components/Taxes/TaxData";
import {
    calculateFicaTax,
    getGrossIncome,
    getPreTaxExemptions,
    getEarnedIncome,
    getPostTaxExemptions,
    getItemizedDeductions,
    getYesDeductions,
    calculateFederalTax,
    calculateStateTax,
    getPostTaxEmployerMatch
} from "../../components/Taxes/TaxService";
import { CurrencyInput } from "../../components/Layout/CurrencyInput";

// Suggestion: Create a 'useTax' hook in TaxContext.tsx that handles the null check
// and throws an error if the provider is missing.

export default function TaxesTab() {
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state, dispatch } = useContext(TaxContext);

    const currentYear = 2025;
    
    const stateTax = calculateStateTax(state, incomes, expenses, currentYear);
    const federalTax = calculateFederalTax(state, incomes, expenses, currentYear);
    const ficaTax = calculateFicaTax(state, incomes, currentYear);
    const annualGross = getGrossIncome(incomes);
    
    const stateItemized = getItemizedDeductions(expenses, currentYear);
    const federalItemizedTotal = stateItemized + stateTax;
    const stateParams = TAX_DATABASE.states[state.stateResidency]?.[currentYear]?.[state.filingStatus];
    const stateStandardDeduction = stateParams.standardDeduction;
    const fedParams = TAX_DATABASE.federal[currentYear][state.filingStatus];
    const fedStandardDeduction = fedParams.standardDeduction;
    const fedAppliedMainDeduction =
        state.deductionMethod === "Standard" ? fedStandardDeduction : federalItemizedTotal;
    const incomePreTaxDeductions = getPreTaxExemptions(incomes);
    const incomePostTaxDeductions = getPostTaxExemptions(incomes);
    const expenseAboveLineDeductions = getYesDeductions(expenses, currentYear);
    const postTaxEmployerMatch = getPostTaxEmployerMatch(incomes);
    const totalPreTaxDeductions = incomePreTaxDeductions + expenseAboveLineDeductions;
    const netPaycheck = annualGross - incomePreTaxDeductions - (federalTax + stateTax + ficaTax) - incomePostTaxDeductions - postTaxEmployerMatch;

    return (
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6">
            <div className="w-full px-8 max-w-screen-2xl">
                <h2 className="text-2xl font-bold text-white mb-6 border-b border-gray-800 pb-2">
                    Tax Estimate ({currentYear})
                </h2>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Settings Sidebar */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-gray-900 border border-gray-800 p-6 rounded-2xl shadow-xl h-fit">
                            <h2 className="text-xl font-semibold text-gray-300 mb-6">Tax Settings</h2>

                            <div className="space-y-5">
                                {/* Filing Status */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase mb-2">
                                        Filing Status
                                    </label>
                                    <select
                                        value={state.filingStatus}
                                        onChange={(e) => dispatch({ type: "SET_STATUS", payload: e.target.value as FilingStatus })}
                                        className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg p-2.5 focus:ring-2 focus:ring-green-500 outline-none"
                                    >
                                        <option value="Single">Single</option>
                                        <option value="Married">Married Filing Jointly</option>
                                        <option value="Married Filing Separately">Married Filing Separately</option>
                                    </select>
                                </div>

                                {/* State Selection */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase mb-2">
                                        State Residency
                                    </label>
                                    <select
                                        value={state.stateResidency}
                                        onChange={(e) => dispatch({ type: "SET_STATE", payload: e.target.value })}
                                        className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg p-2.5 focus:ring-2 focus:ring-green-500 outline-none"
                                    >
                                        {Object.keys(TAX_DATABASE.states).sort().map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Deduction Method */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase mb-2">
                                        Deduction Method
                                    </label>
                                    <div className="flex bg-gray-800 p-1 rounded-lg border border-gray-700">
                                        <button
                                            onClick={() => dispatch({ type: "SET_DEDUCTION_METHOD", payload: "Standard" })}
                                            className={`flex-1 py-2 text-sm rounded-md transition-all ${state.deductionMethod === "Standard" ? "bg-green-600 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                                        >
                                            Standard
                                        </button>
                                        <button
                                            onClick={() => dispatch({ type: "SET_DEDUCTION_METHOD", payload: "Itemized" })}
                                            className={`flex-1 py-2 text-sm rounded-md transition-all ${state.deductionMethod === "Itemized" ? "bg-green-600 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                                        >
                                            Itemized
                                        </button>
                                    </div>
                                    {federalItemizedTotal > fedStandardDeduction && state.deductionMethod === "Standard" && (
                                        <p className="text-[11px] text-yellow-500 mt-2 italic leading-tight">
                                            Tip: Your itemized deductions (${federalItemizedTotal.toLocaleString()}) are higher than the standard deduction.
                                        </p>
                                    )}
                                </div>

                                {/* Manual Overrides Section */}
                                <div className="pt-6 border-t border-gray-800 space-y-4">
                                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Manual Overrides</h3>
                                    
                                    <div className="space-y-4">
                                        <div>
                                            <CurrencyInput 
                                                label="Federal Tax"
                                                value={state.fedOverride ?? 0}
                                                onChange={(val) => dispatch({ type: 'SET_FED_OVERRIDE', payload: val === 0 ? null : val })}
                                            />
                                        </div>

                                        <div>
                                            <CurrencyInput 
                                                label="FICA Tax"
                                                value={state.ficaOverride ?? 0}
                                                onChange={(val) => dispatch({ type: 'SET_FICA_OVERRIDE', payload: val === 0 ? null : val })}
                                            />
                                        </div>

                                        <div>
                                            <CurrencyInput
                                                label={state.stateResidency+" Tax"} 
                                                value={state.stateOverride ?? 0}
                                                onChange={(val) => dispatch({ type: 'SET_STATE_OVERRIDE', payload: val === 0 ? null : val })}
                                            />
                                        </div>

                                        {(state.fedOverride !== null || state.ficaOverride !== null || state.stateOverride !== null) && (
                                            <button 
                                                onClick={() => {
                                                    dispatch({ type: 'SET_FED_OVERRIDE', payload: null });
                                                    dispatch({ type: 'SET_FICA_OVERRIDE', payload: null });
                                                    dispatch({ type: 'SET_STATE_OVERRIDE', payload: null });
                                                }}
                                                className="w-full text-[10px] font-bold text-red-500 hover:text-red-400 transition-colors uppercase py-1 border border-red-900/50 rounded-md hover:bg-red-900/10"
                                            >
                                                Clear Overrides
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Main Results Section */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-gray-900 border border-gray-800 p-8 rounded-2xl shadow-2xl">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
                                <div>
                                    <p className="text-gray-400 text-sm mb-1 font-medium">Estimated Net Pay (Annual)</p>
                                    <h2 className="text-6xl font-black text-green-400 tracking-tight">
                                        ${netPaycheck.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </h2>
                                </div>
                                <div className="text-left sm:text-right border-l sm:border-l-0 sm:border-r border-gray-800 pl-4 sm:pl-0 sm:pr-4">
                                    <p className="text-gray-500 text-xs font-bold uppercase mb-1">Effective Rate</p>
                                    <p className="text-2xl font-bold text-white">
                                         {annualGross > 0 ? (((federalTax + stateTax + ficaTax) / annualGross) * 100).toFixed(1) : 0}%
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-4 border-t border-gray-800 pt-6">
                                <div className="flex justify-between text-gray-300 items-center">
                                    <span className="text-lg">Gross Annual Income</span>
                                    <span className="font-mono text-xl">${annualGross.toLocaleString()}</span>
                                </div>
                                
                                <div className="flex justify-end text-gray-300 text-xs italic items-right ">
                                    <span className="font-mono -mt-5">Earned Income (${getEarnedIncome(incomes).toLocaleString()})</span>
                                </div>

                                {incomePreTaxDeductions > 0 && (
                                    <div className="flex justify-between text-blue-400 text-sm italic items-center">
                                        <span>Pre-Tax Deductions (401k)</span>
                                        <span className="font-mono">-${totalPreTaxDeductions.toLocaleString()}</span>
                                    </div>
                                )}
                                {(state.deductionMethod === "Itemized" && federalItemizedTotal > 0) && (
                                    <div className="flex justify-between text-blue-400 text-sm italic items-center">
                                        <span>Itemized Deductions (Federal/State)</span>
                                        <div>
                                            <span className="font-mono">-${federalItemizedTotal.toLocaleString()}/</span>
                                            <span className="font-mono">-${stateItemized.toLocaleString()}</span>
                                        </div>
                                    </div>
                                )}
                                {(state.deductionMethod === "Standard") && (
                                    <div className="flex justify-between text-blue-400 text-sm italic items-center">
                                        <span>Standard Deduction (Federal/State)</span>
                                        <div>
                                            <span className="font-mono">-${fedStandardDeduction.toLocaleString()}/</span>
                                            <span className="font-mono">-${stateStandardDeduction.toLocaleString()}</span>
                                        </div>
                                    </div>
                                )}
                                
                                <div className="flex justify-between text-gray-500 text-sm font-semibold items-center border-t border-gray-800/50 pt-2 mt-2">
                                    <span>Adjusted Gross Income (AGI)</span>
                                    <span className="font-mono">${(Math.max(0, annualGross - totalPreTaxDeductions)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                </div>

                                {/* ... Tax Breakdown ... */}
                                <div className="pt-2 border-b border-gray-800" />

                                <div className="flex justify-between text-red-400 items-center">
                                    <span className="text-lg">Federal Income Tax {state.fedOverride !== null && "(Manual)"}</span>
                                    <span className="font-mono text-lg">-${federalTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                </div>

                                <div className="flex justify-between text-red-400 items-center">
                                    <span className="text-lg">FICA (SS & Medicare) {state.ficaOverride !== null && "(Manual)"}</span>
                                    <span className="font-mono text-lg">-${ficaTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                </div>

                                <div className="flex justify-between text-red-400 items-center">
                                    <span className="text-lg">{state.stateResidency} State Tax {state.stateOverride !== null && "(Manual)"}</span>
                                    <span className="font-mono text-lg">
                                        {stateParams || state.stateOverride !== null
                                            ? `-$${stateTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                                            : "$0"}
                                    </span>
                                </div>

                                {/* NEW: Roth Deduction Display */}
                                {incomePostTaxDeductions > 0 && (
                                    <div className="flex justify-between text-green-500 text-sm italic items-center pt-2">
                                        <span>Post-Tax Deductions (Roth)</span>
                                        <span className="font-mono">-${incomePostTaxDeductions.toLocaleString()}</span>
                                    </div>
                                )}

                                <div className="flex justify-between border-t border-gray-700 pt-6 mt-6 items-center">
                                    <span className="text-3xl font-bold text-white">Net Take Home</span>
                                    <span className="text-3xl font-black text-green-400 font-mono">
                                        ${netPaycheck.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Footer Notes */}
                        <div className="bg-blue-900/10 border border-blue-800/30 p-5 rounded-2xl text-sm leading-relaxed">
                            <p className="text-blue-200">
                                <strong className="text-blue-100 uppercase text-[11px] tracking-widest mr-2">Tax Logic:</strong>
                                Total reduction in taxable income is <span className="text-white font-mono font-bold">${(totalPreTaxDeductions + fedAppliedMainDeduction).toLocaleString()}</span>. 
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}