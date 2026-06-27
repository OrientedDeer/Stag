import { useContext, useMemo } from 'react';
import { AssumptionsContext, getBirthYear } from './AssumptionsContext';
import { AccountContext } from '../Accounts/AccountContext';
import { ExpenseContext } from '../Expense/ExpenseContext';
import { IncomeContext } from '../Income/IncomeContext';
import { TaxContext } from '../Taxes/TaxContext';
import { SimulationContext } from './SimulationContext';
import { evaluateAllMilestones, MilestoneContext } from '../../../services/simulation/MilestoneEvaluator';

// A stable empty-set reference returned in the common "no milestone-gated income"
// case so callers' downstream memos (e.g. PriorityTab's tax/deduction calcs that
// depend on the active-income set) don't invalidate on unrelated edits.
const EMPTY_MILESTONE_SET: Set<string> = new Set<string>();

/**
 * The set of milestones already reached AS OF TODAY — the single shared source
 * the Income tab and the Priority/Allocation tab both use to decide which
 * milestone-gated income counts right now. Extracting it here keeps the two
 * surfaces from re-deriving (and silently diverging on) "what's active today"
 * (#145/#150/#152).
 *
 * Why it reads the SimulationContext: a from-scratch evaluation against a single
 * today-context has no milestone history, so RELATIVE conditions — MILESTONE_PLUS
 * ("N years after milestone X") — can't resolve and would be treated as never
 * reached, wrongly hiding income that is genuinely active. The engine already
 * resolved every milestone year-by-year, so we lift the exact per-milestone
 * `yearReached` out of the projected timeline's `milestoneEvents` and feed it back
 * in as `milestoneReachYears`; calculateTargetValue then resolves MILESTONE_PLUS
 * correctly. When the sim hasn't run yet the map is empty and the result degrades
 * to the (milestone-history-free) evaluation — no worse than before.
 *
 * Short-circuits to a stable empty set when no income references any milestone.
 */
export function useTodayMilestoneSet(): Set<string> {
    const { state } = useContext(AssumptionsContext);
    const { accounts } = useContext(AccountContext);
    const { expenses } = useContext(ExpenseContext);
    const { incomes } = useContext(IncomeContext);
    const { state: taxState } = useContext(TaxContext);
    const { simulation } = useContext(SimulationContext);

    const hasMilestoneIncome = useMemo(
        () => incomes.some(inc => inc.startMilestoneId || inc.endMilestoneId),
        [incomes],
    );

    // Computed at render (cheap primitive) and kept in the deps so the memo
    // re-evaluates across a calendar-year boundary rather than holding a stale year.
    const year = new Date().getFullYear();

    return useMemo(() => {
        const milestones = state.milestones;
        if (!hasMilestoneIncome || !milestones || milestones.length === 0) return EMPTY_MILESTONE_SET;

        // Exact per-milestone reach year from the engine's projected timeline so
        // MILESTONE_PLUS conditions resolve (see the docstring). First occurrence wins.
        const milestoneReachYears = new Map<string, number>();
        for (const simYear of simulation) {
            for (const ev of simYear.milestoneEvents ?? []) {
                if (!milestoneReachYears.has(ev.milestoneId)) {
                    milestoneReachYears.set(ev.milestoneId, ev.yearReached);
                }
            }
        }

        const ctx: MilestoneContext = {
            accounts,
            expenses,
            year,
            age: year - getBirthYear(milestones),
            filingStatus: taxState.filingStatus,
            milestoneReachYears,
        };
        return new Set(evaluateAllMilestones(milestones, new Set<string>(), ctx).activeMilestones);
    }, [hasMilestoneIncome, state.milestones, accounts, expenses, taxState.filingStatus, simulation, year]);
}
