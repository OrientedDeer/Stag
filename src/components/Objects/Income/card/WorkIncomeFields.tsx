import { type ReactElement } from 'react';
import { DropdownInput } from '../../../Layout/InputFields/DropdownInput';
import { AlertBanner } from '../../../Layout/AlertBanner';
import { CardSection } from '../../../Layout/CardSection';
import { formatCompactCurrency } from '../../../../tabs/Future/tabs/FutureUtils';
import type {
    WorkIncome,
    PensionSystem,
} from '../models';
import type { AllIncomeKeys } from '../IncomeContext';
import type { InvestedAccount, ESPPAccount, RSUAccount } from '../../Accounts/models';
import type { ContributionWarning } from '../incomeCardUtils';
import { getDeferralDestinationValidationMessage, hasConfiguredDeferral } from '../incomeCardUtils';
import {
    get401kSummary,
    getBenefitsSummary,
    getESPPSummary,
    getRSUSummary,
    getPensionSummary,
} from '../workIncomeSummaries';
import { ESPPFields } from './ESPPFields';
import { RSUFields } from './RSUFields';
import { Income401kFields } from './Income401kFields';
import { BenefitsFields } from './BenefitsFields';
import { AddStockAccountLink } from './AddStockAccountLink';

interface WorkIncomeFieldsProps {
    income: WorkIncome;
    onFieldUpdate: (field: AllIncomeKeys, value: unknown) => void;
    contributionAccounts: InvestedAccount[];
    esppAccounts: ESPPAccount[];
    rsuAccounts: RSUAccount[];
    contributionWarnings: ContributionWarning[] | null;
    onMatchAccountChange: (accountId: string | null) => void;
    /** #139A: false when this job is flagged CSRS/FERS but the user hasn't added a
     *  matching pension income — drives the "add a pension income" hint. Optional;
     *  defaults to true (no hint) for the Add-Income modal, which doesn't pass it. */
    hasMatchingPensionIncome?: boolean;
    /** Whether the RSU grant still needs a linked account, AFTER ended-job suppression
     *  (`!incomeEnded && rsuGrantNeedsAccount(...)`). `IncomeCard` — the sole caller of
     *  this card component — computes this ONCE for its header "No account" badge and
     *  passes it down so the badge and this card-level banner can never disagree, and the
     *  ended-job suppression rule lives in exactly ONE place (re-review 4/8). Required:
     *  there is no in-component fallback, so the rule can't silently re-duplicate here. */
    needsRsuAccount: boolean;
    /** ESPP analogue of {@link WorkIncomeFieldsProps.needsRsuAccount}. */
    needsEsppAccount: boolean;
}

