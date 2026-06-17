import { useState, useMemo, useContext } from 'react';
import { AssumptionsContext, AssumptionsState, getBirthYear, getRetirementAge } from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { getTaxParameters } from '../../components/Objects/Taxes/TaxService';
import { FilingStatus } from '../../data/TaxData';
import { getRMDStartAge, getDistributionPeriod } from '../../data/RMDData';
import { SimulationYear, RateMatchWalkRow, ConversionLimitingFactor, DPYearTrace } from '../../services/simulation/types';
import { DP_BACKLOAD_DELTA } from '../../services/simulation/RothConversionDP';
import { Panel } from "../../components/Layout/Primitives";

const fmtCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const fmtCurrencyShort = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000).toFixed(0)}k`;
    return fmtCurrency(n);
};

const fmtPct = (rate: number) => `${(rate * 100).toFixed(0)}%`;
const fmtPP = (gap: number) => `${(gap * 100).toFixed(1)}pp`;

function limitingFactorLabel(factor: ConversionLimitingFactor | undefined): string {
    switch (factor) {
        case 'BRACKET_CEILING': return 'Hit bracket ceiling';
        case 'SS_TORPEDO': return 'SS torpedo';
        case 'ACA_CLIFF': return 'ACA cliff';
        case 'NO_BRACKET_SPACE': return 'No bracket space';
        case 'TRADITIONAL_DEPLETED': return 'Traditional depleted';
        case 'NOT_RETIRED': return 'Not retired';
        case 'AT_RMD_AGE': return 'At RMD age';
        case 'SPENDING_DEFICIT': return 'Spending withdrawal';
        case 'OPTIMIZATION_DISABLED': return 'Optimization disabled';
        default: return '—';
    }
}

function headlineReason(year: SimulationYear, strategy: 'rate-match' | 'std-ded-only' | 'dp-precomputed'): string {
    const target = year.taxOptimizationTarget;
    if (!target) return 'no optimization target was computed';
    const factor = target.limitingFactor;

    if (strategy === 'dp-precomputed') {
        if (factor === 'NOT_RETIRED') return 'not yet retired';
        if (factor === 'AT_RMD_AGE') return 'past RMD start (DP plan ends at RMD age)';
        if (factor === 'TRADITIONAL_DEPLETED') return 'the Traditional balance ran out';
        if ((target.actualConversion ?? 0) === 0) return 'the DP solver picked $0 for this year — no further lifetime-tax win available';
        return 'the DP solver picked this amount as part of its lifetime-tax-minimizing plan';
    }

    const stopRow = target.rateMatchWalk?.find(r => r.decision === 'stop');
    if (factor === 'BRACKET_CEILING' && stopRow) {
        return `the rate gap closed at the ${fmtPct(stopRow.currentRate)} bracket (gap ${fmtPP(stopRow.gap)} < threshold)`;
    }
    if (factor === 'TRADITIONAL_DEPLETED') return 'the Traditional balance ran out';
    if (factor === 'SS_TORPEDO') return 'further conversions would push more Social Security into taxability';
    if (factor === 'ACA_CLIFF') return 'further conversions would cross the ACA subsidy cliff';
    if (factor === 'SPENDING_DEFICIT') return 'this year\'s bracket space was consumed by Traditional withdrawals for spending';
    if (factor === 'NO_BRACKET_SPACE') return 'AGI was already at or above the conversion ceiling';
    if (stopRow) return `the rate gap closed at the ${fmtPct(stopRow.currentRate)} bracket`;
    return 'the engine had no further rate-arbitrage opportunity';
}

function isConversionRelevantYear(year: SimulationYear, retirementYear: number, rmdYear: number): boolean {
    if (year.year < retirementYear) return false;
    if (year.year >= rmdYear) return false;
    const factor = year.taxOptimizationTarget?.limitingFactor;
    return factor !== 'NOT_RETIRED' && factor !== 'AT_RMD_AGE';
}

interface ZeroTaxFloor {
    floor: number;
    maxRMD: number;
    stdDeduction: number;
    taxableSS: number;
    pension: number;
    rmdDivisor: number;
}

function computeZeroTaxFloor(
    target: NonNullable<SimulationYear['taxOptimizationTarget']>,
    rmdYear: number,
    filingStatus: FilingStatus,
    stateResidency: string,
    assumptions: AssumptionsState,
): ZeroTaxFloor | null {
    const fedParams = getTaxParameters(rmdYear, filingStatus, 'federal', stateResidency, assumptions);
    if (!fedParams) return null;
    const rmdDivisor = getDistributionPeriod(target.rmdStartAge);
    if (rmdDivisor <= 0) return null;
    const ss = target.ssAtRMD ?? 0;
    const pension = target.pensionAtRMD ?? 0;
    // Use the 85% ceiling for taxable SS as a simple, slightly-conservative
    // estimate. (See ROTH_DEBUG_PAGE_PLAN.md open question 1.)
    const taxableSS = ss * 0.85;
    const maxRMD = Math.max(0, fedParams.standardDeduction - taxableSS - pension);
    return {
        floor: maxRMD * rmdDivisor,
        maxRMD,
        stdDeduction: fedParams.standardDeduction,
        taxableSS,
        pension,
        rmdDivisor,
    };
}

function YearSparkline({
    years,
    selectedYear,
    onSelect,
}: {
    years: { year: number; balance: number }[];
    selectedYear: number;
    onSelect: (year: number) => void;
}) {
    if (years.length === 0) return null;
    const w = 240;
    const h = 60;
    const xs = years.map(y => y.year);
    const ys = years.map(y => y.balance);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = 0;
    const maxY = Math.max(...ys, 1);
    const xScale = (x: number) => ((x - minX) / Math.max(1, maxX - minX)) * w;
    const yScale = (y: number) => h - ((y - minY) / Math.max(1, maxY - minY)) * h;
    const path = years.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.year).toFixed(1)},${yScale(p.balance).toFixed(1)}`).join(' ');
    const selected = years.find(p => p.year === selectedYear);
    return (
        <div className="px-2">
            <div className="text-xs text-content-subtle mb-1">Traditional balance over time</div>
            <svg width={w} height={h} className="overflow-visible">
                <path d={path} stroke="var(--c-cat-purple)" strokeWidth={1.5} fill="none" />
                {selected && (
                    <circle
                        cx={xScale(selected.year)}
                        cy={yScale(selected.balance)}
                        r={3.5}
                        fill="var(--c-cat-fuchsia)"
                    />
                )}
                {/* Click overlay */}
                {years.map(p => (
                    <rect
                        key={p.year}
                        x={xScale(p.year) - 4}
                        y={0}
                        width={8}
                        height={h}
                        fill="transparent"
                        className="cursor-pointer"
                        onClick={() => onSelect(p.year)}
                    >
                        <title>{`${p.year}: ${fmtCurrencyShort(p.balance)}`}</title>
                    </rect>
                ))}
            </svg>
        </div>
    );
}

