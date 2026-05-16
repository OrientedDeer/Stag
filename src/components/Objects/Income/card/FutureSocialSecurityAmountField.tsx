import { ReactElement } from 'react';
import type { FutureSocialSecurityIncome } from '../models';

export function FutureSocialSecurityAmountField({
    income,
}: {
    income: FutureSocialSecurityIncome;
}): ReactElement {
    return (
        <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
                Monthly Benefit (Auto-Calculated)
            </label>
            <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300">
                {income.calculatedPIA > 0
                    ? `$${Math.round(income.calculatedPIA).toLocaleString()}/month`
                    : 'Will be calculated at claiming age'}
            </div>
        </div>
    );
}
