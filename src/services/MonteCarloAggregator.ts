import {
    type ScenarioResult,
    type MonteCarloSummary,
    type YearlyPercentile,
    type PercentileData,
    type TerminalPercentiles,
    type ConversionMcStats,
    type McBaselineComparison,
    type McCertaintyEquivalents,
} from './MonteCarloTypes';
import { calculateNetWorth, terminalAfterTaxNetWorth } from '../tabs/Future/tabs/FutureUtils';
import { type SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { DeficitDebtAccount } from '../components/Objects/Accounts/models';

/**
 * The situation-based Traditional valuation ruler (buildTradValuation's return
 * shape). Built ONCE per MC run from the deterministic std-ded baseline and
 * applied to every path's terminal year — never rebuilt per path.
 */
export type TradValuationRuler = Parameters<typeof terminalAfterTaxNetWorth>[1];

/**
 * Lightweight per-path result of the OPTIONAL std-ded-only baseline arm (F7).
 * The engine folds each baseline timeline down to this immediately so the arm
 * never holds a second full set of timelines in memory.
 */
export interface BaselinePathResult {
    success: boolean;
    yearOfDepletion: number | null;
    terminalAfterTaxNW: number;
}

/** Optional reporting inputs for {@link summarizeScenarios}. */
export interface SummarizeExtras {
    /** After-tax ruler (F4). When present, after-tax percentiles are computed. */
    ruler?: TradValuationRuler;
    /** Same-seed baseline arm results, index-aligned with `scenarios` (F7). */
    baselinePaths?: BaselinePathResult[];
}

/**
 * Calculate a specific percentile value from sorted array
 * @param sortedValues - Array of values, must be sorted ascending
 * @param percentile - Percentile to calculate (0-100)
 * @returns The value at the specified percentile
 */
export function getPercentileValue(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];

    const index = (percentile / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
        return sortedValues[lower];
    }

    // Linear interpolation between lower and upper bounds
    const fraction = index - lower;
    return sortedValues[lower] * (1 - fraction) + sortedValues[upper] * fraction;
}

/**
 * Calculate percentile data for all years from scenarios
 * @param scenarios - Array of scenario results
 * @returns Percentile data for p10, p25, p50, p75, p90
 */
export function calculatePercentiles(scenarios: ScenarioResult[]): PercentileData {
    if (scenarios.length === 0) {
        return {
            p10: [],
            p25: [],
            p50: [],
            p75: [],
            p90: [],
        };
    }

    // Get the number of years from first scenario
    const numYears = scenarios[0].timeline.length;

    const p10: YearlyPercentile[] = [];
    const p25: YearlyPercentile[] = [];
    const p50: YearlyPercentile[] = [];
    const p75: YearlyPercentile[] = [];
    const p90: YearlyPercentile[] = [];

    // For each year, collect net worth from all scenarios and calculate percentiles
    for (let yearIdx = 0; yearIdx < numYears; yearIdx++) {
        const year = scenarios[0].timeline[yearIdx].year;

        // Collect net worth values for this year across all scenarios
        const netWorths: number[] = scenarios.map(scenario => {
            if (yearIdx < scenario.timeline.length) {
                return calculateNetWorth(scenario.timeline[yearIdx].accounts);
            }
            return 0;
        });

        // Sort for percentile calculation
        netWorths.sort((a, b) => a - b);

        p10.push({ year, netWorth: getPercentileValue(netWorths, 10) });
        p25.push({ year, netWorth: getPercentileValue(netWorths, 25) });
        p50.push({ year, netWorth: getPercentileValue(netWorths, 50) });
        p75.push({ year, netWorth: getPercentileValue(netWorths, 75) });
        p90.push({ year, netWorth: getPercentileValue(netWorths, 90) });
    }

    return { p10, p25, p50, p75, p90 };
}

/**
 * Analyze a single scenario to determine success and key metrics
 * @param scenarioId - Unique identifier for this scenario
 * @param timeline - Full simulation timeline
 * @param yearlyReturns - Returns used in this scenario
 * @returns Analyzed scenario result
 */
