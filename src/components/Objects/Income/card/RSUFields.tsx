import { ReactElement } from 'react';
import { NumberInput } from '../../../Layout/InputFields/NumberInput';
import { DropdownInput } from '../../../Layout/InputFields/DropdownInput';
import { PercentageInput } from '../../../Layout/InputFields/PercentageInput';
import { AlertBanner } from '../../../Layout/AlertBanner';
import { AddStockAccountLink } from './AddStockAccountLink';
import type { RSUVestingSchedule, RSUVestFrequency } from '../models';
import type { RSUAccount } from '../../Accounts/models';
import { getRSUPriceValidationMessageFor, rsuGrantNeedsAccount } from '../incomeCardUtils';

/**
 * Value-based RSU field cluster shared by BOTH the income card and the Add
 * Income modal. Both surfaces drive it through the same value/onChange props
 * (the card from `income.rsuX` / onFieldUpdate, the modal from `form.rsuX` /
 * updateForm), so the two editors are guaranteed identical — same fields,
 * tooltips, labels, min/max, and the price-validation banner. Neither
 * hand-copies this block.
 *
 * `idPrefix` namespaces the input ids; `onUpdate` takes the model/form field key
 * as a plain string and each surface adapts it to its typed dispatcher.
 * `startDate` + `rsuAccountId` feed the shared price validation. `showAccountLink`
 * renders the cross-tab "Add RSU account" deep link in the missing-account warning
 * (card only — the modal stays text-only; a <Link> would abandon the in-progress
 * income; see #141).
 */
export interface RSUFieldValues {
    rsuVestingSchedule: RSUVestingSchedule;
    rsuGrantShares: number;
    rsuVestFrequency: RSUVestFrequency;
    rsuExpectedStockGrowth: number;
    rsuWithholdingRate: number;
    // string | null so the card's WorkIncome (string | null) and the modal's form
    // (string) both satisfy it; the dropdown coerces null → '' below.
    rsuAccountId: string | null;
    // Optional so the card's WorkIncome (startDate?: Date) satisfies it directly.
    startDate?: Date;
}

interface RSUFieldsProps {
    values: RSUFieldValues;
    onUpdate: (field: keyof RSUFieldValues, value: unknown) => void;
    rsuAccounts: RSUAccount[];
    idPrefix: string;
    showAccountLink?: boolean;
    // The card surfaces the "Current Share Price Required" banner; the Add-Income
    // modal does not (the price is account-side and the pre-#140 modal never showed
    // it — don't alarm/block the user mid-add). Defaults on for the card. #140.
    showPriceValidation?: boolean;
    // The "no linked RSU account" warnings. The income CARD suppresses them here
    // (false) because it renders a more prominent CARD-LEVEL copy outside the
    // collapsible RSU section (#141). The modal keeps them (default true) — it has
    // no collapse to hide them. The account DROPDOWN itself is unaffected.
    showMissingAccountWarning?: boolean;
    // True when the parent job has definitively ENDED (fixed past end date). An
    // ended grant can no longer vest, so the missing-account warning is pure noise
    // — suppress it (finding 4). Defaults false: the Add-Income modal never passes
    // it, so a brand-new income keeps warning exactly as today.
    incomeEnded?: boolean;
}

