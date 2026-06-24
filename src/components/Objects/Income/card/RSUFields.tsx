import { ReactElement } from 'react';
import { NumberInput } from '../../../Layout/InputFields/NumberInput';
import { DropdownInput } from '../../../Layout/InputFields/DropdownInput';
import { PercentageInput } from '../../../Layout/InputFields/PercentageInput';
import { AlertBanner } from '../../../Layout/AlertBanner';
import type { WorkIncome, RSUVestingSchedule, RSUVestFrequency } from '../models';
import type { AllIncomeKeys } from '../IncomeContext';
import type { RSUAccount } from '../../Accounts/models';
import { getRSUPriceValidationMessage, getRSUMilestoneStartWarning } from '../incomeCardUtils';

interface RSUFieldsProps {
    income: WorkIncome;
    onFieldUpdate: (field: AllIncomeKeys, value: unknown) => void;
    rsuAccounts: RSUAccount[];
}

export function RSUFields({ income, onFieldUpdate, rsuAccounts }: RSUFieldsProps): ReactElement {
    const priceValidationMessage = getRSUPriceValidationMessage(income, rsuAccounts);
    const milestoneStartWarning = getRSUMilestoneStartWarning(income);
    return (
        <>
            <DropdownInput
                id={`${income.id}-rsu-schedule`}
                label="Vesting Schedule"
                onChange={(val) => onFieldUpdate('rsuVestingSchedule', val as RSUVestingSchedule)}
                options={[
                    { value: 'NONE', label: 'None' },
                    { value: 'cliff-1yr', label: '1-Year Cliff' },
                    { value: 'graded-3yr', label: 'Graded (3 Years)' },
                    { value: 'graded-4yr', label: 'Graded (4 Years)' },
                ]}
                value={income.rsuVestingSchedule}
                tooltip="Restricted Stock Units. A cliff vests all at once at the 1-year mark; graded schedules vest evenly over the period."
            />
            {income.rsuVestingSchedule !== 'NONE' && (
                <>
                    <NumberInput
                        id={`${income.id}-rsu-grant-shares`}
                        label="Grant Shares"
                        value={income.rsuGrantShares}
                        onChange={(val) => onFieldUpdate('rsuGrantShares', val)}
                        min={0}
                        tooltip="Total number of shares in this grant. They vest over the schedule above."
                    />
                    {income.rsuVestingSchedule !== 'cliff-1yr' && (
                        <DropdownInput
                            id={`${income.id}-rsu-frequency`}
                            label="Vest Frequency"
                            onChange={(val) => onFieldUpdate('rsuVestFrequency', val as RSUVestFrequency)}
                            options={[
                                { value: 'quarterly', label: 'Quarterly' },
                                { value: 'semi-annual', label: 'Semi-Annual' },
                                { value: 'annual', label: 'Annual' },
                            ]}
                            value={income.rsuVestFrequency}
                            tooltip="How often tranches vest within the graded period (a 1-year cliff vests all at once)."
                        />
                    )}
                    <PercentageInput
                        id={`${income.id}-rsu-growth`}
                        label="Expected Stock Growth"
                        value={income.rsuExpectedStockGrowth}
                        onChange={(val) => onFieldUpdate('rsuExpectedStockGrowth', val)}
                        max={30}
                        tooltip="Expected annual stock appreciation. Projects the fair-market value (ordinary income per share) at each vest."
                    />
                    <PercentageInput
                        id={`${income.id}-rsu-withholding`}
                        label="Withholding Rate"
                        value={income.rsuWithholdingRate}
                        onChange={(val) => onFieldUpdate('rsuWithholdingRate', val)}
                        max={100}
                        tooltip="Tax withheld at vest (supplemental wages). Default 37%. Shares are sold to cover; you net the remainder. Lowering this may produce a tax shortfall."
                    />
                    {rsuAccounts.length > 0 ? (
                        <DropdownInput
                            id={`${income.id}-rsu-account`}
                            label="RSU Account"
                            onChange={(val) => onFieldUpdate('rsuAccountId', val)}
                            options={rsuAccounts.map((acc) => ({ value: acc.id, label: acc.name }))}
                            value={income.rsuAccountId || ''}
                            tooltip="Account where vested RSU shares will be deposited."
                        />
                    ) : (
                        <AlertBanner severity="warning" size="sm" title="No RSU Account" className="col-span-full">
                            Create an RSU account in the Accounts tab to track your vested shares.
                        </AlertBanner>
                    )}
                    {rsuAccounts.length > 0 && !income.rsuAccountId && (
                        <AlertBanner severity="warning" size="sm" title="RSU Account Not Linked" className="col-span-full">
                            Select an RSU account above to track your vesting tranches.
                        </AlertBanner>
                    )}
                    {priceValidationMessage && (
                        <AlertBanner severity="error" size="sm" title="Current Share Price Required" className="col-span-full">
                            {priceValidationMessage}
                        </AlertBanner>
                    )}
                    {milestoneStartWarning && (
                        <AlertBanner severity="warning" size="sm" title="RSUs Need a Fixed Start Date" className="col-span-full">
                            {milestoneStartWarning}
                        </AlertBanner>
                    )}
                </>
            )}
        </>
    );
}
