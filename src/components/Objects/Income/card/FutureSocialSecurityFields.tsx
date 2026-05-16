import { ReactElement } from 'react';
import { NumberInput } from '../../../Layout/InputFields/NumberInput';
import { formatEarningsSummary } from '../../../../services/SSAImportService';
import type { EarningsRecord } from '../../../../services/SocialSecurityCalculator';
import type { FutureSocialSecurityIncome } from '../models';
import type { AllIncomeKeys } from '../IncomeContext';

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
                    <label className="block text-sm font-medium text-gray-400 mb-1">
                        Calculation Details
                    </label>
                    <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg px-3 py-2 text-xs text-gray-300">
                        <div>- AIME calculation based on 35 highest earning years</div>
                        <div>- Calculated in year: {income.calculationYear || 'Pending'}</div>
                        <div>- Benefits auto-adjusted for COLA each year</div>
                    </div>
                </div>
            )}
            <div className="col-span-full mt-2 pt-4 border-t border-gray-700">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                    SSA Earnings History
                </label>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                    <button
                        onClick={() => ssaFileInputRef.current?.click()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        Import SSA Data
                    </button>
                    <input
                        type="file"
                        ref={ssaFileInputRef}
                        onChange={onSSAFileChange}
                        accept=".xml"
                        className="hidden"
                    />
                    {priorEarnings && priorEarnings.length > 0 ? (
                        <div className="flex items-center gap-2">
                            <span className="text-green-400 text-sm">
                                {formatEarningsSummary(priorEarnings)}
                            </span>
                            <button
                                onClick={onClearPriorEarnings}
                                className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                            >
                                Clear
                            </button>
                        </div>
                    ) : (
                        <span className="text-gray-400 text-xs">
                            Download your statement from ssa.gov/myaccount
                        </span>
                    )}
                </div>
            </div>
        </>
    );
}
