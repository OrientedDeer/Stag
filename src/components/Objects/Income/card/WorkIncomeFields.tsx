import { ReactElement } from 'react';
import { CurrencyInput } from '../../../Layout/InputFields/CurrencyInput';
import { DropdownInput } from '../../../Layout/InputFields/DropdownInput';
import { NumberInput } from '../../../Layout/InputFields/NumberInput';
import { AlertBanner } from '../../../Layout/AlertBanner';
import { CardSection } from '../../../Layout/CardSection';
import { formatCompactCurrency } from '../../../../tabs/Future/tabs/FutureUtils';
import type {
    WorkIncome,
    AutoMax401kOption,
    PensionSystem,
} from '../models';
import type { AllIncomeKeys } from '../IncomeContext';
import type { InvestedAccount, ESPPAccount } from '../../Accounts/models';
import type { ContributionWarning } from '../incomeCardUtils';
import { ESPPFields } from './ESPPFields';

interface WorkIncomeFieldsProps {
    income: WorkIncome;
    onFieldUpdate: (field: AllIncomeKeys, value: unknown) => void;
    contributionAccounts: InvestedAccount[];
    esppAccounts: ESPPAccount[];
    contributionWarnings: ContributionWarning[] | null;
    onMatchAccountChange: (accountId: string | null) => void;
}

const fmt = (n: number) => formatCompactCurrency(n, { forceExact: true });

/** Paystub-style one-liner for the collapsed 401k & Match section. */
function get401kSummary(income: WorkIncome): string {
    let contrib: string;
    switch (income.autoMax401k) {
        case 'disabled': return 'None';
        case 'traditional': contrib = 'Max Pre-Tax'; break;
        case 'roth': contrib = 'Max Roth'; break;
        default: {
            const parts: string[] = [];
            if (income.preTax401k > 0) parts.push(`${fmt(income.preTax401k)} pre-tax`);
            if (income.roth401k > 0) parts.push(`${fmt(income.roth401k)} Roth`);
            contrib = parts.length > 0 ? parts.join(' + ') : 'Custom ($0)';
        }
    }
    const match = income.employerMatchType === 'percent'
        ? ((income.employerMatchPercent ?? 0) > 0 ? `${income.employerMatchPercent}% match` : null)
        : (income.employerMatch > 0 ? `${fmt(income.employerMatch)} match` : null);
    return match ? `${contrib} · ${match}` : contrib;
}

function getBenefitsSummary(income: WorkIncome): string {
    const parts: string[] = [];
    if (income.insurance > 0) parts.push(`${fmt(income.insurance)} insurance`);
    if (income.hsaContribution > 0) parts.push(`${fmt(income.hsaContribution)} HSA`);
    return parts.length > 0 ? parts.join(' · ') : 'None';
}

function getESPPSummary(income: WorkIncome): string {
    if (income.esppContributionType === 'NONE') return 'None';
    return income.esppContributionType === 'PERCENTAGE'
        ? `${income.esppContributionAmount}% of salary`
        : `${fmt(income.esppContributionAmount)}/yr`;
}

