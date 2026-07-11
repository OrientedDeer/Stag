import { type SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { getAccountTotals } from '../tabs/Future/tabs/FutureUtils';
import { type AnyAccount, DebtAccount, DeficitDebtAccount } from '../components/Objects/Accounts/models';
import type { AmountHistoryEntry } from '../components/Objects/Accounts/AccountContext';

/**
 * A frozen record of what the projection predicted at a moment in time, so we
 * can later see how reality lined up with it (the "projection memory" feature,
 * #63). Captured passively, ~monthly. Immutable once written. Stored with
 * primitive fields so it round-trips through localStorage cleanly.
 */
export interface ProjectionSnapshot {
    id: string;
    /** ISO datetime the snapshot was taken (for ordering / display). */
    capturedAt: string;
    /** 'YYYY-MM' in local time — the dedup key (one snapshot per calendar month). */
    capturedYearMonth: string;
    /** The frozen net-worth-by-year curve as predicted at capture time. */
    netWorthByYear: { year: number; netWorth: number }[];
}

const STORAGE_KEY = 'projection_history';
/** ~10 years of monthly snapshots; oldest are dropped past this. */
const MAX_SNAPSHOTS = 120;

/** Net-worth-by-year from a simulation (real projected years only). */
export function extractNetWorthCurve(simulation: SimulationYear[]): { year: number; netWorth: number }[] {
    return simulation
        .filter(y => !y.isEndOfYearProjection)
        .map(y => ({ year: y.year, netWorth: getAccountTotals(y.accounts).netWorth }));
}

export function loadProjectionHistory(): ProjectionSnapshot[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as ProjectionSnapshot[]) : [];
    } catch {
        return [];
    }
}

export function saveProjectionHistory(snapshots: ProjectionSnapshot[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
    } catch {
        /* storage full / unavailable — projection memory is best-effort */
    }
}

function localYearMonth(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Append a frozen snapshot of the current projection if this calendar month
 * hasn't been captured yet. Pure given `now` + `existing` — returns the
 * (possibly unchanged) list, capped at MAX_SNAPSHOTS (oldest dropped). Returns
 * the SAME array reference when nothing was added, so callers can skip a write.
 */
export function captureSnapshot(
    simulation: SimulationYear[],
    existing: ProjectionSnapshot[],
    now: Date = new Date(),
): ProjectionSnapshot[] {
    const curve = extractNetWorthCurve(simulation);
    if (curve.length === 0) return existing;
    const ym = localYearMonth(now);
    if (existing.some(s => s.capturedYearMonth === ym)) return existing;

    const snapshot: ProjectionSnapshot = {
        id: `snap-${now.getTime()}`,
        capturedAt: now.toISOString(),
        capturedYearMonth: ym,
        netWorthByYear: curve,
    };
    const next = [...existing, snapshot];
    return next.length > MAX_SNAPSHOTS ? next.slice(next.length - MAX_SNAPSHOTS) : next;
}

/**
 * Reconstruct ACTUAL net worth per past year from recorded account balances
 * (amountHistory), to overlay against the frozen predictions. For each year
 * that has any balance update, takes the latest update in that year and sums
 * the most-recent-on-or-before balance for every account, debts negative.
 *
 * Signing matches the snapshot's predicted curve (getAccountTotals): debt
 * accounts subtract, everything else adds. It intentionally does NOT reconstruct
 * a property's historical loan (not tracked in amountHistory) or apply vesting —
 * the overlay is a trend comparison, and both lines use the same definition.
 * The year is parsed from the date string directly to avoid the UTC off-by-one.
 */
export function actualNetWorthByYear(
    accounts: AnyAccount[],
    amountHistory: Record<string, AmountHistoryEntry[]>,
): { year: number; netWorth: number }[] {
    const latestDatePerYear = new Map<number, string>();
    for (const hist of Object.values(amountHistory)) {
        for (const e of hist) {
            const year = parseInt(e.date.slice(0, 4), 10);
            if (!Number.isFinite(year)) continue;
            const cur = latestDatePerYear.get(year);
            if (!cur || e.date > cur) latestDatePerYear.set(year, e.date);
        }
    }
    return [...latestDatePerYear.keys()]
        .sort((a, b) => a - b)
        .map(year => {
            const asOf = latestDatePerYear.get(year)!;
            let netWorth = 0;
            for (const acc of accounts) {
                const hist = amountHistory[acc.id];
                if (!hist || hist.length === 0) continue;
                const entry = [...hist].reverse().find(e => e.date <= asOf);
                if (!entry) continue;
                netWorth += (acc instanceof DebtAccount || acc instanceof DeficitDebtAccount) ? -entry.num : entry.num;
            }
            return { year, netWorth };
        });
}

/** Load history, capture this month's snapshot if needed, persist, return it. */
export function captureIfNeeded(simulation: SimulationYear[], now: Date = new Date()): ProjectionSnapshot[] {
    const existing = loadProjectionHistory();
    const updated = captureSnapshot(simulation, existing, now);
    if (updated !== existing) saveProjectionHistory(updated);
    return updated;
}
