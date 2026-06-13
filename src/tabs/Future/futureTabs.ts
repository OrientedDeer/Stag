/**
 * Top-level tab list for the Projection page (FutureTab) and migration of
 * saved tab names from before the P7 regroup.
 *
 * "Risk" wraps Monte Carlo (which nests its own Historical Backtest toggle);
 * "Strategy" wraps Tax + Scenarios behind a secondary toggle.
 *
 * Lives outside FutureTab.tsx so non-component exports don't break fast
 * refresh.
 */
export const FUTURE_TABS = ["Overview", "Cashflow", "Assets", "Debt", "Risk", "Strategy", "Ratios", "Data"];

// Pre-grouping saved tab names → their new home (stale localStorage values).
const TAB_MIGRATIONS: Record<string, string> = {
    "Monte Carlo": "Risk",
    "Tax": "Strategy",
    "Scenarios": "Strategy",
};

/** Resolve a saved tab name to a current one; unknown names land on Overview. */
export function migrateSavedFutureTab(saved: string | null): string {
    if (!saved) return "Overview";
    if (FUTURE_TABS.includes(saved)) return saved;
    return TAB_MIGRATIONS[saved] ?? "Overview";
}
