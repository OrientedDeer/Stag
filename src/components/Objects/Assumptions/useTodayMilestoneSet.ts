import { useContext, useMemo } from 'react';
import { AssumptionsContext, getBirthYear } from './AssumptionsContext';
import { AccountContext } from '../Accounts/AccountContext';
import { ExpenseContext } from '../Expense/ExpenseContext';
import { IncomeContext } from '../Income/IncomeContext';
import { TaxContext } from '../Taxes/TaxContext';
import { SimulationContext } from './SimulationContext';
import {
    evaluateAllMilestones,
    buildMilestoneReachYears,
    incomeHasMilestoneGate,
    MilestoneContext,
} from '../../../services/simulation/MilestoneEvaluator';

// Stable references returned on the common paths so callers' downstream memos
// (e.g. PriorityTab's tax/deduction calcs that depend on the active-income set, and
// IncomeTab's icicle data) don't invalidate on unrelated edits or re-simulations.
const EMPTY_MILESTONE_SET: Set<string> = new Set<string>();
const EMPTY_REACH_YEARS: Map<string, number> = new Map<string, number>();

/**
 * The set of milestones already reached AS OF TODAY — the single shared source the
 * Income tab and the Priority/Allocation tab both use to decide which milestone-
 * gated income counts right now. Extracting it here keeps the two surfaces from
 * re-deriving (and silently diverging on) "what's active today" (#145/#150/#152).
 *
 * Why it can read the SimulationContext: a from-scratch evaluation against a single
 * today-context has no milestone history, so RELATIVE conditions — MILESTONE_PLUS
 * ("N years after milestone X") — can't resolve and would be treated as never
 * reached, wrongly hiding genuinely-active income. The engine already resolved every
 * milestone year-by-year, so we lift the per-milestone reach years out of the
 * projected timeline and feed them back in as `milestoneReachYears`.
 *
 * Two deliberate scoping choices:
 *  - The reach-year map (and therefore the dependency on the cached `simulation`) is
 *    only built when a MILESTONE_PLUS condition actually exists. Otherwise this stays
 *    a pure function of milestones/accounts/expenses/filing-status/year — the same
 *    inputs the pre-shared per-tab code used — so referential stability is preserved
 *    and the tax/icicle memos don't churn on every re-projection for the common case.
 *  - Those reach years come from the LAST COMPLETED projection (the cached sim), so a
 *    relative-milestone income's today state reflects the most recent engine run and
 *    updates when the next projection lands — the same lag every sim-derived view has.
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

    const hasMilestoneIncome = useMemo(() => incomeHasMilestoneGate(incomes), [incomes]);

    // Only relative (MILESTONE_PLUS) milestones consume reach years; gate the sim
    // read on one existing so the common case never depends on `simulation`.
    const hasRelativeMilestone = useMemo(
        () => (state.milestones ?? []).some(m => m.conditions.some(c => c.valueType === 'MILESTONE_PLUS')),
        [state.milestones],
    );

    const milestoneReachYears = useMemo(
        () => (hasRelativeMilestone ? buildMilestoneReachYears(simulation) : EMPTY_REACH_YEARS),
        [hasRelativeMilestone, simulation],
    );

    // Computed at render (cheap primitive) and kept in the deps so the memo
    // re-evaluates across a calendar-year boundary rather than holding a stale year.
    const year = new Date().getFullYear();

    return useMemo(() => {
        const milestones = state.milestones;
        if (!hasMilestoneIncome || !milestones || milestones.length === 0) return EMPTY_MILESTONE_SET;

        const ctx: MilestoneContext = {
            accounts,
            expenses,
            year,
            age: year - getBirthYear(milestones),
            filingStatus: taxState.filingStatus,
            milestoneReachYears,
        };
        return new Set(evaluateAllMilestones(milestones, new Set<string>(), ctx).activeMilestones);
        // `milestoneReachYears` (not `simulation`) is the dep: a stable empty map when
        // no relative milestone exists, so this doesn't churn on re-sims in that case.
    }, [hasMilestoneIncome, state.milestones, accounts, expenses, taxState.filingStatus, milestoneReachYears, year]);
}
