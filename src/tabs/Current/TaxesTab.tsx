import { useContext, useMemo, useCallback } from "react";
import { IncomeContext } from "../../components/Objects/Income/IncomeContext";
import { ExpenseContext } from "../../components/Objects/Expense/ExpenseContext";
import { TaxContext } from "../../components/Objects/Taxes/TaxContext";
import { AssumptionsContext, getBirthYear } from "../../components/Objects/Assumptions/AssumptionsContext";
import { TAX_DATABASE, FilingStatus } from "../../data/TaxData";
import {
    calculateFicaTax,
    getGrossIncome,
    getPreTaxExemptions,
    getEarnedIncome,
    getPostTaxExemptions,
    getItemizedDeductions,
    getYesDeductions,
    calculateFederalTaxFromIncomes,
    calculateStateTax,
    getPostTaxEmployerMatch
} from "../../components/Objects/Taxes/TaxService";
import { CurrencyInput } from "../../components/Layout/InputFields/CurrencyInput";
import { DropdownInput } from "../../components/Layout/InputFields/DropdownInput";
import { DeductionMethod } from "../../components/Objects/Taxes/TaxContext";
import { Panel } from "../../components/Layout/Primitives";

// Suggestion: Create a 'useTax' hook in TaxContext.tsx that handles the null check
// and throws an error if the provider is missing.