export function RSUFields({
    values,
    onUpdate,
    rsuAccounts,
    idPrefix,
    showAccountLink = false,
    showPriceValidation = true,
    showMissingAccountWarning = true,
    incomeEnded = false,
}: RSUFieldsProps): ReactElement {
    const priceValidationMessage = showPriceValidation
        ? getRSUPriceValidationMessageFor(values, rsuAccounts)
        : null;
    const showAccountWarning = showMissingAccountWarning && !incomeEnded;
    return (
        <>
            <DropdownInput
                id={`${idPrefix}-rsu-schedule`}
                label="Vesting Schedule"
                onChange={(val) => onUpdate('rsuVestingSchedule', val as RSUVestingSchedule)}
                options={[
                    { value: 'NONE', label: 'None' },
                    { value: 'cliff-1yr', label: '1-Year Cliff' },
                    { value: 'graded-3yr', label: 'Graded (3 Years)' },
                    { value: 'graded-4yr', label: 'Graded (4 Years)' },
                ]}
                value={values.rsuVestingSchedule}
                tooltip="Restricted Stock Units. A cliff vests all at once at the 1-year mark; graded schedules vest evenly over the period."
            />
            {values.rsuVestingSchedule !== 'NONE' && (
                <>
                    <NumberInput
                        id={`${idPrefix}-rsu-grant-shares`}
                        label="Grant Shares"
                        value={values.rsuGrantShares}
                        onChange={(val) => onUpdate('rsuGrantShares', val)}
                        min={0}
                        tooltip="Total number of shares in this grant. They vest over the schedule above."
                    />
                    {values.rsuVestingSchedule !== 'cliff-1yr' && (
                        <DropdownInput
                            id={`${idPrefix}-rsu-frequency`}
                            label="Vest Frequency"
                            onChange={(val) => onUpdate('rsuVestFrequency', val as RSUVestFrequency)}
                            options={[
                                { value: 'quarterly', label: 'Quarterly' },
                                { value: 'semi-annual', label: 'Semi-Annual' },
                                { value: 'annual', label: 'Annual' },
                            ]}
                            value={values.rsuVestFrequency}
                            tooltip="How often tranches vest within the graded period (a 1-year cliff vests all at once)."
                        />
                    )}
                    <PercentageInput
                        id={`${idPrefix}-rsu-growth`}
                        label="Expected Stock Growth"
                        value={values.rsuExpectedStockGrowth}
                        onChange={(val) => onUpdate('rsuExpectedStockGrowth', val)}
                        max={30}
                        tooltip="Expected annual stock appreciation. Projects the fair-market value (ordinary income per share) at each vest."
                    />
                    <PercentageInput
                        id={`${idPrefix}-rsu-withholding`}
                        label="Withholding Rate"
                        value={values.rsuWithholdingRate}
                        onChange={(val) => onUpdate('rsuWithholdingRate', val)}
                        max={100}
                        tooltip="Tax withheld at vest (supplemental wages). Default 37%. Shares are sold to cover; you net the remainder. Lowering this may produce a tax shortfall."
                    />
                    {rsuAccounts.length > 0 ? (
                        <DropdownInput
                            id={`${idPrefix}-rsu-account`}
                            label="RSU Account"
                            onChange={(val) => onUpdate('rsuAccountId', val)}
                            options={rsuAccounts.map((acc) => ({ value: acc.id, label: acc.name }))}
                            value={values.rsuAccountId || ''}
                            tooltip="Account where vested RSU shares will be deposited."
                        />
                    ) : (showAccountWarning && rsuGrantNeedsAccount(values, rsuAccounts) && (
                        <AlertBanner severity="warning" size="sm" title="No RSU Account" className="col-span-full">
                            Create an RSU account to track your vested shares.
                            {showAccountLink ? <> <AddStockAccountLink kind="RSU" /></> : ' (Accounts tab.)'}
                        </AlertBanner>
                    ))}
                    {/* `rsuGrantNeedsAccount` also catches a DANGLING id (linked account
                        deleted) — `!values.rsuAccountId` alone missed it (#141 review). */}
                    {showAccountWarning && rsuAccounts.length > 0 && rsuGrantNeedsAccount(values, rsuAccounts) && (
                        <AlertBanner severity="warning" size="sm" title="RSU Account Not Linked" className="col-span-full">
                            Select an RSU account above to track your vesting tranches.
                        </AlertBanner>
                    )}
                    {priceValidationMessage && (
                        <AlertBanner severity="error" size="sm" title="Current Share Price Required" className="col-span-full">
                            {priceValidationMessage}
                        </AlertBanner>
                    )}
                </>
            )}
        </>
    );
}