export function WorkIncomeFields({
    income,
    onFieldUpdate,
    contributionAccounts,
    esppAccounts,
    contributionWarnings,
    onMatchAccountChange,
}: WorkIncomeFieldsProps): ReactElement {
    return (
        <>
            {/* Heavy field clusters live in collapsed sections with paystub-style
                summaries so the card stays scannable. Warnings render outside
                the sections — they must never be hidden by a collapse. */}
            <CardSection
                id={`${income.id}-section-401k`}
                title="401k & Match"
                summary={get401kSummary(income)}
            >
                <DropdownInput
                    id={`${income.id}-401k-mode`}
                    label="401k Contributions"
                    onChange={(val) => onFieldUpdate('autoMax401k', val as AutoMax401kOption)}
                    options={[
                        { value: 'disabled', label: 'None' },
                        { value: 'custom', label: 'Custom Amount' },
                        { value: 'traditional', label: 'Max Pre-Tax' },
                        { value: 'roth', label: 'Max Roth' },
                    ]}
                    value={income.autoMax401k}
                />
                {income.autoMax401k === 'custom' && (
                    <>
                        <CurrencyInput
                            id={`${income.id}-pre-tax-contributions`}
                            label="Pre-Tax 401k"
                            value={income.preTax401k}
                            onChange={(val) => onFieldUpdate('preTax401k', val)}
                        />
                        <CurrencyInput
                            id={`${income.id}-roth-contributions`}
                            label="Roth 401k"
                            value={income.roth401k}
                            onChange={(val) => onFieldUpdate('roth401k', val)}
                        />
                        {(income.preTax401k > 0 || income.roth401k > 0) && (
                            <DropdownInput
                                id={`${income.id}-contribution-growth`}
                                label="Contribution Growth"
                                onChange={(val) => onFieldUpdate('contributionGrowthStrategy', val)}
                                options={[
                                    { value: 'FIXED', label: 'Remain Fixed' },
                                    { value: 'GROW_WITH_SALARY', label: 'Grow with Salary' },
                                    { value: 'TRACK_ANNUAL_MAX', label: 'Track Annual Maximum' },
                                ]}
                                value={income.contributionGrowthStrategy}
                            />
                        )}
                    </>
                )}
                {income.autoMax401k !== 'disabled' && (
                    <>
                        <DropdownInput
                            id={`${income.id}-employer-match-type`}
                            label="Employer Match"
                            options={[
                                { value: 'fixed', label: 'Fixed Amount' },
                                { value: 'percent', label: '% of Earnings' },
                            ]}
                            value={income.employerMatchType ?? 'fixed'}
                            onChange={(val) => onFieldUpdate('employerMatchType', val as 'fixed' | 'percent')}
                            tooltip="Fixed: a set dollar amount per year. % of Earnings: a percentage of salary up to an optional annual cap."
                        />
                        {(income.employerMatchType ?? 'fixed') === 'fixed' && (
                            <CurrencyInput
                                id={`${income.id}-employer-match`}
                                label="Match Amount"
                                value={income.employerMatch}
                                onChange={(val) => onFieldUpdate('employerMatch', val)}
                            />
                        )}
                        {income.employerMatchType === 'percent' && (
                            <>
                                <NumberInput
                                    id={`${income.id}-employer-match-percent`}
                                    label="Match %"
                                    value={income.employerMatchPercent ?? 0}
                                    onChange={(val) => onFieldUpdate('employerMatchPercent', val)}
                                    min={0}
                                    max={100}
                                    tooltip="Percentage of your salary your employer matches (e.g., 4 for 4%)."
                                />
                                <CurrencyInput
                                    id={`${income.id}-employer-match-max`}
                                    label="Annual Cap"
                                    value={income.employerMatchMax ?? 0}
                                    onChange={(val) => onFieldUpdate('employerMatchMax', val)}
                                    tooltip="Maximum annual employer match in dollars. This cap is fixed and does not adjust for inflation. Leave at 0 for no cap."
                                />
                            </>
                        )}
                        {((income.employerMatchType ?? 'fixed') === 'fixed'
                            ? income.employerMatch > 0
                            : (income.employerMatchPercent ?? 0) > 0) && (
                            <DropdownInput
                                label="Match Account"
                                onChange={(val) => onMatchAccountChange(val)}
                                options={contributionAccounts.map((acc) => ({
                                    value: acc.id || '',
                                    label: acc.name,
                                }))}
                                value={income.matchAccountId}
                                tooltip="Your contributions and the employer match deposit into this account; the Budget tab tracks them as payroll-routed."
                            />
                        )}
                    </>
                )}
            </CardSection>

            <CardSection
                id={`${income.id}-section-benefits`}
                title="Benefits"
                summary={getBenefitsSummary(income)}
            >
                <CurrencyInput
                    id={`${income.id}-insurance`}
                    label="Insurance"
                    value={income.insurance}
                    onChange={(val) => onFieldUpdate('insurance', val)}
                />
                <CurrencyInput
                    id={`${income.id}-hsa-contribution`}
                    label="HSA Contribution"
                    value={income.hsaContribution}
                    onChange={(val) => onFieldUpdate('hsaContribution', val)}
                />
            </CardSection>

            <CardSection
                id={`${income.id}-section-espp`}
                title="ESPP"
                summary={getESPPSummary(income)}
            >
                <ESPPFields income={income} onFieldUpdate={onFieldUpdate} esppAccounts={esppAccounts} />
            </CardSection>

            <CardSection
                id={`${income.id}-section-pension`}
                title="Pension"
                summary={income.pensionSystem === 'NONE' ? 'None' : income.pensionSystem}
            >
                <DropdownInput
                    id={`${income.id}-pension-system`}
                    label="Pension System"
                    onChange={(val) => onFieldUpdate('pensionSystem', val as PensionSystem)}
                    options={[
                        { value: 'NONE', label: 'None' },
                        { value: 'FERS', label: 'FERS (Federal)' },
                        { value: 'CSRS', label: 'CSRS (Federal)' },
                    ]}
                    value={income.pensionSystem}
                    tooltip="If this job is covered by a federal pension system, select it here. This helps track your High-3 salary for pension calculations."
                />
            </CardSection>

            {contributionWarnings && contributionWarnings.length > 0 && (
                <div className="col-span-full">
                    {contributionWarnings.map((warning, idx) => (
                        <AlertBanner key={idx} severity="warning" size="sm" className="mb-2">
                            <span className="font-medium">{warning.message}</span>
                            <span className="text-content-default ml-2">
                                (Annual:{' '}
                                {formatCompactCurrency(warning.annual, { forceExact: true })} /
                                Limit: {formatCompactCurrency(warning.limit, { forceExact: true })})
                            </span>
                        </AlertBanner>
                    ))}
                </div>
            )}
        </>
    );
}
