import { ReactElement } from 'react';
import { CurrencyInput } from '../../../Layout/InputFields/CurrencyInput';
import { DropdownInput } from '../../../Layout/InputFields/DropdownInput';
import { NumberInput } from '../../../Layout/InputFields/NumberInput';
import { ToggleInput } from '../../../Layout/InputFields/ToggleInput';
import {
    checkCSRSEligibility,
    calculateCSRSBasicBenefit,
} from '../../../../data/PensionData';
import type { CSRSPensionIncome, WorkIncome } from '../models';
import type { AllIncomeKeys } from '../IncomeContext';

interface CSRSPensionFieldsProps {
    income: CSRSPensionIncome;
    onFieldUpdate: (field: AllIncomeKeys, value: unknown) => void;
    workIncomes: WorkIncome[];
    birthYear: number;
}

export function CSRSPensionFields({
    income,
    onFieldUpdate,
    workIncomes,
    birthYear,
}: CSRSPensionFieldsProps): ReactElement {
    return (
        <>
            <NumberInput
                id={`${income.id}-pension-years-of-service`}
                label="Years of Service"
                value={income.yearsOfService}
                onChange={(val) => onFieldUpdate('yearsOfService', val)}
                tooltip="Total years of creditable federal service under CSRS"
            />

            {workIncomes.length > 0 ? (
                <div className="col-span-2 flex flex-col gap-3">
                    <ToggleInput
                        id={`${income.id}-auto-high3`}
                        label="Auto High-3"
                        enabled={income.autoCalculateHigh3}
                        setEnabled={(val) => onFieldUpdate('autoCalculateHigh3', val)}
                        tooltip="Calculate High-3 from projected salaries at retirement"
                    />
                    {income.autoCalculateHigh3 ? (
                        <DropdownInput
                            id={`${income.id}-linked-income`}
                            label="Link to Income"
                            value={income.linkedIncomeId || ''}
                            onChange={(val) => onFieldUpdate('linkedIncomeId', val || null)}
                            options={workIncomes.map((inc) => ({ value: inc.id, label: inc.name }))}
                            tooltip="High-3 will be calculated from your top 3 salary years at retirement"
                        />
                    ) : (
                        <CurrencyInput
                            id={`${income.id}-high3-salary`}
                            label="High-3 Salary"
                            value={income.high3Salary}
                            onChange={(val) => onFieldUpdate('high3Salary', val)}
                            tooltip="Average of your highest 3 consecutive years of basic pay"
                        />
                    )}
                </div>
            ) : (
                <CurrencyInput
                    id={`${income.id}-high3-salary`}
                    label="High-3 Salary"
                    value={income.high3Salary}
                    onChange={(val) => onFieldUpdate('high3Salary', val)}
                    tooltip="Average of your highest 3 consecutive years of basic pay"
                />
            )}

            <NumberInput
                id={`${income.id}-retirement-age`}
                label="Retirement Age"
                value={income.retirementAge}
                onChange={(val) => onFieldUpdate('retirementAge', val)}
                tooltip="Age 55 with 30+ years, age 60 with 20+ years, or age 62 with 5+ years for full benefits"
            />

            <div className="col-span-full bg-positive-tint/20 border border-positive-strong/50 rounded-lg p-4 text-sm">
                <div className="font-semibold text-positive-bright mb-2">CSRS Pension Estimate</div>
                <div className="text-content-default space-y-1">
                    <div className="flex justify-between">
                        <span>Estimated Annual Benefit:</span>
                        <span className="font-bold text-positive-bright">
                            {income.autoCalculateHigh3
                                ? 'Auto Calculated'
                                : `$${calculateCSRSBasicBenefit(
                                      income.yearsOfService,
                                      income.high3Salary
                                  ).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr`}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span>High-3:</span>
                        <span className="text-positive-bright">
                            {income.autoCalculateHigh3
                                ? 'Auto Calculated'
                                : `$${income.high3Salary.toLocaleString(undefined, {
                                      maximumFractionDigits: 0,
                                  })}/yr`}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span>Benefits Start:</span>
                        <span className="text-positive-bright">{birthYear + income.retirementAge}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Eligibility:</span>
                        <span
                            className={
                                checkCSRSEligibility(income.retirementAge, income.yearsOfService)
                                    .eligible
                                    ? 'text-positive-bright'
                                    : 'text-warning-bright'
                            }
                        >
                            {
                                checkCSRSEligibility(income.retirementAge, income.yearsOfService)
                                    .message
                            }
                        </span>
                    </div>
                </div>
                <div className="text-xs text-content-muted mt-2">
                    Formula: 1.5%x5yr + 1.75%x5yr + 2%xremaining (max 80% of High-3).
                    {income.autoCalculateHigh3
                        ? ' High-3 will be calculated from your top 3 salary years at retirement.'
                        : ' Full COLA (CPI). No Social Security coverage.'}
                </div>
            </div>
        </>
    );
}
