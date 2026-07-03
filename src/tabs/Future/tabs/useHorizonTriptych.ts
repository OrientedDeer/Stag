import { useMemo } from 'react';
import { computeHorizonTriptych, HorizonScore } from '../../../services/MonteCarloEngine';
import { applyChosenWithdrawalOrder } from '../../../services/simulation/EngineDirectConversionSearch';
import { AnyAccount } from '../../../components/Objects/Accounts/models';
import { AnyIncome } from '../../../components/Objects/Income/models';
import { AnyExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

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
 * Currently consumed by MonteCarloTab; FutureTab can adopt the same hook later
 * if the triptych should also appear next to the deterministic projection.
 *
 * Pass `enabled: false` while the block is hidden (e.g. other sub-tab active)
 * to skip the sims entirely.
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
