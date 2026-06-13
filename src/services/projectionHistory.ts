import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { getAccountTotals } from '../tabs/Future/tabs/FutureUtils';

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

/** Load history, capture this month's snapshot if needed, persist, return it. */
export function captureIfNeeded(simulation: SimulationYear[], now: Date = new Date()): ProjectionSnapshot[] {
    const existing = loadProjectionHistory();
    const updated = captureSnapshot(simulation, existing, now);
    if (updated !== existing) saveProjectionHistory(updated);
    return updated;
}