export function WorkIncomeFields({
    income,
    onFieldUpdate,
    contributionAccounts,
    esppAccounts,
    rsuAccounts,
    contributionWarnings,
    onMatchAccountChange,
    hasMatchingPensionIncome = true,
    needsRsuAccount,
    needsEsppAccount,
}: WorkIncomeFieldsProps): ReactElement {
    // A configured deferral (auto-max or a positive custom amount) needs a
    // destination account, independent of any employer match. Shared with the modal
    // via the exported predicate so both editors stay in lockstep.
    const hasDeferral = hasConfiguredDeferral(income);
    const deferralDestinationMessage = getDeferralDestinationValidationMessage(
        income,
        contributionAccounts
    );
    // SINGLE source of the ended-job suppression rule: use the booleans IncomeCard
    // already derived for its header badge (so badge ↔ banner can't diverge). The rule
    // `!incomeEnded && …GrantNeedsAccount(…)` lives ONLY in IncomeCard — there is no
    // local fallback that could re-duplicate (and silently drift from) it (re-review 4).
    const showRsuMissingBanner = needsRsuAccount;
    const showEsppMissingBanner = needsEsppAccount;
    return (
        <>
            {/* #141: surface the missing-account warnings at the CARD level — above
                the collapsible RSU/ESPP sections — so a user who configures a grant
                but never links an account sees it the moment the card opens, without
                having to expand the section. The in-section copies are suppressed in
                the card (showMissingAccountWarning={false}); the modal keeps them (no
                collapse). The gate — an ACTIVE grant AND no EXISTING account (skips a
                0-share grant, catches a dangling id; #141 review), AND not an ENDED job
                (a finished grant can no longer vest, so the warning is pure noise;
                finding 4) — is computed ONCE in IncomeCard as `needsRsuAccount` /
                `needsEsppAccount` and passed down. Because the in-section copies are
                already off in the card, these card-level banners are the SINGLE ended-job
                suppression mechanism, and since IncomeCard feeds the SAME booleans to its
                header badge, badge and banner can never disagree (re-review 4/8). */}
            {showRsuMissingBanner && (
                <AlertBanner
                    severity="warning"
                    size="sm"
                    title="RSU grant has no linked account"
                    className="col-span-full mb-2"
                >
                    Vested shares won&apos;t be tracked until you link an RSU account.
                    {rsuAccounts.length > 0
                        ? ' Open the RSU section below to select one.'
                        : <> <AddStockAccountLink kind="RSU" /></>}
                </AlertBanner>
            )}
            {showEsppMissingBanner && (
                <AlertBanner
                    severity="warning"
                    size="sm"
                    title="ESPP contribution has no linked account"
                    className="col-span-full mb-2"
                >
                    ESPP purchases won&apos;t be tracked until you link an ESPP account.
                    {esppAccounts.length > 0
                        ? ' Open the ESPP section below to select one.'
                        : <> <AddStockAccountLink kind="ESPP" /></>}
                </AlertBanner>
            )}
            {/* Heavy field clusters live in collapsed sections with paystub-style
                summaries so the card stays scannable. Warnings render outside
                the sections — they must never be hidden by a collapse. */}
            <CardSection
                id={`${income.id}-section-401k`}
                title="401k & Match"
                summary={get401kSummary(income)}
            >
                <Income401kFields
                    values={income}
                    onUpdate={onFieldUpdate}
                    idPrefix={income.id}
                    contributionAccounts={contributionAccounts}
                    hasDeferral={hasDeferral}
                    onMatchAccountChange={onMatchAccountChange}
                />
            </CardSection>

            {/* The deferral-destination warning lives OUTSIDE the collapsed 401k
                section so a collapse can't hide it — a dangling id (destination
                account deleted) only survives while the section is collapsed, since
                expanding it mounts the Destination dropdown whose mount effect
                auto-heals an id that's no longer in its options. */}
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
                id={`${income.id}-section-benefits`}
                title="Benefits"
                summary={getBenefitsSummary(income)}
            >
                <BenefitsFields values={income} onUpdate={onFieldUpdate} idPrefix={income.id} />
            </CardSection>

            <CardSection
                id={`${income.id}-section-espp`}
                title="ESPP"
                summary={getESPPSummary(income)}
            >
                <ESPPFields
                    values={income}
                    onUpdate={onFieldUpdate}
                    esppAccounts={esppAccounts}
                    idPrefix={income.id}
                    showAccountLink
                    showMissingAccountWarning={false}
                />
            </CardSection>

            <CardSection
                id={`${income.id}-section-rsu`}
                title="RSU"
                summary={getRSUSummary(income)}
            >
                <RSUFields
                    values={income}
                    onUpdate={onFieldUpdate}
                    rsuAccounts={rsuAccounts}
                    idPrefix={income.id}
                    showAccountLink
                    showMissingAccountWarning={false}
                />
            </CardSection>

            <CardSection
                id={`${income.id}-section-pension`}
                title="Pension"
                summary={getPensionSummary(income.pensionSystem)}
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
                {income.pensionSystem !== 'NONE' && !hasMatchingPensionIncome && (
                    <AlertBanner severity="warning" size="sm" className="col-span-full mt-3">
                        <span className="font-medium">
                            No {income.pensionSystem} Pension income added.
                        </span>{' '}
                        Marking this job {income.pensionSystem} tracks your High-3
                        {income.pensionSystem === 'CSRS'
                            ? ' and exempts these wages from Social Security tax'
                            : ''}, but it does not model the pension benefit itself — add a{' '}
                        {income.pensionSystem} Pension income to project the payout.
                    </AlertBanner>
                )}
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
