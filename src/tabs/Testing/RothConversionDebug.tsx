import { useState, useMemo, useContext } from 'react';
import { AssumptionsContext, AssumptionsState, getBirthYear, getRetirementAge } from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { getTaxParameters } from '../../components/Objects/Taxes/TaxService';
import { FilingStatus } from '../../data/TaxData';
import { getRMDStartAge, getDistributionPeriod } from '../../data/RMDData';
import { SimulationYear, RateMatchWalkRow, ConversionLimitingFactor } from '../../services/simulation/types';
import { DP_BACKLOAD_DELTA } from '../../services/simulation/RothConversionDP';

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
        default: return '—';
    }
}

function headlineReason(year: SimulationYear, strategy: 'rate-match' | 'dp-precomputed'): string {
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
            <div className="text-xs text-gray-500 mb-1">Traditional balance over time</div>
            <svg width={w} height={h} className="overflow-visible">
                <path d={path} stroke="#a78bfa" strokeWidth={1.5} fill="none" />
                {selected && (
                    <circle
                        cx={xScale(selected.year)}
                        cy={yScale(selected.balance)}
                        r={3.5}
                        fill="#f472b6"
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
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="text-sm text-gray-400 mb-1">Headline</div>
            <p className="text-gray-100 text-base leading-relaxed">
                In <span className="font-semibold text-white">{year}</span> (age <span className="font-semibold text-white">{age}</span>),
                the engine converted <span className="font-bold text-fuchsia-400">{fmtCurrency(convertedAmount)}</span> because {reason}.
            </p>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                    <div className="text-gray-500">Trad balance (start)</div>
                    <div className="text-gray-200 font-medium">{fmtCurrencyShort(target.currentTraditionalBalance ?? 0)}</div>
                </div>
                <div>
                    <div className="text-gray-500">AGI before conversion</div>
                    <div className="text-gray-200 font-medium">{fmtCurrencyShort(target.constraintDetails?.currentAGI ?? 0)}</div>
                </div>
                <div>
                    <div className="text-gray-500">Reached bracket</div>
                    <div className="text-gray-200 font-medium">{fmtPct(target.targetBracketCeiling)}</div>
                </div>
                <div>
                    <div className="text-gray-500">Limiting factor</div>
                    <div className="text-gray-200 font-medium">{limitingFactorLabel(target.limitingFactor)}</div>
                </div>
            </div>
        </section>
    );
}

function DPInfoSection() {
    const deltaPct = (DP_BACKLOAD_DELTA * 100).toFixed(1);
    return (
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="flex items-baseline justify-between mb-2">
                <div className="text-sm text-gray-400">Dynamic-programming algorithm</div>
                <a
                    href="#"
                    onClick={e => e.preventDefault()}
                    className="text-xs text-gray-600 font-mono"
                    title="src/services/simulation/RothConversionDP.ts"
                >
                    RothConversionDP.ts
                </a>
            </div>
            <p className="text-gray-200 text-sm leading-relaxed">
                The DP solves a backward-induction over the full retirement horizon
                with state <span className="font-mono">(year, traditional balance)</span>,
                picking the per-year conversion that minimizes total lifetime tax
                (federal + state + ACA-cliff penalty). It runs once per simulation
                and the per-year amounts are looked up below.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                    <div className="text-gray-500">Back-load preference δ</div>
                    <div className="text-gray-200 font-mono">{deltaPct}% / yr</div>
                </div>
                <div>
                    <div className="text-gray-500">Discount factor</div>
                    <div className="text-gray-200 font-mono">{(1 / (1 + DP_BACKLOAD_DELTA)).toFixed(4)}</div>
                </div>
            </div>
            <p className="text-xs text-gray-500 mt-3">
                δ &gt; 0 makes future tax look slightly cheaper than present tax, biasing
                the plan toward later conversions at the cost of some lifetime-tax
                efficiency. δ = 0 is lifetime-optimal (mildly front-loaded). Tune in
                <span className="font-mono"> RothConversionDP.ts</span>.
            </p>
        </section>
    );
}

function AggressivenessSection({ minRateGap }: { minRateGap: number }) {
    return (
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="text-sm text-gray-400 mb-1">Your aggressiveness setting</div>
            <p className="text-gray-200 text-sm leading-relaxed">
                <span className="font-semibold text-white">Min rate gap = {fmtPP(minRateGap)}.</span>{' '}
                You're willing to convert a dollar at rate <span className="font-mono">X</span> today only if it
                would otherwise be taxed at <span className="font-mono">X+{fmtPP(minRateGap)}</span> or higher
                at RMD age.
            </p>
            <p className="text-gray-500 text-xs mt-2">
                Lower the gap to do more conversions; raise it to be choosier.
                Adjust on the Withdrawal tab.
            </p>
        </section>
    );
}

function RateMatchWalkSection({ walk }: { walk: RateMatchWalkRow[] }) {
    if (walk.length === 0) {
        return (
            <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
                <div className="text-sm text-gray-400 mb-1">Rate-match walk</div>
                <p className="text-gray-500 text-sm">
                    No walk this year — the engine returned early before considering any bracket.
                </p>
            </section>
        );
    }
    return (
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="flex items-baseline justify-between mb-2">
                <div className="text-sm text-gray-400">Rate-match walk</div>
                <a
                    href="#"
                    onClick={e => e.preventDefault()}
                    className="text-xs text-gray-600 font-mono"
                    title="src/services/simulation/TaxOptimizedWithdrawal.ts"
                >
                    TaxOptimizedWithdrawal.ts
                </a>
            </div>
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-gray-500 text-xs border-b border-gray-800">
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
                                className={`border-b border-gray-800/50 ${isStop ? 'bg-yellow-900/10' : ''}`}
                            >
                                <td className="py-2 text-gray-300">{bracketLabel}</td>
                                <td className="py-2 text-right font-mono text-gray-300">{fmtPct(row.currentRate)}</td>
                                <td className="py-2 text-right font-mono text-gray-300">{fmtPct(row.futureMarginal)}</td>
                                <td className="py-2 text-right font-mono text-gray-300">{fmtPP(row.gap)}</td>
                                <td className="py-2 pl-3">
                                    {isStop ? (
                                        <span className="text-yellow-400">✗ stop</span>
                                    ) : (
                                        <span className="text-green-400">✓ convert</span>
                                    )}
                                </td>
                                <td className="py-2 text-right font-mono text-gray-300">
                                    {row.decision === 'convert' ? fmtCurrencyShort(row.cumulative) : '—'}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <p className="text-xs text-gray-500 mt-3">
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
            <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
                <div className="text-sm text-gray-400 mb-1">Constraint adjustments</div>
                <p className="text-gray-500 text-sm">No constraints fired this year.</p>
            </section>
        );
    }

    return (
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="text-sm text-gray-400 mb-2">Constraint adjustments</div>
            <ul className="space-y-2">
                {adjustments.map((a, i) => (
                    <li key={i} className="text-sm">
                        <span className="text-orange-400 font-medium">{a.label}:</span>{' '}
                        <span className="text-gray-300">{a.detail}</span>
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
            color: 'text-gray-400',
            detail: 'Could not compute the zero-tax floor for the RMD year.',
        };
    } else if (projected <= floor.floor) {
        status = {
            label: 'Below zero-tax floor',
            color: 'text-green-400',
            detail: 'Your first RMD year will owe no federal tax on the RMD itself.',
        };
    } else {
        const excess = projected - floor.floor;
        status = {
            label: `${fmtCurrencyShort(excess)} above floor`,
            color: 'text-yellow-400',
            detail: `First RMD year: roughly ${fmtCurrencyShort(excess / floor.rmdDivisor)} of the RMD will land in a taxable bracket.`,
        };
    }

    return (
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="text-sm text-gray-400 mb-3">Trajectory check (at RMD year {rmdYear})</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-gray-800/60 rounded-lg p-3">
                    <div className="text-xs text-gray-500">Projected Trad @ RMD</div>
                    <div className="text-xl font-bold text-gray-100">{fmtCurrencyShort(projected)}</div>
                    <div className="text-xs text-gray-500 mt-1">Where the current trajectory lands.</div>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-3">
                    <div className="text-xs text-gray-500">Zero-tax floor</div>
                    <div className="text-xl font-bold text-gray-100">{floor !== null ? fmtCurrencyShort(floor.floor) : '—'}</div>
                    <div className="text-xs text-gray-500 mt-1">Trad balance at which RMD owes $0 federal.</div>
                </div>
            </div>
            <div className={`text-sm font-medium ${status.color}`}>{status.label}</div>
            <div className="text-xs text-gray-400 mt-1">{status.detail}</div>
            {floor && (
                <div className="mt-4 text-xs text-gray-500 leading-relaxed">
                    <div className="text-gray-400 mb-1">Floor formula:</div>
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
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="text-sm text-gray-400 mb-2">Concept reference</div>
            <details className="group">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-300 select-none">
                    Expand all concepts ({concepts.length})
                </summary>
                <div className="mt-3 space-y-3">
                    {concepts.map(c => (
                        <details key={c.title} className="bg-gray-800/40 rounded p-3">
                            <summary className="cursor-pointer text-sm text-gray-200 font-medium select-none">{c.title}</summary>
                            <p className="text-xs text-gray-400 mt-2 leading-relaxed">{c.body}</p>
                            <p className="text-xs text-gray-600 font-mono mt-2">{c.ref}</p>
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
    const strategy = assumptions.investments?.rothConversionStrategy ?? 'rate-match';

    // Filter to relevant years (retirement → pre-RMD).
    const relevantYears = useMemo(
        () => simulation.filter(y => isConversionRelevantYear(y, retirementYear, rmdYear)),
        [simulation, retirementYear, rmdYear],
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
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
                <p className="text-gray-300 font-medium">No retirement-onward years in the simulation.</p>
                <p className="text-gray-500 text-sm mt-2">
                    Run a simulation that reaches retirement age to inspect Roth conversions.
                </p>
            </div>
        );
    }

    const age = selectedYear ? selectedYear.year - birthYear : 0;
    const convertedAmount = selectedYear?.rothConversion?.amount ?? target?.actualConversion ?? 0;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 items-stretch">
            {/* Left rail: year picker + sparkline */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex flex-col gap-3 min-h-0">
                <YearSparkline
                    years={sparkData}
                    selectedYear={effectiveSelected ?? -1}
                    onSelect={setSelectedYearNumber}
                />
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-gray-500 border-b border-gray-800 sticky top-0 bg-gray-900">
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
                                        className={`cursor-pointer border-b border-gray-800/40 ${isSel ? 'bg-fuchsia-900/30' : 'hover:bg-gray-800/40'}`}
                                    >
                                        <td className="py-1 text-gray-300">{y.year}</td>
                                        <td className="py-1 text-right text-gray-400">{y.year - birthYear}</td>
                                        <td className={`py-1 text-right font-mono ${conv > 0 ? 'text-fuchsia-400' : 'text-gray-600'}`}>
                                            {conv > 0 ? fmtCurrencyShort(conv) : '—'}
                                        </td>
                                        <td className="py-1 pl-2 text-gray-500 truncate max-w-[80px]" title={limitingFactorLabel(factor)}>
                                            {limitingFactorLabel(factor)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

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
                            <DPInfoSection />
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
                    <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
                        <p className="text-gray-400">Select a year from the left to inspect.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
