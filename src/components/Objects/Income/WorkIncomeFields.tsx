import React from "react";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { CardSection } from "../../Layout/CardSection";
import { AlertBanner } from "../../Layout/AlertBanner";
import {
    ContributionGrowthStrategy,
    AutoMax401kOption,
    PensionSystem
} from './models';
import { InvestedAccount, ESPPAccount, RSUAccount } from "../Accounts/models";
import { IncomeFormState, UpdateForm } from './incomeFormTypes';
import {
    get401kSummary,
    getBenefitsSummary,
    getESPPSummary,
    getRSUSummary,
    getPensionSummary
} from './workIncomeSummaries';
import { hasConfiguredDeferral, getDeferralDestinationMessageFor } from './incomeCardUtils';
import { ESPPFields } from './card/ESPPFields';
import { RSUFields } from './card/RSUFields';

interface WorkIncomeFieldsProps {
    form: IncomeFormState;
    updateForm: UpdateForm;
    contributionAccounts: InvestedAccount[];
    esppAccounts: ESPPAccount[];
    rsuAccounts: RSUAccount[];
}

// Matches the Add Income modal's field grid so expanded sections lay out
// identically to the fields around them.
const MODAL_SECTION_GRID = 'grid grid-cols-2 lg:grid-cols-3 gap-4 px-4 pb-4';

/**
 * Work-income fields for the Add Income modal. Only the core salary fields
 * (name, frequency, gross amount, dates) stay visible in the modal itself;
 * the optional clusters below collapse to paystub-style summary lines so a
 * user adding a plain salary never scrolls past 401k machinery.
 */
export const WorkIncomeFields: React.FC<WorkIncomeFieldsProps> = ({
    form,
    updateForm,
    contributionAccounts,
    esppAccounts,
    rsuAccounts
}) => {
    // A configured deferral (auto-max or a positive custom amount) needs a
    // destination account, independent of any employer match — without one the
    // deferral lowers taxes but is never deposited (issue #123). Both `hasDeferral`
    // and the validation come from the shared helpers so the modal and the card
    // agree, including on the dangling-id (deleted-account) case the modal used to
    // miss: `form` satisfies the structural DeferralConfig shape.
    const hasDeferral = hasConfiguredDeferral(form);
    const deferralDestinationMessage = getDeferralDestinationMessageFor(
        form,
        contributionAccounts
    );
    return (
        <>
        <CardSection
            id="add-income-section-401k"
            title="401k & Match"
            summary={get401kSummary(form)}
            gridClassName={MODAL_SECTION_GRID}
        >
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
                    {/* The destination account receives both the user's 401k deferral
                        AND the employer match. Render it whenever EITHER is configured —
                        a deferral with no destination gets the tax break but is never
                        deposited, silently leaking out of net worth (issue #123). */}
                    {(hasDeferral
                        || (form.employerMatchType === 'fixed' ? form.employerMatch > 0 : form.employerMatchPercent > 0)) && (
                        <DropdownInput
                            label="Destination Account"
                            onChange={(val) => updateForm('matchAccountId', val)}
                            options={contributionAccounts.map(acc => ({ value: acc.id, label: acc.name }))}
                            value={form.matchAccountId}
                            tooltip="Your 401k contributions and the employer match deposit into this account."
                        />
                    )}
                </>
            )}
        </CardSection>

        {/* The deferral-destination warning lives OUTSIDE the collapsed 401k section
            so it stays visible even while that section is collapsed — a dangling id
            (destination account deleted) only survives in the collapsed state, since
            expanding the section mounts the Destination dropdown which auto-heals an
            id that's no longer in its options. Mirrors the card variant, which also
            renders its warnings outside the sections so a collapse can't hide them. */}
        {deferralDestinationMessage && (
            <AlertBanner
                severity="error"
                size="sm"
                title="Destination Account Required"
                className="col-span-full"
            >
                {deferralDestinationMessage}
            </AlertBanner>
        )}

        <CardSection
            id="add-income-section-benefits"
            title="Benefits"
            summary={getBenefitsSummary(form)}
            gridClassName={MODAL_SECTION_GRID}
        >
            <CurrencyInput label="Insurance" value={form.insurance} onChange={(val) => updateForm('insurance', val)} tooltip="Monthly pre-tax deduction for health, dental, vision insurance." />
            <CurrencyInput label="HSA Contribution" value={form.hsaContribution} onChange={(val) => updateForm('hsaContribution', val)} tooltip="Monthly HSA contribution. Triple tax advantage: pre-tax, grows tax-free, tax-free withdrawals for medical expenses." />
        </CardSection>

        <CardSection
            id="add-income-section-espp"
            title="ESPP"
            summary={getESPPSummary(form)}
            gridClassName={MODAL_SECTION_GRID}
        >
            {/* Shared, value-based cluster — identical to the income card's ESPP
                section (fields, tooltips, warnings). No modal-only hand-copy.
                showAccountLink is OFF: inside the Add-Income modal a <Link> would
                navigate away and abandon the in-progress income, so the modal
                warnings stay text-only (matches AddExpenseModal; see #141). */}
            <ESPPFields
                values={form}
                onUpdate={(field, value) => updateForm(field, value as IncomeFormState[typeof field])}
                esppAccounts={esppAccounts}
                idPrefix="add-income"
            />
        </CardSection>

        <CardSection
            id="add-income-section-rsu"
            title="RSU"
            summary={getRSUSummary(form)}
            gridClassName={MODAL_SECTION_GRID}
        >
            {/* Shared, value-based cluster — identical to the income card's RSU
                section. The collapsed summary uses getRSUSummary (friendly label,
                not the raw enum). showAccountLink OFF for the same #141 reason. */}
            <RSUFields
                values={form}
                onUpdate={(field, value) => updateForm(field, value as IncomeFormState[typeof field])}
                rsuAccounts={rsuAccounts}
                idPrefix="add-income"
            />
        </CardSection>

        <CardSection
            id="add-income-section-pension"
            title="Pension"
            summary={getPensionSummary(form.pensionSystem)}
            gridClassName={MODAL_SECTION_GRID}
        >
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
        </CardSection>
    </>
    );
};
