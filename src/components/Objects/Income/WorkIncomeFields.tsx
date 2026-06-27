import React from "react";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { CardSection } from "../../Layout/CardSection";
import { AlertBanner } from "../../Layout/AlertBanner";
import {
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
import { Income401kFields } from './card/Income401kFields';
import { BenefitsFields } from './card/BenefitsFields';

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
            <Income401kFields
                values={form}
                onUpdate={(field, value) => updateForm(field, value as IncomeFormState[typeof field])}
                idPrefix="add-income"
                contributionAccounts={contributionAccounts}
                hasDeferral={hasDeferral}
                onMatchAccountChange={(val) => updateForm('matchAccountId', val)}
            />
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
            <BenefitsFields values={form} onUpdate={(field, value) => updateForm(field, value as IncomeFormState[typeof field])} idPrefix="add-income" />
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
                not the raw enum). showAccountLink OFF for the same #141 reason;
                showPriceValidation OFF so the modal doesn't surface the card-only
                "Current Share Price Required" error mid-add (#140 review). */}
            <RSUFields
                values={form}
                onUpdate={(field, value) => updateForm(field, value as IncomeFormState[typeof field])}
                rsuAccounts={rsuAccounts}
                idPrefix="add-income"
                showPriceValidation={false}
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
