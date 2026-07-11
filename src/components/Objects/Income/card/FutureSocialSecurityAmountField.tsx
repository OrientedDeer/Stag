import { type ReactElement } from 'react';
import type { FutureSocialSecurityIncome } from '../models';

export function FutureSocialSecurityAmountField({
    income,
}: {
    income: FutureSocialSecurityIncome;
}): ReactElement {
    return (
        <div>
            <label className="block text-sm font-medium text-content-muted mb-1">
                Monthly Benefit (Auto-Calculated)
            </label>
            <div className="bg-surface-overlay border border-border-default rounded-lg px-3 py-2 text-content-default">
                {income.calculatedPIA > 0
                    ? `$${Math.round(income.calculatedPIA).toLocaleString()}/month`
                    : 'Will be calculated at claiming age'}
            </div>
        </div>
    );
}