export function analyzeScenario(
    scenarioId: number,
    timeline: SimulationYear[],
    yearlyReturns: number[]
): ScenarioResult {
    // Calculate final net worth
    const finalYear = timeline[timeline.length - 1];
    const finalNetWorth = calculateNetWorth(finalYear.accounts);

    // Find year of depletion (if any) - when deficit debt is created
    // This means expenses couldn't be covered by income + withdrawals
    // Note: Regular debt (mortgages, loans) doesn't count as failure
    //
    // BUG FIX: Use className check instead of instanceof because accounts
    // may be plain objects (serialized) rather than class instances
    let yearOfDepletion: number | null = null;
    for (let i = 0; i < timeline.length; i++) {
        const hasDeficitDebt = timeline[i].accounts.some(
            acc => acc instanceof DeficitDebtAccount ||
                   (acc as { className?: string }).className === 'DeficitDebtAccount'
        );
        if (hasDeficitDebt) {
            yearOfDepletion = timeline[i].year;
            break;
        }
    }

    return {
        scenarioId,
        timeline,
        success: yearOfDepletion === null,
        finalNetWorth,
        yearOfDepletion,
        yearlyReturns,
    };
}

/** p10/p50/p90 of an (unsorted) array of terminal values. */
function terminalPercentiles(values: number[]): TerminalPercentiles {
    const sorted = [...values].sort((a, b) => a - b);
    return {
        p10: getPercentileValue(sorted, 10),
        p50: getPercentileValue(sorted, 50),
        p90: getPercentileValue(sorted, 90),
    };
}

/** Median of an (unsorted) numeric array; null when empty. */
function medianOrNull(values: number[]): number | null {
    if (values.length === 0) return null;
    return getPercentileValue([...values].sort((a, b) => a - b), 50);
}

/** Total $ converted across a timeline's real (non-EOY-projection) years. */
export function totalConvertedInTimeline(timeline: SimulationYear[]): number {
    return timeline.reduce(
        (s, y) => s + (y.isEndOfYearProjection ? 0 : (y.rothConversion?.amount ?? 0)),
        0,
    );
}

/**
 * Conversion-facing MC stats (fp-review F11): pure folds over the per-path
 * timelines. The buy-the-dip slice classifies each converting-window year by
 * the sign of the PREVIOUS year's realized return: real-year index j (j≥1)
 * grows on `yearlyReturns[j-1]`, so "the year after a down year" is j with
 * `yearlyReturns[j-2] < 0` (j≥2). Sampling is restricted to each path's own
 * converting window (first..last year with a conversion) so decades of
 * structurally-zero years (working years, post-conversion RMD era) don't drag
 * both medians to $0.
 */
export function computeConversionStats(scenarios: ScenarioResult[]): ConversionMcStats {
    const totals = scenarios.map(s => totalConvertedInTimeline(s.timeline));
    const converting = totals.filter(t => t > 0).length;

    const afterDown: number[] = [];
    const afterOther: number[] = [];
    for (const s of scenarios) {
        const real = s.timeline.filter(y => !y.isEndOfYearProjection);
        let first = -1;
        let last = -1;
        for (let j = 1; j < real.length; j++) {
            if ((real[j].rothConversion?.amount ?? 0) > 0) {
                if (first < 0) first = j;
                last = j;
            }
        }
        if (first < 0) continue;
        for (let j = Math.max(first, 2); j <= last; j++) {
            const prevReturn = s.yearlyReturns[j - 2];
            if (prevReturn === undefined) continue;
            const conv = real[j].rothConversion?.amount ?? 0;
            (prevReturn < 0 ? afterDown : afterOther).push(conv);
        }
    }

    return {
        totalConverted: terminalPercentiles(totals),
        fractionOfPathsConverting: scenarios.length > 0 ? converting / scenarios.length : 0,
        medianConvertedAfterDownYear: medianOrNull(afterDown),
        medianConvertedAfterOtherYears: medianOrNull(afterOther),
        sampleYearsAfterDown: afterDown.length,
        sampleYearsAfterOther: afterOther.length,
    };
}

