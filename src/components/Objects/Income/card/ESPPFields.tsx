import { ReactElement } from 'react';
import { CurrencyInput } from '../../../Layout/InputFields/CurrencyInput';
import { DropdownInput } from '../../../Layout/InputFields/DropdownInput';
import { PercentageInput } from '../../../Layout/InputFields/PercentageInput';
import { ToggleInput } from '../../../Layout/InputFields/ToggleInput';
import type { WorkIncome, ESPPContributionType } from '../models';
import type { AllIncomeKeys } from '../IncomeContext';
import type { ESPPAccount } from '../../Accounts/models';

interface ESPPFieldsProps {
    income: WorkIncome;
    onFieldUpdate: (field: AllIncomeKeys, value: unknown) => void;
    esppAccounts: ESPPAccount[];
}

export function ESPPFields({ income, onFieldUpdate, esppAccounts }: ESPPFieldsProps): ReactElement {
    return (
        <>
            <DropdownInput
                id={`${income.id}-espp-contribution-type`}
                label="ESPP Contribution"
                onChange={(val) => onFieldUpdate('esppContributionType', val as ESPPContributionType)}
                options={[
                    { value: 'NONE', label: 'None' },
                    { value: 'PERCENTAGE', label: '% of Salary' },
                    { value: 'FIXED', label: 'Fixed Amount' },
                ]}
                value={income.esppContributionType}
                tooltip="Employee Stock Purchase Plan. Contribute up to 15% of salary to buy company stock at a discount."
            />
            {income.esppContributionType !== 'NONE' && (
                <>
                    {income.esppContributionType === 'PERCENTAGE' ? (
                        <PercentageInput
                            id={`${income.id}-espp-contribution-amount`}
                            label="Contribution"
                            value={income.esppContributionAmount}
                            onChange={(val) => onFieldUpdate('esppContributionAmount', val)}
                            max={15}
                            tooltip="Percentage of salary to contribute to ESPP. Most plans cap at 10-15%."
                        />
                    ) : (
                        <CurrencyInput
                            id={`${income.id}-espp-contribution-amount`}
                            label="Contribution Amount"
                            value={income.esppContributionAmount}
                            onChange={(val) => onFieldUpdate('esppContributionAmount', val)}
                            tooltip="Fixed amount per pay period to contribute to ESPP."
                        />
                    )}
                    <PercentageInput
                        id={`${income.id}-espp-discount`}
                        label="Discount"
                        value={income.esppDiscountPercent}
                        onChange={(val) => onFieldUpdate('esppDiscountPercent', val)}
                        max={15}
                        tooltip="ESPP discount off stock price. Typical is 15%."
                    />
                    <ToggleInput
                        id={`${income.id}-espp-lookback`}
                        label="Lookback"
                        enabled={income.esppHasLookback}
                        setEnabled={(val) => onFieldUpdate('esppHasLookback', val)}
                        tooltip="If enabled, discount applies to lower of grant or purchase date price, increasing effective discount."
                    />
                    {esppAccounts.length > 0 ? (
                        <DropdownInput
                            id={`${income.id}-espp-account`}
                            label="ESPP Account"
                            onChange={(val) => onFieldUpdate('esppAccountId', val)}
                            options={esppAccounts.map((acc) => ({ value: acc.id, label: acc.name }))}
                            value={income.esppAccountId || ''}
                            tooltip="Account where ESPP shares will be deposited."
                        />
                    ) : (
                        <div className="col-span-full bg-warning-tint/30 border border-warning-strong/50 rounded-lg p-3 text-xs text-warning-bright">
                            <span className="font-semibold">No ESPP Account</span>
                            <p className="text-warning/80 mt-1">
                                Create an ESPP account in the Accounts tab to track your ESPP
                                purchases.
                            </p>
                        </div>
                    )}
                    {esppAccounts.length > 0 && !income.esppAccountId && (
                        <div className="col-span-full bg-warning-tint/30 border border-warning-strong/50 rounded-lg p-3 text-xs text-warning-bright">
                            <span className="font-semibold">ESPP Account Not Linked</span>
                            <p className="text-warning/80 mt-1">
                                Select an ESPP account above to track your purchases.
                            </p>
                        </div>
                    )}
                </>
            )}
        </>
    );
}
