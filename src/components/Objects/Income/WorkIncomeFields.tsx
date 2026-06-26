import React from "react";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput";
import { PercentageInput } from "../../Layout/InputFields/PercentageInput";
import { CardSection } from "../../Layout/CardSection";
import { AlertBanner } from "../../Layout/AlertBanner";
import {
    ContributionGrowthStrategy,
    AutoMax401kOption,
    ESPPContributionType,
    PensionSystem,
    RSUVestingSchedule,
    RSUVestFrequency
} from './models';
import { InvestedAccount, ESPPAccount, RSUAccount } from "../Accounts/models";
import { IncomeFormState, UpdateForm } from './incomeFormTypes';
import {
    get401kSummary,
    getBenefitsSummary,
    getESPPSummary,
    getPensionSummary
} from './workIncomeSummaries';
import { hasConfiguredDeferral, getDeferralDestinationMessageFor } from './incomeCardUtils';

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
                        // Text-only (no deep link) inside the Add-Income modal: a <Link>
                        // would navigate away and abandon the in-progress income. This
                        // matches the AddExpenseModal precedent — its in-modal warnings
                        // never link out; the cross-tab link only appears in a post-submit
                        // receipt toast. The card-context warning carries the link (#141).
                        <AlertBanner severity="warning" size="sm" title="No ESPP Account" className="col-span-full">
                            Create an ESPP account in the Accounts tab to track your ESPP purchases.
                        </AlertBanner>
                    )}
                </>
            )}
        </CardSection>

        <CardSection
            id="add-income-section-rsu"
            title="RSU"
            summary={form.rsuVestingSchedule === 'NONE' ? 'None' : `${form.rsuGrantShares} sh · ${form.rsuVestingSchedule}`}
            gridClassName={MODAL_SECTION_GRID}
        >
            <DropdownInput
                label="Vesting Schedule"
                onChange={(val) => updateForm('rsuVestingSchedule', val as RSUVestingSchedule)}
                options={[
                    { value: 'NONE', label: 'None' },
                    { value: 'cliff-1yr', label: '1-Year Cliff' },
                    { value: 'graded-3yr', label: 'Graded (3 Years)' },
                    { value: 'graded-4yr', label: 'Graded (4 Years)' }
                ]}
                value={form.rsuVestingSchedule}
                tooltip="Restricted Stock Units. A cliff vests all at once at the 1-year mark; graded schedules vest evenly over the period."
            />
            {form.rsuVestingSchedule !== 'NONE' && (
                <>
                    <NumberInput
                        label="Grant Shares"
                        value={form.rsuGrantShares}
                        onChange={(val) => updateForm('rsuGrantShares', val)}
                        min={0}
                        tooltip="Total number of shares in this grant. They vest over the schedule above."
                    />
                    {form.rsuVestingSchedule !== 'cliff-1yr' && (
                        <DropdownInput
                            label="Vest Frequency"
                            onChange={(val) => updateForm('rsuVestFrequency', val as RSUVestFrequency)}
                            options={[
                                { value: 'quarterly', label: 'Quarterly' },
                                { value: 'semi-annual', label: 'Semi-Annual' },
                                { value: 'annual', label: 'Annual' }
                            ]}
                            value={form.rsuVestFrequency}
                            tooltip="How often tranches vest within the graded period (a 1-year cliff vests all at once)."
                        />
                    )}
                    <PercentageInput
                        label="Expected Stock Growth"
                        value={form.rsuExpectedStockGrowth}
                        onChange={(val) => updateForm('rsuExpectedStockGrowth', val)}
                        max={30}
                        tooltip="Expected annual stock appreciation. Projects the fair-market value (ordinary income per share) at each vest."
                    />
                    <PercentageInput
                        label="Withholding Rate"
                        value={form.rsuWithholdingRate}
                        onChange={(val) => updateForm('rsuWithholdingRate', val)}
                        max={100}
                        tooltip="Tax withheld at vest (supplemental wages). Default 37%. Shares are sold to cover; you net the remainder."
                    />
                    {rsuAccounts.length > 0 ? (
                        <DropdownInput
                            label="RSU Account"
                            onChange={(val) => updateForm('rsuAccountId', val)}
                            options={rsuAccounts.map(acc => ({ value: acc.id, label: acc.name }))}
                            value={form.rsuAccountId}
                            tooltip="Account where vested RSU shares will be deposited."
                        />
                    ) : (
                        <AlertBanner severity="warning" size="sm" title="No RSU Account" className="col-span-full">
                            Create an RSU account in the Accounts tab to track your vested shares.
                        </AlertBanner>
                    )}
                    {rsuAccounts.length > 0 && !form.rsuAccountId && (
                        <AlertBanner severity="warning" size="sm" title="RSU Account Not Linked" className="col-span-full">
                            Select an RSU account above to track your vesting tranches.
                        </AlertBanner>
                    )}
                </>
            )}
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