function HeadlineSection({
    year,
    age,
    convertedAmount,
    reason,
    target,
}: {
    year: number;
    age: number;
    convertedAmount: number;
    reason: string;
    target: NonNullable<SimulationYear['taxOptimizationTarget']>;
}) {
    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="text-sm text-content-muted mb-1">Headline</div>
            <p className="text-content-bright text-base leading-relaxed">
                In <span className="font-semibold text-white">{year}</span> (age <span className="font-semibold text-white">{age}</span>),
                the engine converted <span className="font-bold text-cat-fuchsia">{fmtCurrency(convertedAmount)}</span> because {reason}.
            </p>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                    <div className="text-content-subtle">Trad balance (start)</div>
                    <div className="text-content-emphasis font-medium">{fmtCurrencyShort(target.currentTraditionalBalance ?? 0)}</div>
                </div>
                <div>
                    <div className="text-content-subtle">AGI before conversion</div>
                    <div className="text-content-emphasis font-medium">{fmtCurrencyShort(target.constraintDetails?.currentAGI ?? 0)}</div>
                </div>
                <div>
                    <div className="text-content-subtle">Reached bracket</div>
                    <div className="text-content-emphasis font-medium">{fmtPct(target.targetBracketCeiling)}</div>
                </div>
                <div>
                    <div className="text-content-subtle">Limiting factor</div>
                    <div className="text-content-emphasis font-medium">{limitingFactorLabel(target.limitingFactor)}</div>
                </div>
            </div>
        </section>
    );
}

