import { ReactElement } from 'react';
import { CurrencyInput } from '../../../Layout/InputFields/CurrencyInput';
import { DropdownInput } from '../../../Layout/InputFields/DropdownInput';
import { NumberInput } from '../../../Layout/InputFields/NumberInput';
import { ToggleInput } from '../../../Layout/InputFields/ToggleInput';
import {
    getFERSMRA,
    checkFERSEligibility,
    calculateFERSBasicBenefit,
} from '../../../../data/PensionData';
import type { FERSPensionIncome, WorkIncome } from '../models';
import type { AllIncomeKeys } from '../IncomeContext';

interface FERSPensionFieldsProps {
    income: FERSPensionIncome;
    onFieldUpdate: (field: AllIncomeKeys, value: unknown) => void;
    workIncomes: WorkIncome[];
    birthYear: number;
}

export function FERSPensionFields({
    income,
    onFieldUpdate,
    workIncomes,
    birthYear,
}: FERSPensionFieldsProps): ReactElement {
    return (
        <>
            <NumberInput
                id={`${income.id}-pension-years-of-service`}
                label="Years of Service"
                value={income.yearsOfService}
                onChange={(val) => onFieldUpdate('yearsOfService', val)}
                tooltip="Total years of creditable federal service under FERS"
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
                tooltip={`MRA is ${getFERSMRA(birthYear)} for your birth year. Age 62 with 5+ years or MRA with 30+ years for full benefits.`}
            />

            <div className="col-span-full bg-green-900/20 border border-green-700/50 rounded-lg p-4 text-sm">
                <div className="font-semibold text-green-200 mb-2">FERS Pension Estimate</div>
                <div className="text-gray-300 space-y-1">
                    <div className="flex justify-between">
                        <span>Estimated Annual Benefit:</span>
                        <span className="font-bold text-green-300">
                            {income.autoCalculateHigh3
                                ? 'Auto Calculated'
                                : `$${calculateFERSBasicBenefit(
                                      income.yearsOfService,
                                      income.high3Salary,
                                      income.retirementAge
                                  ).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr`}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span>High-3:</span>
                        <span className="text-green-200">
                            {income.autoCalculateHigh3
                                ? 'Auto Calculated'
                                : `$${income.high3Salary.toLocaleString(undefined, {
                                      maximumFractionDigits: 0,
                                  })}/yr`}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span>Benefits Start:</span>
                        <span className="text-green-200">{birthYear + income.retirementAge}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Eligibility:</span>
                        <span
                            className={
                                checkFERSEligibility(
                                    income.retirementAge,
                                    income.yearsOfService,
                                    birthYear
                                ).eligible
                                    ? 'text-green-300'
                                    : 'text-yellow-300'
                            }
                        >
                            {
                                checkFERSEligibility(
                                    income.retirementAge,
                                    income.yearsOfService,
                                    birthYear
                                ).message
                            }
                        </span>
                    </div>
                </div>
                <div className="text-xs text-gray-400 mt-2">
                    Formula:{' '}
                    {income.retirementAge >= 62 && income.yearsOfService >= 20 ? '1.1%' : '1%'} x
                    Years x High-3.
                    {income.autoCalculateHigh3
                        ? ' High-3 will be calculated from your top 3 salary years at retirement.'
                        : ' COLA is reduced (CPI-1% if inflation > 3%).'}
                </div>
            </div>
        </>
    );
}
