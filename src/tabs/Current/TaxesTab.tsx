import { useContext, useMemo, useCallback, useState } from "react";
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
import { NumberInput } from "../../components/Layout/InputFields/NumberInput";
import { ToggleInput } from "../../components/Layout/InputFields/ToggleInput";
import { TaxLifeEventsEditor } from "../../components/Objects/Taxes/TaxLifeEventsEditor";
import { TaxLifeEvent } from "../../components/Objects/Taxes/TaxContext";
import { DeductionMethod } from "../../components/Objects/Taxes/TaxContext";
import { Panel } from "../../components/Layout/Primitives";
import { Tooltip } from "../../components/Layout/InputFields/Tooltip";

// Suggestion: Create a 'useTax' hook in TaxContext.tsx that handles the null check
// and throws an error if the provider is missing.

export default function TaxesTab() {
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state, dispatch } = useContext(TaxContext);
    const { state: assumptions, dispatch: assumptionsDispatch } = useContext(AssumptionsContext);

    // Future tax-law modeling (assumptions.macro.taxBracketShiftPct). The
    // current-year estimate always uses current law; this only affects the
    // projection. Mode is local UI state so typing the % to 0 doesn't collapse
    // the inputs out from under the user.
    const engineStartYear = assumptions.demographics.priorYearMode ? new Date().getFullYear() - 1 : new Date().getFullYear();
    const shiftPct = assumptions.macro.taxBracketShiftPct ?? 0;
    const shiftStartYear = assumptions.macro.taxBracketShiftStartYear ?? 0;
    const nextYear = new Date().getFullYear() + 1;
    const [taxLawMode, setTaxLawMode] = useState<'current' | 'adjust'>(shiftPct !== 0 ? 'adjust' : 'current');

    const onTaxLawModeChange = useCallback((mode: string) => {
        if (mode === 'adjust') {
            setTaxLawMode('adjust');
            if ((assumptions.macro.taxBracketShiftPct ?? 0) === 0) {
                assumptionsDispatch({ type: 'UPDATE_MACRO', payload: { taxBracketShiftPct: 5, taxBracketShiftStartYear: assumptions.macro.taxBracketShiftStartYear || nextYear } });
            }
        } else {
            setTaxLawMode('current');
            assumptionsDispatch({ type: 'UPDATE_MACRO', payload: { taxBracketShiftPct: 0 } });
        }
    }, [assumptions.macro.taxBracketShiftPct, assumptions.macro.taxBracketShiftStartYear, assumptionsDispatch, nextYear]);

    const onShiftPctChange = useCallback((val: number) => {
        assumptionsDispatch({ type: 'UPDATE_MACRO', payload: { taxBracketShiftPct: val } });
    }, [assumptionsDispatch]);

    const onShiftStartYearChange = useCallback((val: number) => {
        assumptionsDispatch({ type: 'UPDATE_MACRO', payload: { taxBracketShiftStartYear: val } });
    }, [assumptionsDispatch]);

    const {
        filingStatus,
        stateResidency,
        deductionMethod,
        fedOverride,
        ficaOverride,
        stateOverride,
        calibrateFutureYears,
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

    // The engine's computed (un-overridden) tax, used to show the % by which an
    // override differs — the amount calibration carries into future years.
    // Uses engineStartYear (the simulation's actual start year) so the displayed
    // percentage matches the factor the engine applies to the projection.
    const computedFedNoOverride = useMemo(
        () => calculateFederalTaxFromIncomes({ ...state, fedOverride: null }, incomes, expenses, 0, engineStartYear, assumptions),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [filingStatus, deductionMethod, stateResidency, incomes, expenses, engineStartYear, assumptions]
    );
    const computedStateNoOverride = useMemo(
        () => calculateStateTax({ ...state, stateOverride: null }, incomes, expenses, engineStartYear, assumptions),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [filingStatus, stateResidency, deductionMethod, incomes, expenses, engineStartYear, assumptions]
    );
    const pctLabel = (override: number | null, computed: number): string | null => {
        if (override === null || computed <= 1) return null;
        const pct = (override / computed - 1) * 100;
        return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    };
    const fedCalLabel = pctLabel(fedOverride, computedFedNoOverride);
    const stateCalLabel = pctLabel(stateOverride, computedStateNoOverride);
    const annualGross = useMemo(() => getGrossIncome(incomes, taxYear), [incomes, taxYear]);

    const stateItemized = useMemo(
        () => getItemizedDeductions(expenses, taxYear),
        [expenses, taxYear]
    );
    const federalItemizedTotal = stateItemized + stateTax;
    const stateParams = TAX_DATABASE.states[stateResidency]?.[taxYear]?.[filingStatus];
    const stateStandardDeduction = stateParams?.standardDeduction ?? 0;
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
    const agi = Math.max(0, annualGross - totalPreTaxDeductions);
    const deductionLabel = effectiveDeductionMethod === "Standard" ? "standard" : "itemized";

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
        dispatch({ type: 'SET_CALIBRATE_FUTURE', payload: false });
    }, [dispatch]);
    const onCalibrateChange = useCallback(
        (enabled: boolean) => dispatch({ type: 'SET_CALIBRATE_FUTURE', payload: enabled }),
        [dispatch]
    );
    const onTaxEventsChange = useCallback(
        (events: TaxLifeEvent[]) => dispatch({ type: 'SET_TAX_EVENTS', payload: events }),
        [dispatch]
    );

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

                                {/* Future Tax Law */}
                                <div className="pt-6 border-t border-border-subtle space-y-3">
                                    <h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider">Future Tax Law</h3>
                                    <DropdownInput
                                        label="Projection uses"
                                        onChange={onTaxLawModeChange}
                                        options={[
                                            { value: 'current', label: 'Current tax law' },
                                            { value: 'adjust', label: 'Adjust tax brackets' },
                                        ]}
                                        value={taxLawMode}
                                        tooltip="How the projection models federal income tax in future years. The current-year estimate above always uses current law."
                                    />
                                    {taxLawMode === 'adjust' && (
                                        <>
                                            <NumberInput
                                                label="Rate change (percentage points)"
                                                value={shiftPct}
                                                onChange={onShiftPctChange}
                                                min={-50}
                                                max={50}
                                                tooltip="Added to every federal marginal rate from the start year on — e.g. +5 turns the 22% bracket into 27%. Use a negative value to model lower future rates."
                                            />
                                            <NumberInput
                                                label="Starting year"
                                                value={shiftStartYear > 0 ? shiftStartYear : nextYear}
                                                onChange={onShiftStartYearChange}
                                                min={new Date().getFullYear() + 1}
                                                max={new Date().getFullYear() + 60}
                                                tooltip="The first year the adjustment applies. Defaults to next year (this year always stays current-law)."
                                            />
                                        </>
                                    )}
                                </div>

                                {/* Tax Life Events */}
                                <div className="pt-6 border-t border-border-subtle space-y-3">
                                    <h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider">Tax Life Events</h3>
                                    <p className="text-xs text-content-subtle">
                                        Schedule changes the projection should model — moving states or a
                                        change in filing status, by a year or a milestone.
                                    </p>
                                    <TaxLifeEventsEditor
                                        events={state.taxEvents ?? []}
                                        onChange={onTaxEventsChange}
                                        milestones={assumptions.milestones || []}
                                        stateOptions={stateOptions}
                                        filingOptions={filingStatusOptions}
                                    />
                                </div>

                                {/* Manual Overrides Section */}
                                <div className="pt-6 border-t border-border-subtle space-y-4">
                                    <h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider">Manual Overrides</h3>
                                    <p className="text-xs text-content-subtle">
                                        Applies to this year's estimate only — overrides are no longer
                                        carried flat into your projection.
                                    </p>

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

                                        {(fedOverride !== null || stateOverride !== null) && (
                                            <div className="pt-1 space-y-2">
                                                <ToggleInput
                                                    label="Carry correction into future years"
                                                    enabled={!!calibrateFutureYears}
                                                    setEnabled={onCalibrateChange}
                                                    tooltip="Apply the % your override differs from the calculated tax to every future projected year (federal & state — not FICA). Assumes the gap is a persistent feature of your situation, not a one-off like a home sale this year."
                                                />
                                                {calibrateFutureYears && (fedCalLabel || stateCalLabel) && (
                                                    <p className="text-[11px] text-info italic leading-tight">
                                                        Future tax scaled by your correction
                                                        {fedCalLabel ? ` — federal ${fedCalLabel}` : ''}
                                                        {stateCalLabel ? `, state ${stateCalLabel}` : ''}.
                                                    </p>
                                                )}
                                            </div>
                                        )}

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
                                    <p className="text-content-muted text-xs font-bold uppercase mb-1 flex items-center gap-1 sm:justify-end">
                                        Effective Rate
                                        <Tooltip text="(Federal + FICA + State) ÷ Gross Income — the share of your total pay that goes to taxes." />
                                    </p>
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
                                    <span className="text-lg flex items-center gap-1">
                                        Federal Income Tax {fedOverride !== null && "(Manual)"}
                                        <Tooltip text={fedOverride !== null
                                            ? `Manual override. Federal tax is normally computed on AGI of $${agi.toLocaleString()} after the $${fedAppliedMainDeduction.toLocaleString()} ${deductionLabel} deduction.`
                                            : `Federal income tax on AGI of $${agi.toLocaleString()} after the $${fedAppliedMainDeduction.toLocaleString()} ${deductionLabel} deduction.`} />
                                    </span>
                                    <span className="font-mono text-lg">-${federalTax.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                </div>

                                <div className="flex justify-between text-negative items-center">
                                    <span className="text-lg flex items-center gap-1">
                                        FICA (SS & Medicare) {ficaOverride !== null && "(Manual)"}
                                        <Tooltip text={`Social Security (6.2%) + Medicare (1.45%) on earned income of $${earnedIncome.toLocaleString()}. FICA applies to wages before deductions, not to AGI.`} />
                                    </span>
                                    <span className="font-mono text-lg">-${ficaTax.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                </div>

                                <div className="flex justify-between text-negative items-center">
                                    <span className="text-lg flex items-center gap-1">
                                        {stateResidency} State Tax {stateOverride !== null && "(Manual)"}
                                        <Tooltip text={stateOverride !== null
                                            ? `Manual override for ${stateResidency} state tax.`
                                            : stateParams
                                                ? `${stateResidency} state income tax on AGI of $${agi.toLocaleString()} after the $${stateStandardDeduction.toLocaleString()} state ${deductionLabel} deduction.`
                                                : `No ${stateResidency} tax table for ${taxYear} / ${filingStatus}, so state tax is treated as $0.`} />
                                    </span>
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

                                {postTaxEmployerMatch > 0 && (
                                    <div className="flex justify-between text-positive-soft text-sm italic items-center">
                                        <span className="flex items-center gap-1">
                                            Employer Match (post-tax)
                                            <Tooltip text="A post-tax employer-match contribution (e.g. a Roth match) routed straight to your account. It's subtracted from take-home pay because it never reaches your paycheck." />
                                        </span>
                                        <span className="font-mono">-${postTaxEmployerMatch.toLocaleString()}</span>
                                    </div>
                                )}

                                <div className="flex justify-between border-t border-border-default pt-6 mt-6 items-center">
                                    <span className="text-3xl font-bold text-white flex items-center gap-2">
                                        Net Take Home
                                        <Tooltip text={`Gross $${annualGross.toLocaleString()} − pre-tax deductions $${incomePreTaxDeductions.toLocaleString()} − total taxes $${(federalTax + ficaTax + stateTax).toLocaleString(undefined, { maximumFractionDigits: 0 })}${incomePostTaxDeductions > 0 ? ` − Roth $${incomePostTaxDeductions.toLocaleString()}` : ''}${postTaxEmployerMatch > 0 ? ` − employer match $${postTaxEmployerMatch.toLocaleString()}` : ''} = the cash that lands in your pocket.`} />
                                    </span>
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