export default function TaxesTab() {
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state, dispatch } = useContext(TaxContext);
    const { state: assumptions } = useContext(AssumptionsContext);

    const {
        filingStatus,
        stateResidency,
        deductionMethod,
        fedOverride,
        ficaOverride,
        stateOverride,
        year: taxYear,
    } = state;

    const stateTax = useMemo(
        () => calculateStateTax(state, incomes, expenses, taxYear, assumptions),
        // calculateStateTax reads state.{filingStatus, stateResidency, deductionMethod, stateOverride}
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [filingStatus, stateResidency, deductionMethod, stateOverride, incomes, expenses, taxYear, assumptions]
    );
    const federalTax = useMemo(
        () => calculateFederalTaxFromIncomes(state, incomes, expenses, 0, taxYear, assumptions),
        // reads state.{filingStatus, fedOverride, deductionMethod}
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [filingStatus, fedOverride, deductionMethod, incomes, expenses, taxYear, assumptions]
    );
    const ficaTax = useMemo(
        () => calculateFicaTax(state, incomes, taxYear, assumptions),
        // reads state.{filingStatus, ficaOverride}
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [filingStatus, ficaOverride, incomes, taxYear, assumptions]
    );
    const annualGross = useMemo(() => getGrossIncome(incomes, taxYear), [incomes, taxYear]);

    const stateItemized = useMemo(
        () => getItemizedDeductions(expenses, taxYear),
        [expenses, taxYear]
    );
    const federalItemizedTotal = stateItemized + stateTax;
    const stateParams = TAX_DATABASE.states[stateResidency]?.[taxYear]?.[filingStatus];
    const stateStandardDeduction = stateParams.standardDeduction;
    const fedParams = TAX_DATABASE.federal[taxYear][filingStatus];
    const fedStandardDeduction = fedParams.standardDeduction;

    const effectiveDeductionMethod: 'Standard' | 'Itemized' =
        deductionMethod === "Auto"
            ? (federalItemizedTotal > fedStandardDeduction ? "Itemized" : "Standard")
            : deductionMethod;

    const fedAppliedMainDeduction =
        effectiveDeductionMethod === "Standard" ? fedStandardDeduction : federalItemizedTotal;

    const age = taxYear - getBirthYear(assumptions.milestones);
    const incomePreTaxDeductions = useMemo(
        () => getPreTaxExemptions(incomes, taxYear, age),
        [incomes, taxYear, age]
    );
    const incomePostTaxDeductions = useMemo(
        () => getPostTaxExemptions(incomes, taxYear, age),
        [incomes, taxYear, age]
    );
    const expenseAboveLineDeductions = useMemo(
        () => getYesDeductions(expenses, taxYear),
        [expenses, taxYear]
    );
    const postTaxEmployerMatch = useMemo(
        () => getPostTaxEmployerMatch(incomes, taxYear),
        [incomes, taxYear]
    );
    const earnedIncome = useMemo(() => getEarnedIncome(incomes, taxYear), [incomes, taxYear]);
    const totalPreTaxDeductions = incomePreTaxDeductions + expenseAboveLineDeductions;
    const netPaycheck = annualGross - incomePreTaxDeductions - (federalTax + stateTax + ficaTax) - incomePostTaxDeductions - postTaxEmployerMatch;

    const onYearChange = useCallback(
        (val: string) => dispatch({ type: "SET_YEAR", payload: Number(val) }),
        [dispatch]
    );
    const onStatusChange = useCallback(
        (val: string) => dispatch({ type: "SET_STATUS", payload: val as FilingStatus }),
        [dispatch]
    );
    const onStateChange = useCallback(
        (val: string) => dispatch({ type: "SET_STATE", payload: val }),
        [dispatch]
    );
    const onDeductionMethodChange = useCallback(
        (val: string) => dispatch({ type: "SET_DEDUCTION_METHOD", payload: val as DeductionMethod }),
        [dispatch]
    );
    const onFedOverrideChange = useCallback(
        (val: number) => dispatch({ type: 'SET_FED_OVERRIDE', payload: val === 0 ? null : val }),
        [dispatch]
    );
    const onFicaOverrideChange = useCallback(
        (val: number) => dispatch({ type: 'SET_FICA_OVERRIDE', payload: val === 0 ? null : val }),
        [dispatch]
    );
    const onStateOverrideChange = useCallback(
        (val: number) => dispatch({ type: 'SET_STATE_OVERRIDE', payload: val === 0 ? null : val }),
        [dispatch]
    );
    const onClearOverrides = useCallback(() => {
        dispatch({ type: 'SET_FED_OVERRIDE', payload: null });
        dispatch({ type: 'SET_FICA_OVERRIDE', payload: null });
        dispatch({ type: 'SET_STATE_OVERRIDE', payload: null });
    }, [dispatch]);

    const yearOptions = useMemo(
        () => Object.keys(TAX_DATABASE.federal).map(y => ({ value: y, label: y })).reverse(),
        []
    );
    const filingStatusOptions = useMemo(
        () => [
            { value: 'Single', label: 'Single' },
            { value: 'Married Filing Jointly', label: 'Married Filing Jointly' },
            { value: 'Married Filing Separately', label: 'Married Filing Separately' },
        ],
        []
    );
    const stateOptions = useMemo(
        () => Object.keys(TAX_DATABASE.states).map(s => ({ value: s, label: s })),
        []
    );
    const deductionOptions = useMemo(
        () => [
            { value: 'Auto', label: 'Auto (Recommended)' },
            { value: 'Standard', label: 'Standard' },
            { value: 'Itemized', label: 'Itemized' },
        ],
        []
    );

    return (
        <div className="w-full min-h-full flex bg-surface-base justify-center pt-6 pb-24">
            <div className="w-full px-4 sm:px-8 max-w-screen-2xl">
                <h2 className="text-2xl font-bold text-white mb-6 border-b border-border-subtle pb-2">
                    Tax Estimate
                </h2>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Settings Sidebar */}
                    <div className="lg:col-span-1 space-y-6">
                        <Panel padding="lg" className="shadow-xl h-fit">
                            <h2 className="text-xl font-semibold text-content-default mb-6">Tax Settings</h2>

                            <div className="space-y-5">
                                {/* Year Selection */}
                                <div>
                                    <DropdownInput
                                        label="Year"
                                        onChange={onYearChange}
                                        options={yearOptions}
                                        value={taxYear.toString()}
                                    />
                                </div>
                                
                                {/* Filing Status */}
                                <div>
                                    <DropdownInput
                                        label="Filing Status"
                                        onChange={onStatusChange}
                                        options={filingStatusOptions}
                                        value={filingStatus}
                                    />
                                </div>

                                {/* State Selection */}
                                <div>
                                    <DropdownInput
                                        label="State Residency"
                                        onChange={onStateChange}
                                        options={stateOptions}
                                        value={stateResidency}
                                    />
                                </div>

                                {/* Deduction Method */}
                                <div>
                                    <DropdownInput
                                        label="Deduction Method"
                                        onChange={onDeductionMethodChange}
                                        options={deductionOptions}
                                        value={deductionMethod}
                                    />
                                    {deductionMethod === "Auto" && (
                                        <p className="text-[11px] text-info mt-2 italic leading-tight">
                                            Using {effectiveDeductionMethod.toLowerCase()} deduction (${effectiveDeductionMethod === "Standard" ? fedStandardDeduction.toLocaleString() : federalItemizedTotal.toLocaleString()}) for lowest tax.
                                        </p>
                                    )}
                                    {federalItemizedTotal > fedStandardDeduction && deductionMethod === "Standard" && (
                                        <p className="text-[11px] text-warning-soft mt-2 italic leading-tight">
                                            Tip: Your itemized deductions (${federalItemizedTotal.toLocaleString()}) are higher than the standard deduction.
                                        </p>
                                    )}
                                </div>

                                {/* Manual Overrides Section */}
                                <div className="pt-6 border-t border-border-subtle space-y-4">
                                    <h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider">Manual Overrides</h3>
                                    
                                    <div className="space-y-4">
                                        <div>
                                            <CurrencyInput
                                                label="Federal Tax"
                                                value={fedOverride ?? 0}
                                                onChange={onFedOverrideChange}
                                            />
                                        </div>

                                        <div>
                                            <CurrencyInput
                                                label="FICA Tax"
                                                value={ficaOverride ?? 0}
                                                onChange={onFicaOverrideChange}
                                            />
                                        </div>

                                        <div>
                                            <CurrencyInput
                                                label={stateResidency+" Tax"}
                                                value={stateOverride ?? 0}
                                                onChange={onStateOverrideChange}
                                            />
                                        </div>

                                        {(fedOverride !== null || ficaOverride !== null || stateOverride !== null) && (
                                            <button
                                                onClick={onClearOverrides}
                                                className="w-full text-[10px] font-bold text-negative-soft hover:text-negative transition-colors uppercase py-1 border border-negative-tint/50 rounded-md hover:bg-negative-tint/10"
                                            >
                                                Clear Overrides
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </Panel>
                    </div>

                    {/* Main Results Section */}
                    <div className="lg:col-span-2 space-y-6">
                        <Panel padding="none" className="p-8 shadow-2xl">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
                                <div>
                                    <p className="text-content-muted text-sm mb-1 font-medium">Estimated Net Pay (Annual)</p>
                                    <h2 className="text-6xl font-black text-positive tracking-tight">
                                        ${netPaycheck.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </h2>
                                </div>
                                <div className="text-left sm:text-right border-l sm:border-l-0 sm:border-r border-border-subtle pl-4 sm:pl-0 sm:pr-4">
                                    <p className="text-content-muted text-xs font-bold uppercase mb-1">Effective Rate</p>
                                    <p className="text-2xl font-bold text-white">
                                         {annualGross > 0 ? (((federalTax + stateTax + ficaTax) / annualGross) * 100).toFixed(1) : 0}%
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-4 border-t border-border-subtle pt-6">
                                <div className="flex justify-between text-content-default items-center">
                                    <span className="text-lg">Gross Annual Income</span>
                                    <span className="font-mono text-xl">${annualGross.toLocaleString()}</span>
                                </div>
                                
                                <div className="flex justify-end text-content-default text-xs italic items-right ">
                                    <span className="font-mono -mt-5">Earned Income (${earnedIncome.toLocaleString()})</span>
                                </div>

                                {incomePreTaxDeductions > 0 && (
                                    <div className="flex justify-between text-info text-sm italic items-center">
                                        <span>Pre-Tax Deductions (401k)</span>
                                        <span className="font-mono">-${totalPreTaxDeductions.toLocaleString()}</span>
                                    </div>
                                )}
                                {(effectiveDeductionMethod === "Itemized" && federalItemizedTotal > 0) && (
                                    <div className="flex justify-between text-info text-sm italic items-center">
                                        <span>Itemized Deductions (Federal/State){deductionMethod === "Auto" && " - Auto"}</span>
                                        <div>
                                            <span className="font-mono">-${federalItemizedTotal.toLocaleString()}/</span>
                                            <span className="font-mono">-${stateItemized.toLocaleString()}</span>
                                        </div>
                                    </div>
                                )}
                                {(effectiveDeductionMethod === "Standard") && (
                                    <div className="flex justify-between text-info text-sm italic items-center">
                                        <span>Standard Deduction (Federal/State){deductionMethod === "Auto" && " - Auto"}</span>
                                        <div>
                                            <span className="font-mono">-${fedStandardDeduction.toLocaleString()}/</span>
                                            <span className="font-mono">-${stateStandardDeduction.toLocaleString()}</span>
                                        </div>
                                    </div>
                                )}
                                
                                <div className="flex justify-between text-content-muted text-sm font-semibold items-center border-t border-border-subtle/50 pt-2 mt-2">
                                    <span>Adjusted Gross Income (AGI)</span>
                                    <span className="font-mono">${(Math.max(0, annualGross - totalPreTaxDeductions)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                </div>

                                {/* ... Tax Breakdown ... */}
                                <div className="pt-2 border-b border-border-subtle" />

                                <div className="flex justify-between text-negative items-center">
                                    <span className="text-lg">Federal Income Tax {fedOverride !== null && "(Manual)"}</span>
                                    <span className="font-mono text-lg">-${federalTax.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                </div>

                                <div className="flex justify-between text-negative items-center">
                                    <span className="text-lg">FICA (SS & Medicare) {ficaOverride !== null && "(Manual)"}</span>
                                    <span className="font-mono text-lg">-${ficaTax.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                </div>

                                <div className="flex justify-between text-negative items-center">
                                    <span className="text-lg">{stateResidency} State Tax {stateOverride !== null && "(Manual)"}</span>
                                    <span className="font-mono text-lg">
                                        {stateParams || stateOverride !== null
                                            ? `-$${stateTax.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                                            : "$0"}
                                    </span>
                                </div>

                                <div className="flex justify-between text-negative-bright font-semibold items-center border-t border-negative-tint/40 pt-3 mt-1">
                                    <span className="text-lg">Total Taxes</span>
                                    <span className="font-mono text-lg">-${(federalTax + ficaTax + stateTax).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                </div>

                                {/* NEW: Roth Deduction Display */}
                                {incomePostTaxDeductions > 0 && (
                                    <div className="flex justify-between text-positive-soft text-sm italic items-center pt-2">
                                        <span>Post-Tax Deductions (Roth)</span>
                                        <span className="font-mono">-${incomePostTaxDeductions.toLocaleString()}</span>
                                    </div>
                                )}

                                <div className="flex justify-between border-t border-border-default pt-6 mt-6 items-center">
                                    <span className="text-3xl font-bold text-white">Net Take Home</span>
                                    <span className="text-3xl font-black text-positive font-mono">
                                        ${netPaycheck.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </span>
                                </div>
                            </div>
                        </Panel>

                        {/* Footer Notes */}
                        <div className="bg-info-tint/10 border border-info-strong/30 p-5 rounded-2xl text-sm leading-relaxed">
                            <p className="text-info-bright">
                                <strong className="text-info-bright uppercase text-[11px] tracking-widest mr-2">Tax Logic:</strong>
                                Total reduction in taxable income is <span className="text-white font-mono font-bold">${(totalPreTaxDeductions + fedAppliedMainDeduction).toLocaleString()}</span>. 
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}