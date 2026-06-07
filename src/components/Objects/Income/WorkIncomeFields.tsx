import React from "react";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput";
import { PercentageInput } from "../../Layout/InputFields/PercentageInput";
import {
    ContributionGrowthStrategy,
    AutoMax401kOption,
    ESPPContributionType,
    PensionSystem
} from './models';
import { InvestedAccount, ESPPAccount } from "../Accounts/models";
import { IncomeFormState, UpdateForm } from './incomeFormTypes';

interface WorkIncomeFieldsProps {
    form: IncomeFormState;
    updateForm: UpdateForm;
    contributionAccounts: InvestedAccount[];
    esppAccounts: ESPPAccount[];
}

export const WorkIncomeFields: React.FC<WorkIncomeFieldsProps> = ({
    form,
    updateForm,
    contributionAccounts,
    esppAccounts
}) => (
    <>
        <DropdownInput
            label="401k Contributions"
            onChange={(val) => updateForm('autoMax401k', val as AutoMax401kOption)}
            options={[
                { value: 'disabled', label: 'None' },
                { value: 'custom', label: 'Custom Amount' },
                { value: 'traditional', label: 'Max Pre-Tax' },
                { value: 'roth', label: 'Max Roth' }
            ]}
            value={form.autoMax401k}
            tooltip="None: No 401k. Custom: Enter amounts manually. Max Pre-Tax: Auto-max traditional 401k. Max Roth: Auto-max Roth 401k."
        />
        {form.autoMax401k === 'custom' && (
            <>
                <CurrencyInput label="Pre-Tax 401k/403b" value={form.preTax401k} onChange={(val) => updateForm('preTax401k', val)} tooltip="Monthly contribution to traditional 401k/403b. Reduces taxable income now, taxed on withdrawal." />
                <CurrencyInput label="Roth 401k" value={form.roth401k} onChange={(val) => updateForm('roth401k', val)} tooltip="Monthly contribution to Roth 401k. Taxed now, but grows and withdraws tax-free." />
                {(form.preTax401k > 0 || form.roth401k > 0) && (
                    <DropdownInput
                        label="Contribution Growth"
                        onChange={(val) => updateForm('contributionGrowthStrategy', val as ContributionGrowthStrategy)}
                        options={[
                            { value: 'FIXED', label: 'Remain Fixed' },
                            { value: 'GROW_WITH_SALARY', label: 'Grow with Salary' },
                            { value: 'TRACK_ANNUAL_MAX', label: 'Track Annual Maximum' }
                        ]}
                        value={form.contributionGrowthStrategy}
                        tooltip="Fixed: contributions stay the same. Grow with Salary: increase with raises. Track Max: always contribute IRS maximum."
                    />
                )}
            </>
        )}
        {form.autoMax401k !== 'disabled' && (
            <>
                <DropdownInput
                    label="Employer Match"
                    options={[{ value: 'fixed', label: 'Fixed Amount' }, { value: 'percent', label: '% of Earnings' }]}
                    value={form.employerMatchType}
                    onChange={(val) => updateForm('employerMatchType', val as 'fixed' | 'percent')}
                    tooltip="Fixed: a set dollar amount per year. % of Earnings: a percentage of salary up to an optional annual cap."
                />
                {form.employerMatchType === 'fixed' && (
                    <CurrencyInput label="Match Amount" value={form.employerMatch} onChange={(val) => updateForm('employerMatch', val)} tooltip="Annual amount your employer contributes to your 401k." />
                )}
                {form.employerMatchType === 'percent' && (
                    <>
                        <NumberInput label="Match %" value={form.employerMatchPercent} onChange={(val) => updateForm('employerMatchPercent', val)} min={0} max={100} tooltip="Percentage of your salary your employer matches (e.g., 4 for 4%)." />
                        <CurrencyInput label="Annual Cap" value={form.employerMatchMax} onChange={(val) => updateForm('employerMatchMax', val)} tooltip="Maximum annual employer match in dollars. This cap is fixed and does not adjust for inflation. Leave at 0 for no cap." />
                    </>
                )}
                {(form.employerMatchType === 'fixed' ? form.employerMatch > 0 : form.employerMatchPercent > 0) && (
                    <DropdownInput
                        label="Match Account"
                        onChange={(val) => updateForm('matchAccountId', val)}
                        options={contributionAccounts.map(acc => ({ value: acc.id, label: acc.name }))}
                        value={form.matchAccountId}
                        tooltip="Which 401k account receives your employer's matching contributions."
                    />
                )}
            </>
        )}
        <CurrencyInput label="Insurance" value={form.insurance} onChange={(val) => updateForm('insurance', val)} tooltip="Monthly pre-tax deduction for health, dental, vision insurance." />
        <CurrencyInput label="HSA Contribution" value={form.hsaContribution} onChange={(val) => updateForm('hsaContribution', val)} tooltip="Monthly HSA contribution. Triple tax advantage: pre-tax, grows tax-free, tax-free withdrawals for medical expenses." />
        {/* ESPP Section */}
        <DropdownInput
            label="ESPP Contribution"
            onChange={(val) => updateForm('esppContributionType', val as ESPPContributionType)}
            options={[
                { value: 'NONE', label: 'None' },
                { value: 'PERCENTAGE', label: '% of Salary' },
                { value: 'FIXED', label: 'Fixed Amount' }
            ]}
            value={form.esppContributionType}
            tooltip="Employee Stock Purchase Plan. Contribute up to 15% of salary to buy company stock at a discount."
        />
        {form.esppContributionType !== 'NONE' && (
            <>
                {form.esppContributionType === 'PERCENTAGE' ? (
                    <PercentageInput
                        label="Contribution"
                        value={form.esppContributionAmount}
                        onChange={(val) => updateForm('esppContributionAmount', val)}
                        max={15}
                        tooltip="Percentage of salary to contribute to ESPP. Most plans cap at 10-15%."
                    />
                ) : (
                    <CurrencyInput
                        label="Contribution Amount"
                        value={form.esppContributionAmount}
                        onChange={(val) => updateForm('esppContributionAmount', val)}
                        tooltip="Fixed amount per pay period to contribute to ESPP."
                    />
                )}
                <PercentageInput
                    label="Discount"
                    value={form.esppDiscountPercent}
                    onChange={(val) => updateForm('esppDiscountPercent', val)}
                    max={15}
                    tooltip="ESPP discount off stock price. Typical is 15%."
                />
                <ToggleInput
                    label="Lookback"
                    enabled={form.esppHasLookback}
                    setEnabled={(val) => updateForm('esppHasLookback', val)}
                    tooltip="If enabled, discount applies to lower of grant or purchase date price, increasing effective discount."
                />
                {esppAccounts.length > 0 ? (
                    <DropdownInput
                        label="ESPP Account"
                        onChange={(val) => updateForm('esppAccountId', val)}
                        options={esppAccounts.map(acc => ({ value: acc.id, label: acc.name }))}
                        value={form.esppAccountId}
                        tooltip="Account where ESPP shares will be deposited."
                    />
                ) : (
                    <div className="col-span-full bg-warning-tint/30 border border-warning-strong/50 rounded-lg p-3 text-xs text-warning-bright">
                        <span className="font-semibold">No ESPP Account</span>
                        <p className="text-warning/80 mt-1">Create an ESPP account in the Accounts tab to track your ESPP purchases.</p>
                    </div>
                )}
            </>
        )}
        {/* Pension System Selection */}
        <DropdownInput
            label="Pension System"
            onChange={(val) => updateForm('pensionSystem', val as PensionSystem)}
            options={[
                { value: 'NONE', label: 'None' },
                { value: 'FERS', label: 'FERS (Federal)' },
                { value: 'CSRS', label: 'CSRS (Federal)' }
            ]}
            value={form.pensionSystem}
            tooltip="If this job is covered by a federal pension system, select it here. This helps track your High-3 salary for pension calculations."
        />
    </>
);
