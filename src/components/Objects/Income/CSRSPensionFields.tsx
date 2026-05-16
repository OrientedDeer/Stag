import React from "react";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput";
import { WorkIncome } from './models';
import { checkCSRSEligibility, calculateCSRSBasicBenefit } from "../../../data/PensionData";
import { IncomeFormState, UpdateForm } from './incomeFormTypes';

interface CSRSPensionFieldsProps {
    form: IncomeFormState;
    updateForm: UpdateForm;
    workIncomes: WorkIncome[];
    pensionBirthYear: number;
}

export const CSRSPensionFields: React.FC<CSRSPensionFieldsProps> = ({
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
            tooltip="Total years of creditable federal service under CSRS"
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
            tooltip="Age 55 with 30+ years, age 60 with 20+ years, or age 62 with 5+ years for full benefits"
        />
        <div className="col-span-3 bg-green-900/20 border border-green-700/50 rounded-lg p-4 text-sm">
            <div className="font-semibold text-green-200 mb-2">CSRS Pension Estimate</div>
            <div className="text-gray-300 space-y-1">
                <div className="flex justify-between">
                    <span>Estimated Annual Benefit:</span>
                    <span className="font-bold text-green-300">
                        {form.autoCalculateHigh3
                            ? "Auto Calculated"
                            : `$${calculateCSRSBasicBenefit(form.pensionYearsOfService, form.pensionHigh3Salary).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr`
                        }
                    </span>
                </div>
                <div className="flex justify-between">
                    <span>High-3:</span>
                    <span className="text-green-200">
                        {form.autoCalculateHigh3
                            ? "Auto Calculated"
                            : `$${form.pensionHigh3Salary.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr`
                        }
                    </span>
                </div>
                <div className="flex justify-between">
                    <span>Benefits Start:</span>
                    <span className="text-green-200">
                        {pensionBirthYear + form.pensionRetirementAge}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span>Eligibility:</span>
                    <span className={checkCSRSEligibility(form.pensionRetirementAge, form.pensionYearsOfService).eligible ? "text-green-300" : "text-yellow-300"}>
                        {checkCSRSEligibility(form.pensionRetirementAge, form.pensionYearsOfService).message}
                    </span>
                </div>
            </div>
            <div className="text-xs text-gray-400 mt-2">
                Formula: 1.5%x5yr + 1.75%x5yr + 2%xremaining (max 80% of High-3).
                {form.autoCalculateHigh3 && " High-3 will be calculated from your top 3 salary years at retirement."}
                {!form.autoCalculateHigh3 && " Full COLA (CPI). No Social Security coverage."}
            </div>
        </div>
    </>
);
