import { useMemo } from 'react';
import { computeHorizonTriptych, type HorizonScore } from '../../../services/MonteCarloEngine';
import { applyChosenWithdrawalOrder } from '../../../services/simulation/EngineDirectConversionSearch';
import { type AnyAccount } from '../../../components/Objects/Accounts/models';
import { type AnyIncome } from '../../../components/Objects/Income/models';
import { type AnyExpense } from '../../../components/Objects/Expense/models';
import { type AssumptionsState } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';

/**
 * Horizon triptych (fp-review F13 / #160): three deterministic re-scores of
 * the current plan ended at ages 75 / 85 / 95, memoized on the deterministic
 * inputs. These are main-thread `runSimulation` calls (~tens of ms each) that
 * need NO Monte Carlo results — they are deliberately computed outside the MC
 * run and must never be wired into the MC worker.
 *
 * `chosenWithdrawalOrder` (year 0's `chosenWithdrawalOrder`, when the joint
 * optimizer picked one) re-pins the deterministic plan's withdrawal order the
 * same way the MC run does, so all three columns re-score the SAME plan the
 * user is looking at.
 *
 * Currently consumed by the Withdrawal tab's HorizonTriptychCard (#162 moved
 * it off the Monte Carlo tab — these are deterministic re-scores, not MC).
 *
 * Pass `enabled: false` while the block is hidden to skip the sims entirely;
 * a route-mounted host that unmounts when not visible can pass `true`.
 */
export function useHorizonTriptych(
    enabled: boolean,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    chosenWithdrawalOrder?: { accountId: string; name: string }[],
): HorizonScore[] | null {
    return useMemo(() => {
        if (!enabled) return null;
        const effAssumptions = applyChosenWithdrawalOrder(
            assumptions,
            chosenWithdrawalOrder,
            new Set(accounts.map(a => a.id)),
        );
        return computeHorizonTriptych(accounts, incomes, expenses, effAssumptions, taxState);
    }, [enabled, accounts, incomes, expenses, assumptions, taxState, chosenWithdrawalOrder]);
}