/**
 * CRRA certainty equivalent of a set of STRICTLY POSITIVE wealth outcomes
 * (fp-review F13 / #160):
 *
 *   CE_gamma = ((1/n) Σ w_i^(1-gamma))^(1/(1-gamma))   for gamma != 1
 *   CE_1     = exp((1/n) Σ ln w_i)                      (log utility)
 *
 * Numerical approach: values are normalized by their MEDIAN before
 * exponentiation. The CRRA CE is scale-invariant (CE(k·w) = k·CE(w)), so the
 * normalization cancels exactly — but it keeps the powers near 1 instead of
 * raising 6-7-figure wealth to the -3rd power (10^6^-3 = 1e-18) where a wide
 * spread starts flirting with float underflow. After normalizing, even a $10
 * vs $10M spread at gamma=4 stays within ~1e18 — comfortably inside float64.
 *
 * Throws on non-positive values: CRRA is undefined there, and the caller
 * (computeCertaintyEquivalents) is responsible for the solvency filtering.
 */
export function crraCertaintyEquivalent(values: number[], gamma: number): number {
    if (values.length === 0) return NaN;
    if (values.some(v => v <= 0)) {
        throw new Error('CRRA certainty equivalent requires strictly positive wealth values');
    }
    const median = getPercentileValue([...values].sort((a, b) => a - b), 50);
    if (gamma === 1) {
        const meanLog = values.reduce((s, v) => s + Math.log(v / median), 0) / values.length;
        return median * Math.exp(meanLog);
    }
    const p = 1 - gamma;
    const meanPow = values.reduce((s, v) => s + Math.pow(v / median, p), 0) / values.length;
    return median * Math.pow(meanPow, 1 / p);
}

/**
 * Certainty equivalents at gamma = 2 and 4 over the per-path terminal
 * after-tax net worth (F13 / #160). DECIDED CONVENTION: CE among solvent paths
 * only, always displayed alongside the failure rate — no epsilon floors, no
 * fabricated tail utility.
 *
 * "Solvent" == the #111 `success` definition the summary already uses (no
 * deficit-debt year anywhere on the path). A path can end with positive wealth
 * after a mid-life deficit year — it is still excluded here, exactly as it is
 * from `successRate`. CRRA is additionally undefined at w <= 0, so the rare
 * success path whose terminal AFTER-TAX value is <= 0 is guarded out of the CE
 * set with the same no-floor convention.
 *
 * Returns undefined when no path qualifies (the failure rate tells that story).
 */
export function computeCertaintyEquivalents(
    afterTaxValues: number[],
    successFlags: boolean[],
): McCertaintyEquivalents | undefined {
    const solvent = afterTaxValues.filter((v, i) => successFlags[i] && v > 0);
    if (solvent.length === 0) return undefined;
    return {
        gamma2: crraCertaintyEquivalent(solvent, 2),
        gamma4: crraCertaintyEquivalent(solvent, 4),
        solventCount: solvent.length,
        totalCount: afterTaxValues.length,
    };
}

/**
 * Paired plan-vs-baseline comparison (fp-review F7). `activeAfterTax` and
 * `baselinePaths` are index-aligned by scenarioId (same seeds, same draws), so
 * the after-tax deltas are true per-path causal effects — unlike the
 * cross-sectional percentile bands.
 */
function computeBaselineComparison(
    scenarios: ScenarioResult[],
    activeAfterTax: number[],
    baselinePaths: BaselinePathResult[],
): McBaselineComparison {
    const n = scenarios.length;
    const activeFailures = scenarios.filter(s => !s.success).length;
    const baselineFailures = baselinePaths.filter(p => !p.success).length;
    const baselineSuccessRate = ((n - baselineFailures) / n) * 100;
    const activeSuccessRate = ((n - activeFailures) / n) * 100;

    const deltas = activeAfterTax.map((v, i) => v - baselinePaths[i].terminalAfterTaxNW);
    const behind = deltas.filter(d => d < 0).length;

    return {
        baselineSuccessRate,
        deltaSuccessRate: activeSuccessRate - baselineSuccessRate,
        activeFailures,
        baselineFailures,
        medianDepletionYearActive: medianOrNull(
            scenarios.filter(s => s.yearOfDepletion !== null).map(s => s.yearOfDepletion as number),
        ),
        medianDepletionYearBaseline: medianOrNull(
            baselinePaths.filter(p => p.yearOfDepletion !== null).map(p => p.yearOfDepletion as number),
        ),
        fractionBehindBaseline: behind / n,
        afterTaxDelta: terminalPercentiles(deltas),
        baselineAfterTax: terminalPercentiles(baselinePaths.map(p => p.terminalAfterTaxNW)),
    };
}

