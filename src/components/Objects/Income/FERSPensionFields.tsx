import React from "react";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput";
import { type WorkIncome } from './models';
import { getFERSMRA, checkFERSEligibility, getDisplayedFERSBenefit } from "../../../data/PensionData";
import { type IncomeFormState, type UpdateForm } from './incomeFormTypes';

interface FERSPensionFieldsProps {
    form: IncomeFormState;
    updateForm: UpdateForm;
    workIncomes: WorkIncome[];
    pensionBirthYear: number;
}

export const FERSPensionFields: React.FC<FERSPensionFieldsProps> = ({
    form,
    updateForm,
    workIncomes,
    pensionBirthYear
}) => (
    <>
        <NumberInput
            label="Years of Service"
            value={form.pensionYearsOfService}
            onChange={(val) => updateForm('pensionYearsOfService', val)}
            tooltip="Total years of creditable federal service under FERS"
        />
        {/* High-3 Salary - either auto-calculate from work income or manual entry */}
        {workIncomes.length > 0 ? (
            <div className="col-span-2 flex flex-col gap-3">
                <ToggleInput
                    label="Auto High-3"
                    enabled={form.autoCalculateHigh3}
                    setEnabled={(val) => updateForm('autoCalculateHigh3', val)}
                    tooltip="Calculate High-3 from projected salaries at retirement"
                />
                {form.autoCalculateHigh3 ? (
                    <DropdownInput
                        label="Link to Income"
                        value={form.linkedIncomeId}
                        onChange={(val) => updateForm('linkedIncomeId', val)}
                        options={workIncomes.map(inc => ({ value: inc.id, label: inc.name }))}
                        tooltip="High-3 will be calculated from your top 3 salary years at retirement"
                    />
                ) : (
                    <CurrencyInput
                        label="High-3 Salary"
                        value={form.pensionHigh3Salary}
                        onChange={(val) => updateForm('pensionHigh3Salary', val)}
                        tooltip="Average of your highest 3 consecutive years of basic pay"
                    />
                )}
            </div>
        ) : (
            <CurrencyInput
                label="High-3 Salary"
                value={form.pensionHigh3Salary}
                onChange={(val) => updateForm('pensionHigh3Salary', val)}
                tooltip="Average of your highest 3 consecutive years of basic pay"
            />
        )}
        <NumberInput
            label="Retirement Age"
            value={form.pensionRetirementAge}
            onChange={(val) => updateForm('pensionRetirementAge', val)}
            tooltip={`MRA is ${getFERSMRA(pensionBirthYear)} for your birth year. Age 62 with 5+ years or MRA with 30+ years for full benefits.`}
        />
        <div className="col-span-3 bg-positive-tint/20 border border-positive-strong/50 rounded-lg p-4 text-sm">
            <div className="font-semibold text-positive-bright mb-2">FERS Pension Estimate</div>
            <div className="text-content-default space-y-1">
                <div className="flex justify-between">
                    <span>Estimated Annual Benefit:</span>
                    <span className="font-bold text-positive-bright">
                        {form.autoCalculateHigh3
                            ? "Auto Calculated"
                            : `$${getDisplayedFERSBenefit(form.pensionYearsOfService, form.pensionHigh3Salary, form.pensionRetirementAge, pensionBirthYear).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr`
                        }
                    </span>
                </div>
                <div className="flex justify-between">
                    <span>High-3:</span>
                    <span className="text-positive-bright">
                        {form.autoCalculateHigh3
                            ? "Auto Calculated"
                            : `$${form.pensionHigh3Salary.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr`
                        }
                    </span>
                </div>
                <div className="flex justify-between">
                    <span>Benefits Start:</span>
                    <span className="text-positive-bright">
                        {pensionBirthYear + form.pensionRetirementAge}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span>Eligibility:</span>
                    <span className={checkFERSEligibility(form.pensionRetirementAge, form.pensionYearsOfService, pensionBirthYear).eligible ? "text-positive-bright" : "text-warning-bright"}>
                        {checkFERSEligibility(form.pensionRetirementAge, form.pensionYearsOfService, pensionBirthYear).message}
                    </span>
                </div>
            </div>
            <div className="text-xs text-content-muted mt-2">
                Formula: {form.pensionRetirementAge >= 62 && form.pensionYearsOfService >= 20 ? "1.1%" : "1%"} x Years x High-3.
                {form.autoCalculateHigh3 && " High-3 will be calculated from your top 3 salary years at retirement."}
                {!form.autoCalculateHigh3 && " COLA: full CPI if inflation ≤ 2%, capped at 2% if 2–3%, CPI−1% if > 3%. No COLA before age 62."}
            </div>
        </div>
    </>
);
