import { type ReactElement } from 'react';
import { CurrencyInput } from '../../../Layout/InputFields/CurrencyInput';
import { DropdownInput } from '../../../Layout/InputFields/DropdownInput';
import { NumberInput } from '../../../Layout/InputFields/NumberInput';
import type { AutoMax401kOption, ContributionGrowthStrategy, EmployerMatchType } from '../models';
import type { InvestedAccount } from '../../Accounts/models';

/**
 * Value-based 401k & employer-match field cluster shared by BOTH the income card
 * and the Add-Income modal (the body of their "401k & Match" CardSection). Both
 * surfaces drive it through the same value/onUpdate props — the card from
 * `income.*` / onFieldUpdate, the modal from `form.*` / updateForm — so the two
 * editors are guaranteed identical (same fields, tooltips, labels, options).
 * Neither hand-copies this block (#151, finishing the #140 RSU/ESPP consolidation).
 *
 * The destination-account selector takes its own `onMatchAccountChange` rather than
 * the generic `onUpdate`: the card passes an auto-healing handler (it re-points a
 * dangling matchAccountId, #123), the modal a plain form setter — the one
 * intentional card-vs-modal divergence. The deferral-destination WARNING stays in
 * each editor (rendered OUTSIDE the collapsible section so a collapse can't hide it).
 */
export interface Income401kFieldValues {
    autoMax401k: AutoMax401kOption;
    preTax401k: number;
    roth401k: number;
    contributionGrowthStrategy: ContributionGrowthStrategy;
    employerMatchType: EmployerMatchType;
    employerMatch: number;
    employerMatchPercent: number;
    employerMatchMax: number;
    // string (card's WorkIncome) — the modal's form matchAccountId is also a string.
    matchAccountId: string;
}

interface Income401kFieldsProps {
    values: Income401kFieldValues;
    onUpdate: (field: keyof Income401kFieldValues, value: unknown) => void;
    idPrefix: string;
    contributionAccounts: InvestedAccount[];
    /**
     * Whether a deferral (auto-max or a positive custom amount) is configured —
     * surfaces the Destination Account selector alongside any employer match, so a
     * deferral with no destination still prompts for one (#123). Computed by each
     * editor via the shared `hasConfiguredDeferral`.
     */
    hasDeferral: boolean;
    /**
     * Destination-account change handler. The card passes its auto-healing
     * `onMatchAccountChange`; the modal passes `(val) => updateForm('matchAccountId', val)`.
     */
    onMatchAccountChange: (accountId: string) => void;
}

export function Income401kFields({
    values,
    onUpdate,
    idPrefix,
    contributionAccounts,
    hasDeferral,
    onMatchAccountChange,
}: Income401kFieldsProps): ReactElement {
    const matchType: EmployerMatchType = values.employerMatchType ?? 'fixed';
    return (
        <>
            <DropdownInput
                id={`${idPrefix}-401k-mode`}
                label="401k Contributions"
                onChange={(val) => onUpdate('autoMax401k', val as AutoMax401kOption)}
                options={[
                    { value: 'disabled', label: 'None' },
                    { value: 'custom', label: 'Custom Amount' },
                    { value: 'traditional', label: 'Max Pre-Tax' },
                    { value: 'roth', label: 'Max Roth' },
                ]}
                value={values.autoMax401k}
                tooltip="None: No 401k. Custom: Enter amounts manually. Max Pre-Tax: Auto-max traditional 401k. Max Roth: Auto-max Roth 401k."
            />
            {values.autoMax401k === 'custom' && (
                <>
                    <CurrencyInput
                        id={`${idPrefix}-pre-tax-contributions`}
                        label="Pre-Tax 401k/403b"
                        value={values.preTax401k}
                        onChange={(val) => onUpdate('preTax401k', val)}
                        tooltip="Monthly contribution to traditional 401k/403b. Reduces taxable income now, taxed on withdrawal."
                    />
                    <CurrencyInput
                        id={`${idPrefix}-roth-contributions`}
                        label="Roth 401k"
                        value={values.roth401k}
                        onChange={(val) => onUpdate('roth401k', val)}
                        tooltip="Monthly contribution to Roth 401k. Taxed now, but grows and withdraws tax-free."
                    />
                    {(values.preTax401k > 0 || values.roth401k > 0) && (
                        <DropdownInput
                            id={`${idPrefix}-contribution-growth`}
                            label="Contribution Growth"
                            onChange={(val) => onUpdate('contributionGrowthStrategy', val as ContributionGrowthStrategy)}
                            options={[
                                { value: 'FIXED', label: 'Remain Fixed' },
                                { value: 'GROW_WITH_SALARY', label: 'Grow with Salary' },
                                { value: 'TRACK_ANNUAL_MAX', label: 'Track Annual Maximum' },
                            ]}
                            value={values.contributionGrowthStrategy}
                            tooltip="Fixed: contributions stay the same. Grow with Salary: increase with raises. Track Max: always contribute IRS maximum."
                        />
                    )}
                </>
            )}
            {values.autoMax401k !== 'disabled' && (
                <>
                    <DropdownInput
                        id={`${idPrefix}-employer-match-type`}
                        label="Employer Match"
                        options={[
                            { value: 'fixed', label: 'Fixed Amount' },
                            { value: 'percent', label: '% of Earnings' },
                        ]}
                        value={matchType}
                        onChange={(val) => onUpdate('employerMatchType', val as EmployerMatchType)}
                        tooltip="Fixed: a set dollar amount per year. % of Earnings: a percentage of salary up to an optional annual cap."
                    />
                    {matchType === 'fixed' && (
                        <CurrencyInput
                            id={`${idPrefix}-employer-match`}
                            label="Match Amount"
                            value={values.employerMatch}
                            onChange={(val) => onUpdate('employerMatch', val)}
                            tooltip="Annual amount your employer contributes to your 401k."
                        />
                    )}
                    {matchType === 'percent' && (
                        <>
                            <NumberInput
                                id={`${idPrefix}-employer-match-percent`}
                                label="Match %"
                                value={values.employerMatchPercent ?? 0}
                                onChange={(val) => onUpdate('employerMatchPercent', val)}
                                min={0}
                                max={100}
                                tooltip="Percentage of your salary your employer matches (e.g., 4 for 4%)."
                            />
                            <CurrencyInput
                                id={`${idPrefix}-employer-match-max`}
                                label="Annual Cap"
                                value={values.employerMatchMax ?? 0}
                                onChange={(val) => onUpdate('employerMatchMax', val)}
                                tooltip="Maximum annual employer match in dollars. This cap is fixed and does not adjust for inflation. Leave at 0 for no cap."
                            />
                        </>
                    )}
                    {/* The destination account receives both the user's 401k deferral
                        AND the employer match. Render it whenever EITHER is configured —
                        a deferral with no destination gets the tax break but is never
                        deposited, silently leaking out of net worth (issue #123). */}
                    {(hasDeferral
                        || (matchType === 'fixed' ? values.employerMatch > 0 : (values.employerMatchPercent ?? 0) > 0)) && (
                        <DropdownInput
                            id={`${idPrefix}-match-account`}
                            label="Destination Account"
                            onChange={(val) => onMatchAccountChange(val)}
                            options={contributionAccounts.map((acc) => ({
                                value: acc.id || '',
                                label: acc.name,
                            }))}
                            value={values.matchAccountId}
                            tooltip="Your 401k contributions and the employer match deposit into this account; the Budget tab tracks them as payroll-routed."
                        />
                    )}
                </>
            )}
        </>
    );
}
