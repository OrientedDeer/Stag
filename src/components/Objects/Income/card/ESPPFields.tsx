import { ReactElement } from 'react';
import { CurrencyInput } from '../../../Layout/InputFields/CurrencyInput';
import { DropdownInput } from '../../../Layout/InputFields/DropdownInput';
import { PercentageInput } from '../../../Layout/InputFields/PercentageInput';
import { ToggleInput } from '../../../Layout/InputFields/ToggleInput';
import { AlertBanner } from '../../../Layout/AlertBanner';
import { AddStockAccountLink } from './AddStockAccountLink';
import { esppGrantNeedsAccount } from '../incomeCardUtils';
import type { ESPPContributionType } from '../models';
import type { ESPPAccount } from '../../Accounts/models';

/**
 * Value-based ESPP field cluster shared by BOTH the income card and the Add
 * Income modal. Both surfaces drive it through the same value/onChange props
 * (the card from `income.esppX` / onFieldUpdate, the modal from `form.esppX` /
 * updateForm), so the two editors are guaranteed identical — same fields,
 * tooltips, labels, min/max, and warnings. Neither hand-copies this block.
 *
 * `idPrefix` namespaces the input ids so multiple instances on a page don't
 * collide. `onUpdate` takes the model/form field key as a plain string; each
 * surface adapts it to its typed dispatcher. `showAccountLink` renders the
 * cross-tab "Add ESPP account" deep link in the missing-account warning (card
 * only — inside the modal a <Link> would navigate away and abandon the
 * in-progress income, so the modal stays text-only; see #141).
 */
export interface ESPPFieldValues {
    esppContributionType: ESPPContributionType;
    esppContributionAmount: number;
    esppDiscountPercent: number;
    esppHasLookback: boolean;
    // string | null so the card's WorkIncome (esppAccountId: string | null) and the
    // modal's form (string) both satisfy it; the dropdown coerces null → '' below.
    esppAccountId: string | null;
}

interface ESPPFieldsProps {
    values: ESPPFieldValues;
    onUpdate: (field: keyof ESPPFieldValues, value: unknown) => void;
    esppAccounts: ESPPAccount[];
    idPrefix: string;
    showAccountLink?: boolean;
    // The income card suppresses these in-section banners (false) because it renders
    // a card-level copy outside the collapsible ESPP section (#141) — that card-level
    // copy is also where the ended-job suppression lives (a finished contribution
    // can't purchase, finding 4). The modal keeps them (default true). The account
    // DROPDOWN itself is unaffected.
    showMissingAccountWarning?: boolean;
}

export function ESPPFields({
    values,
    onUpdate,
    esppAccounts,
    idPrefix,
    showAccountLink = false,
    showMissingAccountWarning = true,
}: ESPPFieldsProps): ReactElement {
    return (
        <>
            <DropdownInput
                id={`${idPrefix}-espp-contribution-type`}
                label="ESPP Contribution"
                onChange={(val) => onUpdate('esppContributionType', val as ESPPContributionType)}
                options={[
                    { value: 'NONE', label: 'None' },
                    { value: 'PERCENTAGE', label: '% of Salary' },
                    { value: 'FIXED', label: 'Fixed Amount' },
                ]}
                value={values.esppContributionType}
                tooltip="Employee Stock Purchase Plan. Contribute up to 15% of salary to buy company stock at a discount."
            />
            {values.esppContributionType !== 'NONE' && (
                <>
                    {values.esppContributionType === 'PERCENTAGE' ? (
                        <PercentageInput
                            id={`${idPrefix}-espp-contribution-amount`}
                            label="Contribution"
                            value={values.esppContributionAmount}
                            onChange={(val) => onUpdate('esppContributionAmount', val)}
                            max={15}
                            tooltip="Percentage of salary to contribute to ESPP. Most plans cap at 10-15%."
                        />
                    ) : (
                        <CurrencyInput
                            id={`${idPrefix}-espp-contribution-amount`}
                            label="Contribution Amount"
                            value={values.esppContributionAmount}
                            onChange={(val) => onUpdate('esppContributionAmount', val)}
                            tooltip="Fixed amount per pay period to contribute to ESPP."
                        />
                    )}
                    <PercentageInput
                        id={`${idPrefix}-espp-discount`}
                        label="Discount"
                        value={values.esppDiscountPercent}
                        onChange={(val) => onUpdate('esppDiscountPercent', val)}
                        max={15}
                        tooltip="ESPP discount off stock price. Typical is 15%."
                    />
                    <ToggleInput
                        id={`${idPrefix}-espp-lookback`}
                        label="Lookback"
                        enabled={values.esppHasLookback}
                        setEnabled={(val) => onUpdate('esppHasLookback', val)}
                        tooltip="If enabled, discount applies to lower of grant or purchase date price, increasing effective discount."
                    />
                    {esppAccounts.length > 0 ? (
                        <DropdownInput
                            id={`${idPrefix}-espp-account`}
                            label="ESPP Account"
                            onChange={(val) => onUpdate('esppAccountId', val)}
                            options={esppAccounts.map((acc) => ({ value: acc.id, label: acc.name }))}
                            value={values.esppAccountId || ''}
                            tooltip="Account where ESPP shares will be deposited."
                        />
                    ) : (showMissingAccountWarning && esppGrantNeedsAccount(values, esppAccounts) && (
                        <AlertBanner severity="warning" size="sm" title="No ESPP Account" className="col-span-full">
                            Create an ESPP account to track your ESPP purchases.
                            {showAccountLink ? <> <AddStockAccountLink kind="ESPP" /></> : ' (Accounts tab.)'}
                        </AlertBanner>
                    ))}
                    {/* `esppGrantNeedsAccount` also catches a DANGLING id (linked account
                        deleted) — `!values.esppAccountId` alone missed it (#141 review). */}
                    {showMissingAccountWarning && esppAccounts.length > 0 && esppGrantNeedsAccount(values, esppAccounts) && (
                        <AlertBanner severity="warning" size="sm" title="ESPP Account Not Linked" className="col-span-full">
                            Select an ESPP account above to track your purchases.
                        </AlertBanner>
                    )}
                </>
            )}
        </>
    );
}
