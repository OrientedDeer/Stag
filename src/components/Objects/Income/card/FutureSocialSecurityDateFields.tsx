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
                <label className="block text-sm font-medium text-content-muted mb-1">
                    Start Date (Auto-Calculated)
                </label>
                <div className="bg-surface-overlay border border-border-default rounded-lg px-3 py-2 text-content-default text-sm">
                    {income.startDate
                        ? formatDateForInput(income.startDate)
                        : `At claiming age ${income.claimingAge}`}
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-content-muted mb-1">
                    End Date (Auto-Calculated)
                </label>
                <div className="bg-surface-overlay border border-border-default rounded-lg px-3 py-2 text-content-default text-sm">
                    {income.end_date ? formatDateForInput(income.end_date) : 'At life expectancy'}
                </div>
            </div>
        </>
    );
}