function DPPlanSummarySection({ traces, birthYear }: { traces: DPYearTrace[]; birthYear: number }) {
    if (traces.length === 0) return null;

    const sorted = [...traces].sort((a, b) => a.year - b.year);
    const NONTRIVIAL = 1000;

    let totalConverted = 0;
    let totalConversionTax = 0;
    let yearsConverting = 0;
    let firstConv: DPYearTrace | null = null;
    let lastConv: DPYearTrace | null = null;
    let peakConv: DPYearTrace | null = null;

    for (const t of sorted) {
        totalConverted += t.chosenC;
        totalConversionTax += Math.max(0, t.yearTax - t.taxBaselineNoConv);
        if (t.chosenC > NONTRIVIAL) {
            yearsConverting++;
            if (firstConv === null) firstConv = t;
            lastConv = t;
            if (peakConv === null || t.chosenC > peakConv.chosenC) peakConv = t;
        }
    }

    const last = sorted[sorted.length - 1];
    const effectiveTaxRate = totalConverted > 0 ? totalConversionTax / totalConverted : 0;

    // Sparkline
    const w = 480;
    const h = 50;
    const minYear = sorted[0].year;
    const maxYear = last.year;
    const yearRange = Math.max(1, maxYear - minYear);
    const maxChosen = Math.max(...sorted.map(t => t.chosenC), 1);
    const barW = Math.max(2, (w - 6) / Math.max(1, sorted.length));

    const terminalRows: Array<{ label: string; dp: number; baseline: number; dir: 'lower' | 'higher' }> = [
        { label: 'Trad balance', dp: last.tradNext, baseline: last.baselineTrad ?? 0, dir: 'lower' },
        { label: 'Roth balance', dp: last.rothNext, baseline: last.baselineRoth ?? 0, dir: 'higher' },
    ];

    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="text-sm text-content-muted mb-3">DP plan: macro view</div>

            {/* Headline metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="bg-surface-overlay/60 rounded-lg p-3">
                    <div className="text-xs text-content-subtle">Total converted</div>
                    <div className="text-xl font-bold text-cat-fuchsia">{fmtCurrencyShort(totalConverted)}</div>
                    <div className="text-xs text-content-subtle mt-0.5">
                        {yearsConverting} of {sorted.length} years
                    </div>
                </div>
                <div className="bg-surface-overlay/60 rounded-lg p-3">
                    <div className="text-xs text-content-subtle">Conversion tax paid</div>
                    <div className="text-xl font-bold text-content-bright">{fmtCurrencyShort(totalConversionTax)}</div>
                    <div className="text-xs text-content-subtle mt-0.5">marginal over baseline</div>
                </div>
                <div className="bg-surface-overlay/60 rounded-lg p-3">
                    <div className="text-xs text-content-subtle">Effective rate</div>
                    <div className="text-xl font-bold text-content-bright">{(effectiveTaxRate * 100).toFixed(1)}%</div>
                    <div className="text-xs text-content-subtle mt-0.5">tax / converted</div>
                </div>
                <div className="bg-surface-overlay/60 rounded-lg p-3">
                    <div className="text-xs text-content-subtle">Horizon</div>
                    <div className="text-xl font-bold text-content-bright">{sorted.length} yr</div>
                    <div className="text-xs text-content-subtle mt-0.5">{minYear}–{maxYear}</div>
                </div>
            </div>

            {/* Conversion sparkline */}
            <div className="mb-4">
                <div className="text-xs text-content-subtle mb-1">Conversions by year (ages {minYear - birthYear}–{maxYear - birthYear})</div>
                <svg width={w} height={h + 18} className="text-content-muted">
                    <line x1={0} y1={h} x2={w} y2={h} stroke="var(--c-border-default)" strokeWidth={1} />
                    {sorted.map(t => {
                        const x = ((t.year - minYear) / yearRange) * (w - barW);
                        const barH = (t.chosenC / maxChosen) * h;
                        const isPeak = peakConv && t.year === peakConv.year;
                        return (
                            <rect
                                key={t.year}
                                x={x}
                                y={h - barH}
                                width={barW}
                                height={barH}
                                fill={isPeak ? 'var(--c-cat-fuchsia)' : (t.chosenC > NONTRIVIAL ? 'var(--c-cat-purple)' : 'var(--c-border-strong)')}
                            >
                                <title>
                                    {`${t.year} (age ${t.age}): ${fmtCurrencyShort(t.chosenC)}`}
                                </title>
                            </rect>
                        );
                    })}
                    <text x={0} y={h + 14} fontSize={9} fill="currentColor">age {minYear - birthYear}</text>
                    <text x={w - 50} y={h + 14} fontSize={9} fill="currentColor" textAnchor="start">
                        age {maxYear - birthYear}
                    </text>
                </svg>
            </div>

            {/* Lifecycle markers */}
            {firstConv && peakConv && lastConv && (
                <div className="text-sm text-content-default mb-4 space-y-1">
                    <div>
                        <span className="text-content-subtle">First nontrivial conversion: </span>
                        <span className="font-mono text-content-emphasis">{fmtCurrencyShort(firstConv.chosenC)}</span>{' '}
                        <span className="text-content-subtle">in {firstConv.year} (age {firstConv.age})</span>
                    </div>
                    <div>
                        <span className="text-content-subtle">Peak: </span>
                        <span className="font-mono text-cat-fuchsia">{fmtCurrencyShort(peakConv.chosenC)}</span>{' '}
                        <span className="text-content-subtle">in {peakConv.year} (age {peakConv.age})</span>
                    </div>
                    <div>
                        <span className="text-content-subtle">Last nontrivial: </span>
                        <span className="font-mono text-content-emphasis">{fmtCurrencyShort(lastConv.chosenC)}</span>{' '}
                        <span className="text-content-subtle">in {lastConv.year} (age {lastConv.age})</span>
                        {lastConv.year < last.year && (
                            <span className="text-content-subtle"> — plan winds down for the remaining {last.year - lastConv.year} year(s)</span>
                        )}
                    </div>
                </div>
            )}

            {/* End-of-horizon comparison */}
            <div>
                <div className="text-xs text-content-subtle mb-2">
                    End of horizon (year {last.year}, age {last.age})
                </div>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-content-subtle text-xs border-b border-border-subtle">
                            <th className="text-left py-2 font-normal">Balance</th>
                            <th className="text-right py-2 font-normal">DP plan</th>
                            <th className="text-right py-2 font-normal">Baseline</th>
                            <th className="text-right py-2 font-normal">Δ</th>
                        </tr>
                    </thead>
                    <tbody>
                        {terminalRows.map(row => {
                            const delta = row.dp - row.baseline;
                            const better = (row.dir === 'lower' ? delta < 0 : delta > 0);
                            const color = delta === 0 ? 'text-content-subtle' : (better ? 'text-positive' : 'text-warning');
                            return (
                                <tr key={row.label} className="border-b border-border-subtle/50">
                                    <td className="py-2 text-content-default">{row.label}</td>
                                    <td className="py-2 text-right font-mono text-content-emphasis">{fmtCurrencyShort(row.dp)}</td>
                                    <td className="py-2 text-right font-mono text-content-muted">{fmtCurrencyShort(row.baseline)}</td>
                                    <td className={`py-2 text-right font-mono ${color}`}>
                                        {(delta >= 0 ? '+' : '') + fmtCurrencyShort(delta)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <p className="text-xs text-content-subtle mt-3 leading-relaxed">
                    Baseline = std-ded-headroom-only sub-sim. Negative trad-Δ + positive roth-Δ = DP shifted wealth
                    into tax-free; the "conversion tax paid" cell above is what it cost to do so.
                </p>
            </div>
        </section>
    );
}

function DPHeadlineSection({ trace }: { trace: DPYearTrace }) {
    const c0 = trace.costCurve.find(p => p.c === 0);
    const cMaxRow = trace.costCurve[trace.costCurve.length - 1];
    const savedVsZero = c0 ? c0.totalCost - trace.totalCost : 0;
    const savedVsMax = cMaxRow ? cMaxRow.totalCost - trace.totalCost : 0;

    // Effective rate over the whole conversion (avg).
    const effectiveRate = trace.chosenC > 0
        ? (trace.yearTax - trace.taxBaselineNoConv) / trace.chosenC
        : 0;

    // Marginal rate on the LAST dollars converted: take the cost-curve segment
    // that ENDS at the chosen c (its slope is the average rate over the
    // last bit DP added to its conversion). For c=$0 chosen, no last segment;
    // skip the marginal display.
    const idxChosen = trace.costCurve.findIndex(p => Math.abs(p.c - trace.chosenC) < 1);
    let marginalRate: number | null = null;
    if (idxChosen > 0) {
        const prev = trace.costCurve[idxChosen - 1];
        const curr = trace.costCurve[idxChosen];
        const dC = curr.c - prev.c;
        if (dC > 0.5) {
            marginalRate = (curr.yearTax - prev.yearTax) / dC;
        }
    }

    let pickReason = 'this is the cost-minimizing conversion size given the future-tax projection';
    if (trace.chosenC === 0) {
        pickReason = 'every non-zero conversion increases lifetime cost — the V-table sees no savings to capture';
    } else if (Math.abs(trace.chosenC - trace.cMax) < 1) {
        pickReason = 'maximizing conversion this year minimizes total lifetime cost';
    }

    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="text-sm text-content-muted mb-1">DP decision (year {trace.year}, age {trace.age})</div>
            <p className="text-content-bright text-base leading-relaxed">
                Picked <span className="font-bold text-cat-fuchsia">{fmtCurrency(trace.chosenC)}</span> because {pickReason}.
                Total lifetime cost from this state: <span className="font-mono text-content-emphasis">{fmtCurrencyShort(trace.totalCost)}</span>.
            </p>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                    <div className="text-content-subtle">Effective rate (avg)</div>
                    <div className="text-content-emphasis font-mono">
                        {trace.chosenC > 0 ? `${(effectiveRate * 100).toFixed(1)}%` : '—'}
                    </div>
                </div>
                <div>
                    <div className="text-content-subtle">Marginal rate (last $)</div>
                    <div className="text-content-emphasis font-mono">
                        {marginalRate !== null ? `${(marginalRate * 100).toFixed(1)}%` : '—'}
                    </div>
                </div>
                <div>
                    <div className="text-content-subtle">This year's tax</div>
                    <div className="text-content-emphasis font-mono">{fmtCurrencyShort(trace.yearTax)}</div>
                </div>
                <div>
                    <div className="text-content-subtle">Discounted future</div>
                    <div className="text-content-emphasis font-mono">{fmtCurrencyShort(trace.discountedFuture)}</div>
                </div>
                <div>
                    <div className="text-content-subtle">vs c=$0 (saved)</div>
                    <div className={`font-mono ${savedVsZero > 0 ? 'text-positive' : 'text-content-subtle'}`}>
                        {savedVsZero > 0 ? `+${fmtCurrencyShort(savedVsZero)}` : '—'}
                    </div>
                </div>
                <div>
                    <div className="text-content-subtle">vs c=cMax (saved)</div>
                    <div className={`font-mono ${savedVsMax > 0 ? 'text-positive' : 'text-content-subtle'}`}>
                        {savedVsMax > 0 ? `+${fmtCurrencyShort(savedVsMax)}` : '—'}
                    </div>
                </div>
            </div>
        </section>
    );
}

function DPCostCurveSection({ trace }: { trace: DPYearTrace }) {
    const samples = trace.costCurve;
    if (samples.length === 0) return null;

    const maxTotal = Math.max(...samples.map(s => s.totalCost));
    const maxYearTax = Math.max(...samples.map(s => s.yearTax));
    const maxDFut = Math.max(...samples.map(s => s.discountedFuture));
    const stackMax = Math.max(maxTotal, maxYearTax + maxDFut);

    const w = 480;
    const h = 180;
    const padL = 50;
    const padR = 12;
    const padT = 12;
    const padB = 28;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;

    const barCount = samples.length;
    const barGap = 8;
    const barW = Math.max(8, (innerW - barGap * (barCount - 1)) / barCount);

    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="text-sm text-content-muted mb-2">
                Cost-curve: total lifetime cost vs conversion size
            </div>

            {/* SVG stacked-bar chart */}
            <div className="overflow-x-auto">
                <svg width={w} height={h} className="text-content-muted">
                    {/* y axis label */}
                    <text x={4} y={padT + 8} fontSize={10} fill="currentColor">Cost</text>
                    {/* x axis label */}
                    <text x={padL + innerW / 2 - 30} y={h - 4} fontSize={10} fill="currentColor">conversion (c)</text>
                    {/* axes */}
                    <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke="var(--c-border-default)" strokeWidth={1} />
                    <line x1={padL} y1={padT + innerH} x2={padL + innerW} y2={padT + innerH} stroke="var(--c-border-default)" strokeWidth={1} />
                    {/* y ticks (max + half) */}
                    {[0, 0.5, 1].map(frac => {
                        const y = padT + innerH * (1 - frac);
                        const v = stackMax * frac;
                        return (
                            <g key={frac}>
                                <line x1={padL - 3} y1={y} x2={padL} y2={y} stroke="var(--c-border-default)" />
                                <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="currentColor">
                                    {fmtCurrencyShort(v)}
                                </text>
                            </g>
                        );
                    })}
                    {samples.map((s, i) => {
                        const isChosen = Math.abs(s.c - trace.chosenC) < 1;
                        const x = padL + i * (barW + barGap);
                        const yTaxH = (s.yearTax / Math.max(1, stackMax)) * innerH;
                        const dFutH = (s.discountedFuture / Math.max(1, stackMax)) * innerH;
                        const yTaxY = padT + innerH - yTaxH;
                        const dFutY = yTaxY - dFutH;
                        return (
                            <g key={i}>
                                {/* discounted future on top */}
                                <rect
                                    x={x} y={dFutY} width={barW} height={dFutH}
                                    fill={isChosen ? 'var(--c-cat-purple)' : 'var(--c-border-strong)'}
                                    opacity={0.85}
                                />
                                {/* yearTax on bottom */}
                                <rect
                                    x={x} y={yTaxY} width={barW} height={yTaxH}
                                    fill={isChosen ? 'var(--c-cat-fuchsia)' : 'var(--c-content-muted)'}
                                />
                                {/* chosen marker */}
                                {isChosen && (
                                    <text
                                        x={x + barW / 2} y={dFutY - 4}
                                        textAnchor="middle" fontSize={10}
                                        fill="var(--c-cat-fuchsia)" fontWeight="bold"
                                    >
                                        ★
                                    </text>
                                )}
                                {/* x label */}
                                <text
                                    x={x + barW / 2} y={padT + innerH + 14}
                                    textAnchor="middle" fontSize={9}
                                    fill={isChosen ? 'var(--c-cat-fuchsia)' : 'currentColor'}
                                >
                                    {fmtCurrencyShort(s.c)}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </div>
            <div className="text-xs text-content-subtle mt-1 mb-3 flex gap-4">
                <span><span className="inline-block w-3 h-3 align-middle mr-1" style={{ background: 'var(--c-content-muted)' }} /> yearTax</span>
                <span><span className="inline-block w-3 h-3 align-middle mr-1" style={{ background: 'var(--c-border-strong)' }} /> discounted future</span>
                <span className="text-cat-fuchsia">★ chosen</span>
            </div>

            {/* Detail table */}
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-content-subtle text-xs border-b border-border-subtle">
                        <th className="text-left py-2 font-normal">c</th>
                        <th className="text-right py-2 font-normal">yearTax</th>
                        <th className="text-right py-2 font-normal">discounted future</th>
                        <th className="text-right py-2 font-normal">total cost</th>
                        <th className="text-right py-2 font-normal">tradNext</th>
                        <th className="text-right py-2 font-normal">rothNext</th>
                    </tr>
                </thead>
                <tbody>
                    {samples.map((s, i) => {
                        const isChosen = Math.abs(s.c - trace.chosenC) < 1;
                        return (
                            <tr
                                key={i}
                                className={`border-b border-border-subtle/50 ${isChosen ? 'bg-cat-fuchsia-tint/30' : ''}`}
                            >
                                <td className={`py-2 ${isChosen ? 'text-cat-fuchsia-bright font-semibold' : 'text-content-default'}`}>
                                    {isChosen ? '★ ' : ''}{fmtCurrencyShort(s.c)}
                                </td>
                                <td className="py-2 text-right font-mono text-content-default">{fmtCurrencyShort(s.yearTax)}</td>
                                <td className="py-2 text-right font-mono text-content-default">{fmtCurrencyShort(s.discountedFuture)}</td>
                                <td className={`py-2 text-right font-mono ${isChosen ? 'text-cat-fuchsia-bright font-semibold' : 'text-content-default'}`}>
                                    {fmtCurrencyShort(s.totalCost)}
                                </td>
                                <td className="py-2 text-right font-mono text-content-muted">{fmtCurrencyShort(s.tradNext)}</td>
                                <td className="py-2 text-right font-mono text-content-muted">{fmtCurrencyShort(s.rothNext)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <p className="text-xs text-content-subtle mt-3 leading-relaxed">
                For each candidate <span className="font-mono">c</span>, DP evaluates this year's tax plus the
                discounted optimal future cost from <span className="font-mono">(tradNext, rothNext)</span>. The
                lowest <span className="font-mono">total</span> wins.
            </p>
        </section>
    );
}

function DPRateAnalysisSection({ trace }: { trace: DPYearTrace }) {
    if (trace.costCurve.length < 2) return null;

    type Segment = {
        from: number;
        to: number;
        marginalTax: number;       // fraction
        futureSavedRate: number;   // fraction (PV future cost reduction per $ converted)
        net: number;               // fraction (futureSaved - marginalTax)
        endsAtChosen: boolean;
    };

    const segments: Segment[] = [];
    for (let i = 1; i < trace.costCurve.length; i++) {
        const prev = trace.costCurve[i - 1];
        const curr = trace.costCurve[i];
        const dC = curr.c - prev.c;
        if (dC <= 0.5) continue;
        const dTax = curr.yearTax - prev.yearTax;
        const dFutSaved = prev.discountedFuture - curr.discountedFuture; // positive = save
        segments.push({
            from: prev.c,
            to: curr.c,
            marginalTax: dTax / dC,
            futureSavedRate: dFutSaved / dC,
            net: (dFutSaved - dTax) / dC,
            endsAtChosen: Math.abs(curr.c - trace.chosenC) < 1,
        });
    }

    if (segments.length === 0) return null;

    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="text-sm text-content-muted mb-2">
                Why DP stopped at {fmtCurrencyShort(trace.chosenC)}: the marginal trade-off
            </div>
            <p className="text-xs text-content-subtle mb-3 leading-relaxed">
                For each conversion segment, DP compares <span className="text-content-default">today's marginal tax rate</span>{' '}
                (federal + state, on the next dollar) against the <span className="text-content-default">PV of future tax it
                avoids</span> (V-table-derived, per $ converted). Conversion is worthwhile while future-saved &gt; today's tax.
                DP stops where the trade-off flips negative.
            </p>
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-content-subtle text-xs border-b border-border-subtle">
                        <th className="text-left py-2 font-normal">conversion segment</th>
                        <th className="text-right py-2 font-normal">marginal tax (today)</th>
                        <th className="text-right py-2 font-normal">future PV saved per $</th>
                        <th className="text-right py-2 font-normal">net</th>
                        <th className="text-left py-2 pl-3 font-normal">verdict</th>
                    </tr>
                </thead>
                <tbody>
                    {segments.map((s, i) => (
                        <tr
                            key={i}
                            className={`border-b border-border-subtle/50 ${s.endsAtChosen ? 'bg-cat-fuchsia-tint/30' : ''}`}
                        >
                            <td className="py-2 text-content-default font-mono">
                                {fmtCurrencyShort(s.from)} → {fmtCurrencyShort(s.to)}
                                {s.endsAtChosen && <span className="text-cat-fuchsia ml-2" title="DP stopping point">★</span>}
                            </td>
                            <td className="py-2 text-right font-mono text-content-default">
                                {(s.marginalTax * 100).toFixed(1)}%
                            </td>
                            <td className="py-2 text-right font-mono text-content-default">
                                {(s.futureSavedRate * 100).toFixed(1)}%
                            </td>
                            <td className={`py-2 text-right font-mono ${s.net > 0 ? 'text-positive' : 'text-negative'}`}>
                                {(s.net >= 0 ? '+' : '') + (s.net * 100).toFixed(1)}%
                            </td>
                            <td className="py-2 pl-3 text-xs">
                                {s.net > 0 ? (
                                    <span className="text-positive">✓ convert</span>
                                ) : (
                                    <span className="text-negative">✗ stop</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="text-xs text-content-subtle mt-3 leading-relaxed">
                <span className="text-content-muted">How to use this</span>: if the "future PV saved per $" looks
                unrealistic for your scenario (e.g., DP claims it's avoiding 35% PV when you don't expect
                future tax rates that high), the V-table projection may be over-confident. The most common
                cause is large projected Trad balances at RMD age driving the future-rate estimate up.
                Compare to the baseline-trad value in the comparison section below.
            </p>
        </section>
    );
}

function DPStateFlowSection({ trace }: { trace: DPYearTrace }) {
    const tradAfterFlows = trace.tradEntering - trace.chosenC - trace.rmdAtEntering - trace.tradSpending;
    const rothAfterFlows = trace.rothEntering + trace.chosenC - trace.fromRoth;
    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="text-sm text-content-muted mb-3">Balance evolution under chosen plan</div>
            <div className="space-y-3 text-sm font-mono leading-relaxed">
                <div className="text-content-default">
                    <span className="text-cat-cyan">trad:</span>{' '}
                    {fmtCurrencyShort(trace.tradEntering)}
                    <span className="text-content-subtle"> − conversion </span>{fmtCurrencyShort(trace.chosenC)}
                    <span className="text-content-subtle"> − rmd </span>{fmtCurrencyShort(trace.rmdAtEntering)}
                    <span className="text-content-subtle"> − tradSpending </span>{fmtCurrencyShort(trace.tradSpending)}
                    <span className="text-content-subtle"> = </span>
                    {fmtCurrencyShort(tradAfterFlows)}
                    <span className="text-content-subtle"> × </span>(1 + growth)
                    <span className="text-content-subtle"> = </span>
                    <span className="text-content-bright font-semibold">{fmtCurrencyShort(trace.tradNext)}</span>
                </div>
                <div className="text-content-default">
                    <span className="text-positive">roth:</span>{' '}
                    {fmtCurrencyShort(trace.rothEntering)}
                    <span className="text-content-subtle"> + conversion </span>{fmtCurrencyShort(trace.chosenC)}
                    <span className="text-content-subtle"> − fromRoth </span>{fmtCurrencyShort(trace.fromRoth)}
                    <span className="text-content-subtle"> = </span>
                    {fmtCurrencyShort(rothAfterFlows)}
                    <span className="text-content-subtle"> × </span>(1 + roth growth)
                    <span className="text-content-subtle"> = </span>
                    <span className="text-content-bright font-semibold">{fmtCurrencyShort(trace.rothNext)}</span>
                </div>
            </div>
            <p className="text-xs text-content-subtle mt-3">
                These are DP's <em>projected</em> balances under the chosen plan. They drive the lookup into V[t+1] for the
                future-cost component above.
            </p>
        </section>
    );
}

function DPWaterfallSection({ trace }: { trace: DPYearTrace }) {
    const totalCash = trace.fromBrokerage + trace.fromRoth + trace.tradSpending;
    const sources = [
        { label: 'brokerage', amount: trace.fromBrokerage, cap: trace.baselineBrokerageCap, color: 'bg-accent-soft' },
        { label: 'roth', amount: trace.fromRoth, cap: trace.rothEntering, color: 'bg-positive-soft' },
        { label: 'trad-spending', amount: trace.tradSpending, cap: Math.max(0, trace.tradEntering - trace.chosenC - trace.rmdAtEntering), color: 'bg-cat-cyan-soft' },
    ];

    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="text-sm text-content-muted mb-3">Spending waterfall</div>
            <div className="text-sm font-mono mb-3">
                <span className="text-content-default">spendingNeed </span>{fmtCurrencyShort(trace.spendingNeed)}
                <span className="text-content-subtle"> + yearTax </span>{fmtCurrencyShort(trace.yearTax)}
                <span className="text-content-subtle"> − cashFromOrdinary </span>{fmtCurrencyShort(trace.cashFromOrdinary)}
                <span className="text-content-subtle"> = gap </span>
                <span className="text-content-bright font-semibold">{fmtCurrencyShort(trace.gap)}</span>
            </div>
            <div className="space-y-2">
                {sources.map(src => {
                    const pct = trace.gap > 0 ? Math.min(1, src.amount / trace.gap) : 0;
                    const capPct = trace.gap > 0 ? Math.min(1, src.cap / trace.gap) : 0;
                    return (
                        <div key={src.label} className="text-xs">
                            <div className="flex items-baseline justify-between mb-1">
                                <div className="text-content-default">
                                    <span className="text-content-subtle">from</span>{' '}
                                    <span className="font-medium">{src.label}</span>:{' '}
                                    <span className="font-mono">{fmtCurrencyShort(src.amount)}</span>
                                </div>
                                <div className="text-content-subtle font-mono">cap {fmtCurrencyShort(src.cap)}</div>
                            </div>
                            <div className="h-2 bg-surface-overlay rounded relative overflow-hidden">
                                <div className={`absolute top-0 left-0 h-full ${src.color}`} style={{ width: `${pct * 100}%` }} />
                                <div className="absolute top-0 h-full border-r border-border-faint" style={{ left: `${capPct * 100}%` }} />
                            </div>
                        </div>
                    );
                })}
            </div>
            {trace.unmetNeed > 0.5 && (
                <div className="mt-3 text-xs bg-negative-tint/20 border border-negative-strong rounded-lg p-3 text-negative">
                    <span className="font-semibold">unmetNeed = {fmtCurrencyShort(trace.unmetNeed)}.</span>{' '}
                    The waterfall couldn't cover the full gap; DP is paying a {fmtCurrencyShort(trace.unmetNeed * 10)} infeasibility penalty for this cell.
                </div>
            )}
            <p className="text-xs text-content-subtle mt-3">
                Sources fire in order: <span className="font-mono">brokerage → roth → trad</span>. Cash from
                ordinary income (wages/SS/pension/RMD) offsets the gap before any account is touched.
                Sourced this year: <span className="font-mono">{fmtCurrencyShort(totalCash)}</span>.
            </p>
        </section>
    );
}

function DPBaselineComparisonSection({ trace }: { trace: DPYearTrace }) {
    // All values are END-of-year so DP and baseline are directly comparable
    // — both reflect the state after this year's growth, conversions, RMDs,
    // and spending under their respective plans.
    const rows: Array<{ label: string; dp: number; baseline: number | undefined; deltaIsBetter: 'lower' | 'higher' }> = [
        { label: 'Trad balance (end of year)', dp: trace.tradNext, baseline: trace.baselineTrad, deltaIsBetter: 'lower' },
        { label: 'Roth balance (end of year)', dp: trace.rothNext, baseline: trace.baselineRoth, deltaIsBetter: 'higher' },
        { label: 'Conversion this year', dp: trace.chosenC, baseline: trace.baselineConversion, deltaIsBetter: 'higher' },
    ];

    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="text-sm text-content-muted mb-2">Comparison to std-ded baseline</div>
            <p className="text-xs text-content-subtle mb-3 leading-relaxed">
                The std-ded baseline is a reference plan that converts only the standard-deduction headroom each year
                (i.e., conversions that incur ~$0 federal tax). It's the "do almost nothing aggressive" trajectory.
                Comparing DP's plan to baseline at this year shows the cumulative effect of every conversion DP has
                done so far. <span className="text-content-default">Lower DP-trad and higher DP-roth = DP has shifted more
                wealth into tax-free.</span>
            </p>
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-content-subtle text-xs border-b border-border-subtle">
                        <th className="text-left py-2 font-normal">Metric</th>
                        <th className="text-right py-2 font-normal">DP plan</th>
                        <th className="text-right py-2 font-normal">Baseline</th>
                        <th className="text-right py-2 font-normal">Δ</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => {
                        const baseline = row.baseline ?? 0;
                        const delta = row.dp - baseline;
                        // Color: green if the delta is in the "better" direction
                        // for that row, yellow otherwise. (Lower trad is better;
                        // higher roth/conversion is more aggressive.)
                        const better = (row.deltaIsBetter === 'lower' ? delta < 0 : delta > 0);
                        const color = delta === 0 ? 'text-content-subtle' : (better ? 'text-positive' : 'text-warning');
                        return (
                            <tr key={row.label} className="border-b border-border-subtle/50">
                                <td className="py-2 text-content-default">{row.label}</td>
                                <td className="py-2 text-right font-mono text-content-emphasis">{fmtCurrencyShort(row.dp)}</td>
                                <td className="py-2 text-right font-mono text-content-muted">
                                    {row.baseline !== undefined ? fmtCurrencyShort(baseline) : '—'}
                                </td>
                                <td className={`py-2 text-right font-mono ${color}`}>
                                    {row.baseline !== undefined ? (delta >= 0 ? '+' : '') + fmtCurrencyShort(delta) : '—'}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </section>
    );
}

function DPInfoSection({ delta }: { delta: number }) {
    const deltaPct = (delta * 100).toFixed(1);
    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="flex items-baseline justify-between mb-2">
                <div className="text-sm text-content-muted">Dynamic-programming algorithm</div>
                <a
                    href="#"
                    onClick={e => e.preventDefault()}
                    className="text-xs text-content-faint font-mono"
                    title="src/services/simulation/RothConversionDP.ts"
                >
                    RothConversionDP.ts
                </a>
            </div>
            <p className="text-content-emphasis text-sm leading-relaxed">
                The DP solves a backward-induction over the full retirement horizon
                with state <span className="font-mono">(year, traditional balance, roth balance)</span>,
                picking the per-year conversion that maximizes after-tax terminal
                wealth. The residual Traditional balance is valued with a bracket-aware
                terminal valuation — at its true graduated exit rate, not a flat
                guess — net of federal + state tax, ACA-cliff penalties, and any
                infeasibility penalty. It runs once per simulation and the per-year
                amounts are looked up below.
            </p>
            <p className="text-content-emphasis text-sm leading-relaxed mt-2">
                The per-year discount factor is <span className="font-mono">1/(1+growthRate)</span>,
                so dollars are compared at a consistent point in time as balances grow.
                The user-facing knob on the Withdrawal tab is the
                <span className="font-semibold text-white"> spend-it-down vs. leave-to-heirs</span>{' '}
                choice (<span className="font-mono">self-liquidate</span> /
                <span className="font-mono"> bequeath</span>), which sets how the
                terminal Traditional balance is valued — not a back-load preference.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                    <div className="text-content-subtle">δ (legacy diagnostic)</div>
                    <div className="text-content-emphasis font-mono">{deltaPct}% / yr</div>
                </div>
                <div>
                    <div className="text-content-subtle">1/(1+δ)</div>
                    <div className="text-content-emphasis font-mono">{(1 / (1 + delta)).toFixed(4)}</div>
                </div>
            </div>
            <p className="text-xs text-content-subtle mt-3">
                δ is a retained diagnostic from the old min-lifetime-tax objective; it
                no longer drives the default after-tax-wealth DP and is not adjustable
                from the Withdrawal tab.
            </p>
        </section>
    );
}

function AggressivenessSection({ minRateGap }: { minRateGap: number }) {
    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="text-sm text-content-muted mb-1">Your aggressiveness setting</div>
            <p className="text-content-emphasis text-sm leading-relaxed">
                <span className="font-semibold text-white">Min rate gap = {fmtPP(minRateGap)}.</span>{' '}
                You're willing to convert a dollar at rate <span className="font-mono">X</span> today only if it
                would otherwise be taxed at <span className="font-mono">X+{fmtPP(minRateGap)}</span> or higher
                at RMD age.
            </p>
            <p className="text-content-subtle text-xs mt-2">
                Lower the gap to do more conversions; raise it to be choosier.
                Adjust on the Withdrawal tab.
            </p>
        </section>
    );
}

function RateMatchWalkSection({ walk }: { walk: RateMatchWalkRow[] }) {
    if (walk.length === 0) {
        return (
            <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
                <div className="text-sm text-content-muted mb-1">Rate-match walk</div>
                <p className="text-content-subtle text-sm">
                    No walk this year — the engine returned early before considering any bracket.
                </p>
            </section>
        );
    }
    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="flex items-baseline justify-between mb-2">
                <div className="text-sm text-content-muted">Rate-match walk</div>
                <a
                    href="#"
                    onClick={e => e.preventDefault()}
                    className="text-xs text-content-faint font-mono"
                    title="src/services/simulation/TaxOptimizedWithdrawal.ts"
                >
                    TaxOptimizedWithdrawal.ts
                </a>
            </div>
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-content-subtle text-xs border-b border-border-subtle">
                        <th className="text-left py-2 font-normal">Bracket</th>
                        <th className="text-right py-2 font-normal">Today</th>
                        <th className="text-right py-2 font-normal">RMD-age</th>
                        <th className="text-right py-2 font-normal">Gap</th>
                        <th className="text-left py-2 pl-3 font-normal">Decision</th>
                        <th className="text-right py-2 font-normal">Cumulative</th>
                    </tr>
                </thead>
                <tbody>
                    {walk.map((row, i) => {
                        const isStop = row.decision === 'stop';
                        const isStdDed = row.currentRate === 0 && row.chunkStart < 0;
                        const bracketLabel = isStdDed
                            ? `Std deduction (${fmtCurrencyShort(row.chunkSize)})`
                            : `${fmtPct(row.currentRate)} bracket`;
                        return (
                            <tr
                                key={i}
                                className={`border-b border-border-subtle/50 ${isStop ? 'bg-warning-tint/10' : ''}`}
                            >
                                <td className="py-2 text-content-default">{bracketLabel}</td>
                                <td className="py-2 text-right font-mono text-content-default">{fmtPct(row.currentRate)}</td>
                                <td className="py-2 text-right font-mono text-content-default">{fmtPct(row.futureMarginal)}</td>
                                <td className="py-2 text-right font-mono text-content-default">{fmtPP(row.gap)}</td>
                                <td className="py-2 pl-3">
                                    {isStop ? (
                                        <span className="text-warning">✗ stop</span>
                                    ) : (
                                        <span className="text-positive">✓ convert</span>
                                    )}
                                </td>
                                <td className="py-2 text-right font-mono text-content-default">
                                    {row.decision === 'convert' ? fmtCurrencyShort(row.cumulative) : '—'}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <p className="text-xs text-content-subtle mt-3">
                For each bracket, the engine compares today's marginal rate to the rate the same dollar
                would face as an RMD years from now. If the gap is below your threshold, it stops.
            </p>
        </section>
    );
}

function ConstraintAdjustmentsSection({
    target,
}: {
    target: NonNullable<SimulationYear['taxOptimizationTarget']>;
}) {
    const c = target.constraintDetails;
    const adjustments: { label: string; detail: string }[] = [];

    if (c?.ssTorpedoTriggered && c.ssTorpedoReduction > 0) {
        adjustments.push({
            label: 'SS torpedo',
            detail: `${fmtCurrencyShort(c.ssTorpedoReduction)} of bracket space lost — converting more pushes Social Security into taxability.`,
        });
    }
    if (c?.acaCliffTriggered && c.acaCliffReduction > 0) {
        const threshold = c.acaCliffThreshold ? ` (cliff at MAGI ${fmtCurrencyShort(c.acaCliffThreshold)})` : '';
        adjustments.push({
            label: 'ACA cliff',
            detail: `${fmtCurrencyShort(c.acaCliffReduction)} reserved to avoid losing premium tax credits${threshold}.`,
        });
    }
    if (target.limitingFactor === 'SPENDING_DEFICIT') {
        adjustments.push({
            label: 'Spending withdrawals',
            detail: 'This year\'s bracket space was already used by Traditional withdrawals for spending.',
        });
    }

    if (adjustments.length === 0) {
        return (
            <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
                <div className="text-sm text-content-muted mb-1">Constraint adjustments</div>
                <p className="text-content-subtle text-sm">No constraints fired this year.</p>
            </section>
        );
    }

    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="text-sm text-content-muted mb-2">Constraint adjustments</div>
            <ul className="space-y-2">
                {adjustments.map((a, i) => (
                    <li key={i} className="text-sm">
                        <span className="text-cat-orange font-medium">{a.label}:</span>{' '}
                        <span className="text-content-default">{a.detail}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function TrajectorySection({
    target,
    floor,
    rmdYear,
}: {
    target: NonNullable<SimulationYear['taxOptimizationTarget']>;
    floor: ZeroTaxFloor | null;
    rmdYear: number;
}) {
    const projected = target.projectedBalanceAtRMD ?? 0;

    let status: { label: string; color: string; detail: string };
    if (floor === null) {
        status = {
            label: 'Floor unavailable',
            color: 'text-content-muted',
            detail: 'Could not compute the zero-tax floor for the RMD year.',
        };
    } else if (projected <= floor.floor) {
        status = {
            label: 'Below zero-tax floor',
            color: 'text-positive',
            detail: 'Your first RMD year will owe no federal tax on the RMD itself.',
        };
    } else {
        const excess = projected - floor.floor;
        status = {
            label: `${fmtCurrencyShort(excess)} above floor`,
            color: 'text-warning',
            detail: `First RMD year: roughly ${fmtCurrencyShort(excess / floor.rmdDivisor)} of the RMD will land in a taxable bracket.`,
        };
    }

    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="text-sm text-content-muted mb-3">Trajectory check (at RMD year {rmdYear})</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-surface-overlay/60 rounded-lg p-3">
                    <div className="text-xs text-content-subtle">Projected Trad @ RMD</div>
                    <div className="text-xl font-bold text-content-bright">{fmtCurrencyShort(projected)}</div>
                    <div className="text-xs text-content-subtle mt-1">Where the current trajectory lands.</div>
                </div>
                <div className="bg-surface-overlay/60 rounded-lg p-3">
                    <div className="text-xs text-content-subtle">Zero-tax floor</div>
                    <div className="text-xl font-bold text-content-bright">{floor !== null ? fmtCurrencyShort(floor.floor) : '—'}</div>
                    <div className="text-xs text-content-subtle mt-1">Trad balance at which RMD owes $0 federal.</div>
                </div>
            </div>
            <div className={`text-sm font-medium ${status.color}`}>{status.label}</div>
            <div className="text-xs text-content-muted mt-1">{status.detail}</div>
            {floor && (
                <div className="mt-4 text-xs text-content-subtle leading-relaxed">
                    <div className="text-content-muted mb-1">Floor formula:</div>
                    <div className="font-mono">
                        max RMD = {fmtCurrencyShort(floor.stdDeduction)} (std ded) − {fmtCurrencyShort(floor.taxableSS)} (85% × SS) − {fmtCurrencyShort(floor.pension)} (pension) = {fmtCurrencyShort(floor.maxRMD)}
                    </div>
                    <div className="font-mono mt-1">
                        floor = max RMD × {floor.rmdDivisor} (RMD divisor at age {target.rmdStartAge}) = {fmtCurrencyShort(floor.floor)}
                    </div>
                </div>
            )}
        </section>
    );
}

function ConceptReferenceSection() {
    const concepts = [
        {
            title: 'The rate-match walk',
            body: 'For each bracket of taxable income, compare today\'s marginal rate to what the same dollar would be taxed at as an RMD. Convert if the gap is at least your threshold; stop otherwise.',
            ref: 'src/services/simulation/TaxOptimizedWithdrawal.ts',
        },
        {
            title: 'Limiting factors',
            body: 'Records why this year\'s conversion stopped: bracket ceiling reached, SS torpedo, ACA cliff, no balance left, or already at RMD age.',
            ref: 'src/services/simulation/types.ts',
        },
        {
            title: 'SS torpedo',
            body: 'Up to 85% of Social Security becomes taxable as ordinary income above provisional-income thresholds. Conversions can push more SS into taxability, raising the effective rate sharply.',
            ref: 'src/components/Objects/Taxes/TaxService.ts',
        },
        {
            title: 'ACA cliff',
            body: 'Premium tax credits phase out gradually but tip over a cliff at 400% FPL. Conversions that push MAGI over the cliff can lose $5k–$15k+ in subsidies in one dollar.',
            ref: 'src/services/simulation/TaxOptimizedWithdrawal.ts',
        },
        {
            title: 'Zero-tax floor',
            body: 'Pedagogical reference (debug page only): the Traditional balance whose first-year RMD, combined with taxable SS and pension, stays under the standard deduction → $0 federal tax. Uses an 85% taxable-SS approximation.',
            ref: 'src/tabs/Testing/RothConversionDebug.tsx',
        },
    ];
    return (
        <section className="bg-surface-raised rounded-xl border border-border-subtle p-5">
            <div className="text-sm text-content-muted mb-2">Concept reference</div>
            <details className="group">
                <summary className="cursor-pointer text-sm text-content-subtle hover:text-content-default select-none">
                    Expand all concepts ({concepts.length})
                </summary>
                <div className="mt-3 space-y-3">
                    {concepts.map(c => (
                        <details key={c.title} className="bg-surface-overlay/40 rounded p-3">
                            <summary className="cursor-pointer text-sm text-content-emphasis font-medium select-none">{c.title}</summary>
                            <p className="text-xs text-content-muted mt-2 leading-relaxed">{c.body}</p>
                            <p className="text-xs text-content-faint font-mono mt-2">{c.ref}</p>
                        </details>
                    ))}
                </div>
            </details>
        </section>
    );
}

export default function RothConversionDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation } = useContext(SimulationContext);
    const { state: taxState } = useContext(TaxContext);

    const birthYear = getBirthYear(assumptions.milestones);
    const retirementAge = getRetirementAge(assumptions.milestones);
    const retirementYear = birthYear + retirementAge;
    const rmdStartAge = getRMDStartAge(birthYear);
    const rmdYear = birthYear + rmdStartAge;
    const minRateGap = assumptions.investments?.rothConversionMinRateGap ?? 0.05;
    const effectiveBackloadDelta = assumptions.investments?.rothConversionDPBackloadDelta ?? DP_BACKLOAD_DELTA;
    const strategy = assumptions.investments?.rothConversionStrategy ?? 'dp-precomputed';

    // Filter to relevant years (retirement → pre-RMD).
    const relevantYears = useMemo(
        () => simulation.filter(y => isConversionRelevantYear(y, retirementYear, rmdYear)),
        [simulation, retirementYear, rmdYear],
    );

    // All DP traces across the simulation (for the macro summary section).
    // DP horizon may extend through RMD years, so we don't filter to
    // relevantYears here.
    const dpTraces = useMemo(
        () => simulation
            .map(y => y.dpTrace)
            .filter((t): t is DPYearTrace => t !== undefined),
        [simulation],
    );

    // Sparkline data: trad balance trajectory across the relevant window.
    const sparkData = useMemo(
        () => relevantYears.map(y => ({
            year: y.year,
            balance: y.taxOptimizationTarget?.currentTraditionalBalance ?? 0,
        })),
        [relevantYears],
    );

    // Default-select the first year with a non-zero conversion, falling back to first relevant year.
    const defaultYear = useMemo(() => {
        const firstConverted = relevantYears.find(y => (y.rothConversion?.amount ?? 0) > 0);
        return firstConverted?.year ?? relevantYears[0]?.year ?? null;
    }, [relevantYears]);

    const [selectedYearNumber, setSelectedYearNumber] = useState<number | null>(null);
    const effectiveSelected = selectedYearNumber ?? defaultYear;
    const selectedYear = useMemo(
        () => relevantYears.find(y => y.year === effectiveSelected) ?? null,
        [relevantYears, effectiveSelected],
    );

    const target = selectedYear?.taxOptimizationTarget;
    const floor = useMemo(() => {
        if (!target) return null;
        return computeZeroTaxFloor(
            target,
            rmdYear,
            taxState.filingStatus,
            taxState.stateResidency,
            assumptions,
        );
    }, [target, rmdYear, taxState.filingStatus, taxState.stateResidency, assumptions]);

    if (relevantYears.length === 0) {
        return (
            <Panel padding="none" className="p-8 text-center">
                <p className="text-content-default font-medium">No retirement-onward years in the simulation.</p>
                <p className="text-content-subtle text-sm mt-2">
                    Run a simulation that reaches retirement age to inspect Roth conversions.
                </p>
            </Panel>
        );
    }

    const age = selectedYear ? selectedYear.year - birthYear : 0;
    const convertedAmount = selectedYear?.rothConversion?.amount ?? target?.actualConversion ?? 0;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 items-stretch">
            {/* Left rail: year picker + sparkline */}
            <Panel padding="sm" className="flex flex-col gap-3 min-h-0">
                <YearSparkline
                    years={sparkData}
                    selectedYear={effectiveSelected ?? -1}
                    onSelect={setSelectedYearNumber}
                />
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-content-subtle border-b border-border-subtle sticky top-0 bg-surface-raised">
                                <th className="text-left py-2 font-normal">Year</th>
                                <th className="text-right py-2 font-normal">Age</th>
                                <th className="text-right py-2 font-normal">Conv.</th>
                                <th className="text-left py-2 pl-2 font-normal">Limit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {relevantYears.map(y => {
                                const isSel = y.year === effectiveSelected;
                                const conv = y.rothConversion?.amount ?? 0;
                                const factor = y.taxOptimizationTarget?.limitingFactor;
                                return (
                                    <tr
                                        key={y.year}
                                        onClick={() => setSelectedYearNumber(y.year)}
                                        className={`cursor-pointer border-b border-border-subtle/40 ${isSel ? 'bg-cat-fuchsia-tint/30' : 'hover:bg-surface-overlay/40'}`}
                                    >
                                        <td className="py-1 text-content-default">{y.year}</td>
                                        <td className="py-1 text-right text-content-muted">{y.year - birthYear}</td>
                                        <td className={`py-1 text-right font-mono ${conv > 0 ? 'text-cat-fuchsia' : 'text-content-faint'}`}>
                                            {conv > 0 ? fmtCurrencyShort(conv) : '—'}
                                        </td>
                                        <td className="py-1 pl-2 text-content-subtle truncate max-w-[80px]" title={limitingFactorLabel(factor)}>
                                            {limitingFactorLabel(factor)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Panel>

            {/* Right pane: drill-down sections */}
            <div className="space-y-4">
                {selectedYear && target ? (
                    <>
                        <HeadlineSection
                            year={selectedYear.year}
                            age={age}
                            convertedAmount={convertedAmount}
                            reason={headlineReason(selectedYear, strategy)}
                            target={target}
                        />
                        {strategy === 'dp-precomputed' ? (
                            selectedYear.dpTrace ? (
                                <>
                                    <DPPlanSummarySection traces={dpTraces} birthYear={birthYear} />
                                    <DPHeadlineSection trace={selectedYear.dpTrace} />
                                    <DPCostCurveSection trace={selectedYear.dpTrace} />
                                    <DPRateAnalysisSection trace={selectedYear.dpTrace} />
                                    <DPStateFlowSection trace={selectedYear.dpTrace} />
                                    <DPWaterfallSection trace={selectedYear.dpTrace} />
                                    <DPBaselineComparisonSection trace={selectedYear.dpTrace} />
                                    <DPInfoSection delta={effectiveBackloadDelta} />
                                </>
                            ) : (
                                <DPInfoSection delta={effectiveBackloadDelta} />
                            )
                        ) : (
                            <>
                                <AggressivenessSection minRateGap={minRateGap} />
                                <RateMatchWalkSection walk={target.rateMatchWalk ?? []} />
                            </>
                        )}
                        <ConstraintAdjustmentsSection target={target} />
                        <TrajectorySection target={target} floor={floor} rmdYear={rmdYear} />
                        <ConceptReferenceSection />
                    </>
                ) : (
                    <Panel padding="none" className="p-8 text-center">
                        <p className="text-content-muted">Select a year from the left to inspect.</p>
                    </Panel>
                )}
            </div>
        </div>
    );
}
