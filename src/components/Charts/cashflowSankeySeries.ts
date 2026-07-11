/**
 * Per-year flow/node trajectories for the Cashflow Sankey click panel (#205, part c).
 *
 * `buildCashflowSankeyData` is a pure transform and its node ids are stable strings
 * across years:
 *  - fixed aggregator labels (`Gross Pay`, `Net Pay`, `Taxes`, `Federal Tax`, …),
 *  - income/withdrawal node ids embed the stable display name (`Withdraw: <account>`),
 *  - expense-category ids are the category label,
 *  - bucket node ids embed the stable account id (`Save: <id>` / `Pay Down: <id>`).
 * None of those keys change from one projection year to the next, so a link
 * `(sourceId → targetId)` or a node id can be tracked across the whole run.
 *
 * Rebuilding ~60 years of Sankey graphs on every popover click would jank, so the
 * built per-year link/node maps are cached on a WeakMap keyed by the
 * `SimulationYear[]` reference. A fresh simulation run mints a new array, which
 * naturally invalidates the cache; the same array reference reuses it (and returns
 * the identical series array for a repeated query).
 */
import { type SimulationYear } from '../../services/simulation/types';
import { buildCashflowSankeyData, type BuildCashflowSankeyInput } from './cashflowSankeyData';

/** Values whose magnitude is below this are treated as "inactive" for span math. */
const ACTIVE_THRESHOLD = 0.005;

const EMPTY_RECORD: Record<string, number> = {};

/** NUL-joined key so a source/target containing a literal "->" can't collide. */
const linkKey = (sourceId: string, targetId: string): string => `${sourceId}\u0000${targetId}`;

/**
 * Project a simulated year onto the exact inputs the chart feeds
 * `buildCashflowSankeyData` for that year (see CashflowTab's props), so the series
 * values match the on-screen diagram year-for-year.
 */
export function simYearToSankeyInput(sy: SimulationYear): BuildCashflowSankeyInput {
    return {
        incomes: sy.incomes,
        expenses: sy.expenses,
        year: sy.year,
        taxes: sy.taxDetails,
        bucketAllocations: sy.cashflow.bucketDetail ?? EMPTY_RECORD,
        accounts: sy.accounts,
        withdrawals: sy.cashflow.withdrawalDetail ?? EMPTY_RECORD,
        rothConversion: sy.rothConversion,
        cashflowDetail: sy.cashflowDetail,
        livingExpenses: sy.cashflow.livingExpenses,
    };
}

interface SeriesCache {
    /** Calendar year for each series index (real years only, EOY-projection dropped). */
    years: number[];
    /** Per-year "sourceId\0targetId" → link value. */
    linkMaps: Array<Map<string, number>>;
    /** Per-year nodeId → node throughput (max of inflow/outflow total). */
    nodeMaps: Array<Map<string, number>>;
    /** Memoized flow series by link key (so repeat queries return the same array). */
    flowSeries: Map<string, number[]>;
    /** Memoized node series by node id. */
    nodeSeries: Map<string, number[]>;
}

const cache = new WeakMap<SimulationYear[], SeriesCache>();

function getCache(simulationData: SimulationYear[]): SeriesCache {
    const existing = cache.get(simulationData);
    if (existing) return existing;

    // Drop the synthetic "projected end of current year" point so the series
    // aligns 1:1 with the calendar years the slider exposes (it shares year-0's
    // year and would otherwise duplicate it).
    const rows = simulationData.filter(sy => !sy.isEndOfYearProjection);
    const years: number[] = [];
    const linkMaps: Array<Map<string, number>> = [];
    const nodeMaps: Array<Map<string, number>> = [];

    for (const sy of rows) {
        years.push(sy.year);
        const { data } = buildCashflowSankeyData(simYearToSankeyInput(sy));
        const lm = new Map<string, number>();
        const inTotal = new Map<string, number>();
        const outTotal = new Map<string, number>();
        for (const l of data.links) {
            const k = linkKey(l.source, l.target);
            lm.set(k, (lm.get(k) ?? 0) + l.value);
            outTotal.set(l.source, (outTotal.get(l.source) ?? 0) + l.value);
            inTotal.set(l.target, (inTotal.get(l.target) ?? 0) + l.value);
        }
        const nm = new Map<string, number>();
        for (const n of data.nodes) {
            nm.set(n.id, Math.max(inTotal.get(n.id) ?? 0, outTotal.get(n.id) ?? 0));
        }
        linkMaps.push(lm);
        nodeMaps.push(nm);
    }

    const entry: SeriesCache = { years, linkMaps, nodeMaps, flowSeries: new Map(), nodeSeries: new Map() };
    cache.set(simulationData, entry);
    return entry;
}

/** Calendar years (real years only) aligned to every series this run returns. */
export function getSeriesYears(simulationData: SimulationYear[]): number[] {
    return getCache(simulationData).years;
}

/**
 * The value of the `sourceId → targetId` link in every projection year (0 for a
 * year in which that link doesn't exist). Cached: the same query on the same
 * `simulationData` reference returns the identical array.
 */
export function getFlowSeries(simulationData: SimulationYear[], sourceId: string, targetId: string): number[] {
    const c = getCache(simulationData);
    const key = linkKey(sourceId, targetId);
    const cached = c.flowSeries.get(key);
    if (cached) return cached;
    const series = c.linkMaps.map(m => m.get(key) ?? 0);
    c.flowSeries.set(key, series);
    return series;
}

/**
 * The throughput of node `nodeId` in every projection year (0 when the node is
 * absent that year). Cached like {@link getFlowSeries}.
 */
export function getNodeSeries(simulationData: SimulationYear[], nodeId: string): number[] {
    const c = getCache(simulationData);
    const cached = c.nodeSeries.get(nodeId);
    if (cached) return cached;
    const series = c.nodeMaps.map(m => m.get(nodeId) ?? 0);
    c.nodeSeries.set(nodeId, series);
    return series;
}

export interface SeriesSummary {
    /** Sum across all years. */
    total: number;
    /** Year of the largest value (null when there are no years). */
    peakYear: number | null;
    /** The largest value (0 when there are no years). */
    peakValue: number;
    /** First year the series is active (|value| ≥ threshold), or null. */
    firstActiveYear: number | null;
    /** Last active year, or null. */
    lastActiveYear: number | null;
}

/** Lifetime total, peak year, and active span for a series aligned to `years`. */
export function summarizeSeries(years: number[], values: number[]): SeriesSummary {
    let total = 0;
    let peakValue = -Infinity;
    let peakYear: number | null = null;
    let firstActiveYear: number | null = null;
    let lastActiveYear: number | null = null;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        total += v;
        if (v > peakValue) {
            peakValue = v;
            peakYear = years[i];
        }
        if (Math.abs(v) >= ACTIVE_THRESHOLD) {
            if (firstActiveYear === null) firstActiveYear = years[i];
            lastActiveYear = years[i];
        }
    }
    return {
        total,
        peakYear,
        peakValue: peakValue === -Infinity ? 0 : peakValue,
        firstActiveYear,
        lastActiveYear,
    };
}
