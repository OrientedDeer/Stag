import { type ReactElement } from 'react';
import { NumberInput } from '../../../Layout/InputFields/NumberInput';
import { formatEarningsSummary } from '../../../../services/SSAImportService';
import type { EarningsRecord } from '../../../../services/SocialSecurityCalculator';
import type { FutureSocialSecurityIncome } from '../models';
import type { AllIncomeKeys } from '../IncomeContext';
import { Button } from "../../../Layout/Primitives";

interface FutureSocialSecurityFieldsProps {
    income: FutureSocialSecurityIncome;
    onFieldUpdate: (field: AllIncomeKeys, value: unknown) => void;
    onClaimingAgeBlur: () => void;
    ssaFileInputRef: React.RefObject<HTMLInputElement | null>;
    onSSAFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    priorEarnings: EarningsRecord[] | undefined;
    onClearPriorEarnings: () => void;
}

export function FutureSocialSecurityFields({
    income,
    onFieldUpdate,
    onClaimingAgeBlur,
    ssaFileInputRef,
    onSSAFileChange,
    priorEarnings,
    onClearPriorEarnings,
}: FutureSocialSecurityFieldsProps): ReactElement {
    return (
        <>
            <NumberInput
                id={`${income.id}-claiming-age`}
                label="Claiming Age (62-70)"
                value={income.claimingAge}
                onChange={(val) => onFieldUpdate('claimingAge', val)}
                onBlur={onClaimingAgeBlur}
            />
            {income.calculatedPIA > 0 && (
                <div className="col-span-2">
                    <label className="block text-sm font-medium text-content-muted mb-1">
                        Calculation Details
                    </label>
                    <div className="bg-info-tint/20 border border-info-strong/50 rounded-lg px-3 py-2 text-xs text-content-default">
                        <div>- AIME calculation based on 35 highest earning years</div>
                        <div>- Calculated in year: {income.calculationYear || 'Pending'}</div>
                        <div>- Benefits auto-adjusted for COLA each year</div>
                    </div>
                </div>
            )}
            <div className="col-span-full mt-2 pt-4 border-t border-border-default">
                <label className="block text-sm font-medium text-content-muted mb-2">
                    SSA Earnings History
                </label>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                    <Button
                        onClick={() => ssaFileInputRef.current?.click()}
                        variant="primary"
                    >
                        Import SSA Data
                    </Button>
                    <input
                        type="file"
                        ref={ssaFileInputRef}
                        onChange={onSSAFileChange}
                        accept=".xml"
                        className="hidden"
                    />
                    {priorEarnings && priorEarnings.length > 0 ? (
                        <div className="flex items-center gap-2">
                            <span className="text-positive text-sm">
                                {formatEarningsSummary(priorEarnings)}
                            </span>
                            <button
                                onClick={onClearPriorEarnings}
                                className="text-xs text-content-muted hover:text-negative transition-colors"
                            >
                                Clear
                            </button>
                        </div>
                    ) : (
                        <span className="text-content-muted text-xs">
                            Download your statement from ssa.gov/myaccount
                        </span>
                    )}
                </div>
            </div>
        </>
    );
}
