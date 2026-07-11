import { memo } from 'react';
import { type AnyAccount } from '../../../components/Objects/Accounts/models';
import { type AnyIncome } from '../../../components/Objects/Income/models';
import { type AnyExpense } from '../../../components/Objects/Expense/models';
import { type AssumptionsState } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { formatCompactCurrency } from '../tabs/FutureUtils';
import { useHorizonTriptych } from '../tabs/useHorizonTriptych';

interface HorizonTriptychCardProps {
    accounts: AnyAccount[];
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    assumptions: AssumptionsState;
    taxState: TaxState;
    /** Year 0's chosenWithdrawalOrder, when the joint optimizer picked one. */
    chosenWithdrawalOrder?: { accountId: string; name: string }[];
    forceExact: boolean;
}

/**
 * Horizon triptych (fp-review F13 / #160, relocated for #162): three
 * DETERMINISTIC re-scores of the current plan ended at ages 75 / 85 / 95.
 * These are expected-return-path sims, not Monte Carlo — the owner flagged
 * that the card read as out of place on the MC tab, so it lives here next to
 * the deterministic After-Tax Wealth comparison instead.
 *
 * The host (WithdrawalTab) is route-mounted, so simply being rendered means
 * the tab is visible — `enabled: true` keeps the hook's gate semantics.
 */
function HorizonTriptychCardInner({
    accounts,
    incomes,
    expenses,
    assumptions,
    taxState,
    chosenWithdrawalOrder,
    forceExact,
}: HorizonTriptychCardProps) {
    const triptych = useHorizonTriptych(
        true,
        accounts, incomes, expenses, assumptions, taxState,
        chosenWithdrawalOrder,
    );

    if (!triptych || !triptych.some(h => h.afterTaxNetWorth !== null)) return null;

    return (
        <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default mt-6">
            <h4 className="text-content-default font-medium mb-1">If the Plan Ends at 75 / 85 / 95</h4>
            <p className="text-content-muted text-xs mb-3">
                Deterministic re-scores of your current plan ended at each age on the
                expected-return path. Values are after-tax terminal net worth — end-of-plan
                net worth minus the tax still owed to access every account, the same
                valuation as the After-Tax Wealth comparison.
            </p>
            <div className="grid grid-cols-3 gap-4">
                {triptych.map(h => (
                    <div key={h.age}>
                        <div className="text-content-muted text-xs uppercase tracking-wider mb-1">
                            Ends at {h.age}
                        </div>
                        <div className="text-lg lg:text-xl font-bold text-content-default truncate">
                            {h.afterTaxNetWorth !== null
                                ? formatCompactCurrency(h.afterTaxNetWorth, { forceExact })
                                : '—'}
                        </div>
                        {h.afterTaxNetWorth === null && (
                            <div className="text-content-muted text-xs mt-1">Already past this age</div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export const HorizonTriptychCard = memo(HorizonTriptychCardInner);
