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
    isIncomeMilestoneGateUnresolved,
    MilestoneContext,
} from '../../../services/simulation/MilestoneEvaluator';
import { AnyIncome } from '../Income/models';
import { CustomMilestone } from '../../../services/simulation/types';

/** Per-income predicate: is THIS income's start/end milestone gate unresolvable right
 *  now (sim-dependent milestone + no projection cached)? See
 *  `isIncomeMilestoneGateUnresolved`. */
export type MilestoneGateUnresolvedFn = (inc: AnyIncome) => boolean;

// Stable references returned on the common paths so callers' downstream memos
// (e.g. PriorityTab's tax/deduction calcs that depend on the active-income set, and
// IncomeTab's icicle data) don't invalidate on unrelated edits or re-simulations.
const EMPTY_MILESTONE_SET: Set<string> = new Set<string>();
const EMPTY_REACH_YEARS: Map<string, number> = new Map<string, number>();
// Stable "nothing is unresolvable" predicate so the common (no-gating / projection-
// cached) path returns the same function reference every render.
const NEVER_UNRESOLVED: MilestoneGateUnresolvedFn = () => false;

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
 *
 * Returns BOTH the today set and a PER-INCOME `isIncomeMilestoneGateUnresolved`
 * predicate (findings 1/2/3/10): both surfaces get everything from this ONE hook call
 * (so the derivation runs once — finding 10), and the per-income predicate lets each
 * tab fall back to the date-window gate ONLY for an income whose own sim-dependent
 * (relative) milestone can't be resolved because no projection has run — never via a
 * global flag that opened the gate for every income (finding 1/2).
 */
export function useTodayMilestoneSet(): {
    todayMilestoneSet: Set<string>;
    isIncomeMilestoneGateUnresolved: MilestoneGateUnresolvedFn;
} {
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
        () => (state.milestones ?? []).some(m => (m.conditions ?? []).some(c => c.valueType === 'MILESTONE_PLUS')),
        [state.milestones],
    );

    const milestoneReachYears = useMemo(
        () => (hasRelativeMilestone ? buildMilestoneReachYears(simulation) : EMPTY_REACH_YEARS),
        [hasRelativeMilestone, simulation],
    );

    // Computed at render (cheap primitive) and kept in the deps so the memo
    // re-evaluates across a calendar-year boundary rather than holding a stale year.
    const year = new Date().getFullYear();

    const todayMilestoneSet = useMemo(() => {
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

    // The "can't resolve this income's milestone gate" signal keys off whether the
    // PROJECTION itself has run (simulation non-empty) — NOT the reach-map size, which
    // is also empty when a relative milestone ran and never fired (a genuine unreached
    // result that must gate OFF, finding 3). It's a per-income predicate (finding 2):
    // only sim-dependent (relative) milestones fall back, and only when no projection
    // exists; absolute-milestone incomes keep their normal gate (finding 1).
    const projectionHasRun = simulation.length > 0;

    const milestonesById = useMemo(() => {
        const map = new Map<string, CustomMilestone>();
        for (const m of state.milestones ?? []) map.set(m.id, m);
        return map;
    }, [state.milestones]);

    const isIncomeGateUnresolved = useMemo<MilestoneGateUnresolvedFn>(() => {
        // Common path: a projection is cached, or nothing is milestone-gated, or no
        // relative milestone is in play at all → nothing can be unresolvable. Return
        // the stable shared predicate so callers' memos don't churn.
        if (projectionHasRun || !hasMilestoneIncome || !hasRelativeMilestone) {
            return NEVER_UNRESOLVED;
        }
        return (inc: AnyIncome) =>
            isIncomeMilestoneGateUnresolved(inc, milestonesById, projectionHasRun);
    }, [projectionHasRun, hasMilestoneIncome, hasRelativeMilestone, milestonesById]);

    return { todayMilestoneSet, isIncomeMilestoneGateUnresolved: isIncomeGateUnresolved };
}
