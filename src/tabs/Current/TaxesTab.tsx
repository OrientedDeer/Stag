import { useContext } from "react";
import { IncomeContext } from "../../components/Objects/Income/IncomeContext";
import { ExpenseContext } from "../../components/Objects/Expense/ExpenseContext";
import { TaxContext } from "../../components/Objects/Taxes/TaxContext";
import { TAX_DATABASE, FilingStatus } from "../../data/TaxData";
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
} from "../../components/Objects/Taxes/TaxService";
import { CurrencyInput } from "../../components/Layout/InputFields/CurrencyInput";
import { DropdownInput } from "../../components/Layout/InputFields/DropdownInput";
import { DeductionMethod } from "../../components/Objects/Taxes/TaxContext";

// Suggestion: Create a 'useTax' hook in TaxContext.tsx that handles the null check
// and throws an error if the provider is missing.

export default function TaxesTab() {
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state, dispatch } = useContext(TaxContext);

    const taxYear = state.year;
    
    const stateTax = calculateStateTax(state, incomes, expenses, taxYear);
    const federalTax = calculateFederalTax(state, incomes, expenses, taxYear);
    const ficaTax = calculateFicaTax(state, incomes, taxYear);
    const annualGross = getGrossIncome(incomes, taxYear);
    
    const stateItemized = getItemizedDeductions(expenses, taxYear);
    const federalItemizedTotal = stateItemized + stateTax;
    const stateParams = TAX_DATABASE.states[state.stateResidency]?.[taxYear]?.[state.filingStatus];
    const stateStandardDeduction = stateParams.standardDeduction;
    const fedParams = TAX_DATABASE.federal[taxYear][state.filingStatus];
    const fedStandardDeduction = fedParams.standardDeduction;

    // Determine effective deduction method when Auto is selected
    const effectiveDeductionMethod: 'Standard' | 'Itemized' =
        state.deductionMethod === "Auto"
            ? (federalItemizedTotal > fedStandardDeduction ? "Itemized" : "Standard")
            : state.deductionMethod;

    const fedAppliedMainDeduction =
        effectiveDeductionMethod === "Standard" ? fedStandardDeduction : federalItemizedTotal;
    const incomePreTaxDeductions = getPreTaxExemptions(incomes, taxYear);
    const incomePostTaxDeductions = getPostTaxExemptions(incomes, taxYear);
    const expenseAboveLineDeductions = getYesDeductions(expenses, taxYear);
    const postTaxEmployerMatch = getPostTaxEmployerMatch(incomes, taxYear);
    const totalPreTaxDeductions = incomePreTaxDeductions + expenseAboveLineDeductions;
    const netPaycheck = annualGross - incomePreTaxDeductions - (federalTax + stateTax + ficaTax) - incomePostTaxDeductions - postTaxEmployerMatch;

    return (
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6 pb-24">
            <div className="w-full px-4 sm:px-8 max-w-screen-2xl">
                <h2 className="text-2xl font-bold text-white mb-6 border-b border-gray-800 pb-2">
                    Tax Estimate
                </h2>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Settings Sidebar */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-gray-900 border border-gray-800 p-6 rounded-2xl shadow-xl h-fit">
                            <h2 className="text-xl font-semibold text-gray-300 mb-6">Tax Settings</h2>

                            <div className="space-y-5">
                                {/* Year Selection */}
                                <div>
                                    <DropdownInput
                                        label="Year"
                                        onChange={(val) => dispatch({ type: "SET_YEAR", payload: Number(val) })}
                                        options={Object.keys(TAX_DATABASE.federal).map(y => ({ value: y, label: y })).reverse()}
                                        value={state.year.toString()}
                                    />
                                </div>
                                
                                {/* Filing Status */}
                                <div>
                                    <DropdownInput
                                        label="Filing Status"
                                        onChange={(val) => dispatch({ type: "SET_STATUS", payload: val as FilingStatus })}
                                        options={[
                                            { value: 'Single', label: 'Single' },
                                            { value: 'Married Filing Jointly', label: 'Married Filing Jointly' },
                                            { value: 'Married Filing Separately', label: 'Married Filing Separately' }
                                        ]}
                                        value={state.filingStatus}
                                    />
                                </div>

                                {/* State Selection */}
                                <div>
                                    <DropdownInput
                                        label="State Residency"
                                        onChange={(val) => dispatch({ type: "SET_STATE", payload: val })}
                                        options={Object.keys(TAX_DATABASE.states).map(s => ({ value: s, label: s }))}
                                        value={state.stateResidency}
                                    />
                                </div>

                                {/* Deduction Method */}
                                <div>
                                    <DropdownInput
                                        label="Deduction Method"
                                        onChange={(val) => dispatch({ type: "SET_DEDUCTION_METHOD", payload: val as DeductionMethod })}
                                        options={[
                                            { value: 'Auto', label: 'Auto (Recommended)' },
                                            { value: 'Standard', label: 'Standard' },
                                            { value: 'Itemized', label: 'Itemized' }
                                        ]}
                                        value={state.deductionMethod}
                                    />
                                    {state.deductionMethod === "Auto" && (
                                        <p className="text-[11px] text-blue-400 mt-2 italic leading-tight">
                                            Using {effectiveDeductionMethod.toLowerCase()} deduction (${effectiveDeductionMethod === "Standard" ? fedStandardDeduction.toLocaleString() : federalItemizedTotal.toLocaleString()}) for lowest tax.
                                        </p>
                                    )}
                                    {federalItemizedTotal > fedStandardDeduction && state.deductionMethod === "Standard" && (
                                        <p className="text-[11px] text-yellow-500 mt-2 italic leading-tight">
                                            Tip: Your itemized deductions (${federalItemizedTotal.toLocaleString()}) are higher than the standard deduction.
                                        </p>
                                    )}
                                </div>

                                {/* Manual Overrides Section */}
                                <div className="pt-6 border-t border-gray-800 space-y-4">
                                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Manual Overrides</h3>
                                    
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
                                    <p className="text-gray-400 text-xs font-bold uppercase mb-1">Effective Rate</p>
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
                                    <span className="font-mono -mt-5">Earned Income (${getEarnedIncome(incomes, taxYear).toLocaleString()})</span>
                                </div>

                                {incomePreTaxDeductions > 0 && (
                                    <div className="flex justify-between text-blue-400 text-sm italic items-center">
                                        <span>Pre-Tax Deductions (401k)</span>
                                        <span className="font-mono">-${totalPreTaxDeductions.toLocaleString()}</span>
                                    </div>
                                )}
                                {(effectiveDeductionMethod === "Itemized" && federalItemizedTotal > 0) && (
                                    <div className="flex justify-between text-blue-400 text-sm italic items-center">
                                        <span>Itemized Deductions (Federal/State){state.deductionMethod === "Auto" && " - Auto"}</span>
                                        <div>
                                            <span className="font-mono">-${federalItemizedTotal.toLocaleString()}/</span>
                                            <span className="font-mono">-${stateItemized.toLocaleString()}</span>
                                        </div>
                                    </div>
                                )}
                                {(effectiveDeductionMethod === "Standard") && (
                                    <div className="flex justify-between text-blue-400 text-sm italic items-center">
                                        <span>Standard Deduction (Federal/State){state.deductionMethod === "Auto" && " - Auto"}</span>
                                        <div>
                                            <span className="font-mono">-${fedStandardDeduction.toLocaleString()}/</span>
                                            <span className="font-mono">-${stateStandardDeduction.toLocaleString()}</span>
                                        </div>
                                    </div>
                                )}
                                
                                <div className="flex justify-between text-gray-400 text-sm font-semibold items-center border-t border-gray-800/50 pt-2 mt-2">
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