/**
 * Summarize all Monte Carlo scenarios into aggregate statistics
 * @param scenarios - Array of all scenario results
 * @param seed - Random seed used for reproducibility
 * @param extras - Optional reporting inputs: the after-tax ruler (F4) and the
 *   same-seed baseline arm's per-path results (F7). Reporting-only — nothing
 *   here feeds back into conversion execution.
 * @returns Comprehensive summary of results
 */
export function summarizeScenarios(
    scenarios: ScenarioResult[],
    seed: number,
    extras?: SummarizeExtras,
): MonteCarloSummary {
    if (scenarios.length === 0) {
        throw new Error('No scenarios to summarize');
    }

    // Calculate success metrics
    const successfulScenarios = scenarios.filter(s => s.success).length;
    const successRate = (successfulScenarios / scenarios.length) * 100;

    // Calculate percentiles
    const percentiles = calculatePercentiles(scenarios);

    // Find representative scenarios (worst, median, best)
    const sortedByNetWorth = [...scenarios].sort(
        (a, b) => a.finalNetWorth - b.finalNetWorth
    );

    const worstCase = sortedByNetWorth[0];
    const bestCase = sortedByNetWorth[sortedByNetWorth.length - 1];
    const medianIndex = Math.floor(sortedByNetWorth.length / 2);
    const medianCase = sortedByNetWorth[medianIndex];

    // Calculate trimmed average final net worth (excluding top and bottom 5%)
    const trimPercent = 0.05;
    const trimCount = Math.floor(sortedByNetWorth.length * trimPercent);
    const trimmedScenarios = sortedByNetWorth.slice(trimCount, sortedByNetWorth.length - trimCount);
    const trimmedTotal = trimmedScenarios.reduce((sum, s) => sum + s.finalNetWorth, 0);
    const averageFinalNetWorth = trimmedScenarios.length > 0
        ? trimmedTotal / trimmedScenarios.length
        : sortedByNetWorth[Math.floor(sortedByNetWorth.length / 2)].finalNetWorth;

    // F4: terminal after-tax percentiles — each path's terminal year valued with
    // the ONE prebuilt situation-based ruler (never rebuilt per path).
    const ruler = extras?.ruler;
    const activeAfterTax = ruler
        ? scenarios.map(s => terminalAfterTaxNetWorth(s.timeline, ruler))
        : undefined;

    // F7: paired baseline comparison — requires the ruler (deltas are after-tax)
    // and an index-aligned baseline arm.
    const baselinePaths = extras?.baselinePaths;
    const baselineComparison =
        activeAfterTax && baselinePaths && baselinePaths.length === scenarios.length
            ? computeBaselineComparison(scenarios, activeAfterTax, baselinePaths)
            : undefined;

    return {
        successRate,
        percentiles,
        worstCase,
        medianCase,
        bestCase,
        totalScenarios: scenarios.length,
        successfulScenarios,
        averageFinalNetWorth,
        seed,
        afterTaxPercentiles: activeAfterTax ? terminalPercentiles(activeAfterTax) : undefined,
        // F13/#160: CE over the SAME per-path after-tax values, solvent paths only.
        certaintyEquivalents: activeAfterTax
            ? computeCertaintyEquivalents(activeAfterTax, scenarios.map(s => s.success))
            : undefined,
        conversionStats: computeConversionStats(scenarios),
        baselineComparison,
    };
}

