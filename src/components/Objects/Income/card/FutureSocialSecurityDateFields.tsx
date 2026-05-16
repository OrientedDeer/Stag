import { ReactElement } from 'react';
import { formatDateForInput } from '../../../../utils/formatters';
import type { FutureSocialSecurityIncome } from '../models';

export function FutureSocialSecurityDateFields({
    income,
}: {
    income: FutureSocialSecurityIncome;
}): ReactElement {
    return (
        <>
            <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                    Start Date (Auto-Calculated)
                </label>
                <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 text-sm">
                    {income.startDate
                        ? formatDateForInput(income.startDate)
                        : `At claiming age ${income.claimingAge}`}
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                    End Date (Auto-Calculated)
                </label>
                <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 text-sm">
                    {income.end_date ? formatDateForInput(income.end_date) : 'At life expectancy'}
                </div>
            </div>
        </>
    );
}
