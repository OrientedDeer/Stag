/**
 * Roth-conversion plan-scoring harness (cookbook review, Wave-1 foundation).
 *
 * THE CANONICAL RULER. Every agent and any future implementation scores conversion
 * plans through this one module so the whole team measures with the same instrument.
 * It makes the cookbook's three validation tools real against the TRUSTED forward
 * engine (`runSimulation`):
 *
 *   1. scorePlan       — run an exact per-year conversion schedule through the engine
 *                        and read REAL terminal metrics, valuing residual Traditional
 *                        with ONE consistent situation-based ruler (see below).
 *   2. stdDedOnlyPlan  — the feasibility-floor baseline (convert only standard-deduction
 *                        headroom each year).
 *   3. feasibilityFloor— candidate ≥ std-ded-only on the chosen objective? (the gap).
 *   4. scalingSweep    — scale a base plan by a common factor and find the argmax;
 *                        flag whether the base sits at an INTERIOR peak.
 *
 * HOW THE ENGINE EXECUTES A PLAN (verified — see harness.md "Execution proof"):
 *   runSimulation(years, accts, incomes, expenses, assumptions, taxState, undefined, {
 *       dpConversionPlan: Map<absoluteYear, dollars>,
 *   })
 *   threads the plan untouched → runSimulationLoop → simulateOneYear → solveYear →
 *   YearSolver.planConversionDP, which at YearSolver.ts:1200 reads
 *   `input.dpConversionPlan?.get(input.year) ?? 0` and at :1230 executes
 *   `max(0, min(plannedAmount, traditionalBalance − bracketSpaceReservedForSpending))`.
 *   The engine executes your EXACT schedule (clamped only by available Traditional,
 *   minus any bracket space it reserves for Traditional SPENDING). It does NOT re-decide.
 *
 *   REQUIRED so the executor is `planConversionDP` (not the legacy rate-match walker):
 *     - assumptions.investments.rothConversionStrategy = 'dp-precomputed'
 *       (selectConversionStrategy, YearSolver.ts:186, dispatches on this via
 *        resolveRothConversionStrategy; the harness builders set it.)
 *     - assumptions.investments.taxOptimizationEnabled = true
 *       (else planConversionDP early-returns 'OPTIMIZATION_DISABLED', YearSolver.ts:1122)
 *     - the household must be RETIRED in the conversion years
 *       (else 'NOT_RETIRED', YearSolver.ts:1122)
 *     - options.mcConversionPolicy MUST be left undefined (a policy would OVERRIDE the
 *       per-year plan lookup, YearSolver.ts:1203). The harness never sets it.
 *
 * THE RULER (terminal after-tax net worth). This is the load-bearing choice; the
 * cookbook's "use one consistent ruler" is the whole point of the harness. We reuse
 * the production helpers `buildTradValuation` + `terminalAfterTaxNetWorth`
 * (src/tabs/Future/tabs/FutureUtils.tsx), which implement exactly the defensible
 * valuation the brief asks for:
 *
 *   - Residual Traditional is valued at its TRUE self-liquidation exit cost:
 *     `bracketAwareTradExitValue` draws the terminal balance down post-horizon on the
 *     real RMD schedule through the real TaxService brackets, STACKED ON the household's
 *     persisting late-life Social Security + fixed income (so the SS torpedo is priced
 *     in), discounted back at the growth rate. Std-deduction slice exits at 0%, the rest
 *     climbs brackets — a GRADUATED rate, not a flat haircut.
 *   - Brokerage / ESPP / RSU unrealized gains are docked at a representative 15% LTCG.
 *   - Roth / HSA / cash / property are taken at face.
 *
 *   CRITICAL — ONE ruler for every plan. `buildTradValuation` is built ONCE from the
 *   strategy-independent std-ded-only baseline timeline (its terminal age + persisting
 *   income), then applied identically to the candidate, the baseline, and every scaled
 *   variant. The exit valuation is a property of the household's SITUATION, not of which
 *   plan produced the balance — so scores are apples-to-apples and a plan can never flatter
 *   itself with a more generous ruler than reality (the cookbook's explicit warning).
 *
 * READ-ONLY on production source: this file only consumes exported functions.
 */

import { type AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { type AnyIncome, FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { type AnyExpense, FoodExpense } from '../../components/Objects/Expense/models';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
    getBirthYear,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../components/Objects/Taxes/TaxContext';
import { type SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import {
    buildTradValuation,
    terminalAfterTaxNetWorth,
    getAccountTotals,
} from '../../tabs/Future/tabs/FutureUtils';
import * as TaxService from '../../components/Objects/Taxes/TaxService';

// ---------------------------------------------------------------------------
// Scenario shape
// ---------------------------------------------------------------------------

/** A self-contained household + simulation horizon. Everything `runSimulation` needs. */
export interface Scenario {
    accounts: AnyAccount[];
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    assumptions: AssumptionsState;
    taxState: TaxState;
    yearsToRun: number;
}

/** A conversion plan: absolute simulation YEAR (e.g. 2030) → dollars to convert that year. */
export type ConversionPlan = Map<number, number>;

// ---------------------------------------------------------------------------
// scorePlan — the core ruler
// ---------------------------------------------------------------------------

export interface PlanScore {
    /** Terminal (last real year) after-tax net worth under the ONE consistent ruler. */
    terminalAfterTaxNW: number;
    /** Terminal nominal net worth (assets − liabilities), pre-ruler — for reconciliation. */
    terminalNominalNW: number;
    /** Terminal aggregate Traditional (401k + IRA) balance. */
    terminalTradBalance: number;
    /** Terminal aggregate Roth (401k + IRA) balance. */
    terminalRothBalance: number;
    /** Terminal aggregate taxable-brokerage balance. */
    terminalBrokerage: number;
    /** Sum of federal + state + FICA + NIIT tax across all real years. */
    lifetimeTax: number;
    /** Did the plan deplete spendable assets before the horizon? */
    ranOutOfMoney: boolean;
    /** Total dollars actually converted across all years (after engine clamping). */
    totalConverted: number;
    /** The full timeline the score was read from (real + EOY-projection rows). */
    timeline: SimulationYear[];
}

const TRAD_TAX_TYPES = new Set(['Traditional 401k', 'Traditional IRA']);
const ROTH_TAX_TYPES = new Set(['Roth 401k', 'Roth IRA']);

function sumByTaxType(accounts: AnyAccount[], taxTypes: Set<string>): number {
    let total = 0;
    for (const acc of accounts) {
        if (acc instanceof InvestedAccount && taxTypes.has(acc.taxType)) total += acc.amount;
    }
    return total;
}

/** The real years (drop the synthetic EOY projection rows the engine appends). */
export function realYears(timeline: SimulationYear[]): SimulationYear[] {
    return timeline.filter(y => !y.isEndOfYearProjection);
}

/**
 * Run `plan` through the real engine and return REAL terminal metrics.
 *
 * The ruler used for `terminalAfterTaxNW` is built from `rulerSource` when supplied
 * (the strategy-independent std-ded-only baseline timeline), otherwise from this plan's
 * own timeline. Callers that compare multiple plans (feasibilityFloor, scalingSweep)
 * MUST pass a single shared `rulerSource` so every plan is scored with the SAME ruler —
 * the helpers in this module do exactly that.
 */
export function scorePlan(
    scenario: Scenario,
    plan: ConversionPlan,
    rulerSource?: SimulationYear[],
): PlanScore {
    const timeline = runSimulation(
        scenario.yearsToRun,
        scenario.accounts,
        scenario.incomes,
        scenario.expenses,
        scenario.assumptions,
        scenario.taxState,
        undefined,
        { dpConversionPlan: plan },
    );

    const reals = realYears(timeline);
    const last = reals[reals.length - 1];

    // The ruler: built ONCE from the strategy-independent source when provided.
    const ruler = buildTradValuation(rulerSource ?? timeline, scenario.assumptions, scenario.taxState);
    const terminalAfterTaxNW = terminalAfterTaxNetWorth(timeline, ruler);

    const terminalAccounts = last ? last.accounts : [];
    const terminalNominalNW = last ? getAccountTotals(terminalAccounts).netWorth : 0;

    let lifetimeTax = 0;
    let totalConverted = 0;
    let ranOutOfMoney = false;
    for (const y of reals) {
        const td = y.taxDetails;
        lifetimeTax += (td.fed ?? 0) + (td.state ?? 0) + (td.fica ?? 0) + (td.niit ?? 0);
        totalConverted += y.rothConversion?.amount ?? 0;
        // "Ran out" = spendable (non-property, non-debt) assets hit ~zero in a real year.
        const spendable = y.accounts.reduce((s, a) => {
            if (a instanceof InvestedAccount || a instanceof SavedAccount) return s + a.amount;
            return s;
        }, 0);
        if (spendable <= 1) ranOutOfMoney = true;
    }

    return {
        terminalAfterTaxNW,
        terminalNominalNW,
        terminalTradBalance: sumByTaxType(terminalAccounts, TRAD_TAX_TYPES),
        terminalRothBalance: sumByTaxType(terminalAccounts, ROTH_TAX_TYPES),
        terminalBrokerage: terminalAccounts
            .filter((a): a is InvestedAccount => a instanceof InvestedAccount && a.taxType === 'Brokerage')
            .reduce((s, a) => s + a.amount, 0),
        lifetimeTax,
        ranOutOfMoney,
        totalConverted,
        timeline,
    };
}

// ---------------------------------------------------------------------------
// Per-year executed-conversion readout (for the execution proof)
// ---------------------------------------------------------------------------

/** Map of absolute year → dollars the engine ACTUALLY converted (post-clamp). */
export function executedConversionsByYear(timeline: SimulationYear[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const y of realYears(timeline)) {
        out.set(y.year, y.rothConversion?.amount ?? 0);
    }
    return out;
}

// ---------------------------------------------------------------------------
// stdDedOnlyPlan — the feasibility-floor baseline
// ---------------------------------------------------------------------------

/**
 * Build the standard-deduction-headroom plan: each retired pre-RMD year, convert up to
 * the federal standard deduction MINUS the year's other ordinary income (so the conversion
 * fills the always-free 0% slice and no further). This is a perfectly feasible plan and the
 * cookbook's concrete feasibility-floor witness.
 *
 * METHOD (documented): we run a ZERO-conversion baseline first to read each real year's
 * ordinary income (gross income minus Social Security, the same non-SS ordinary base the
 * solver fills), then headroom = max(0, stdDeduction − nonSSOrdinary). We deliberately
 * compute headroom against the engine's own per-year income rather than re-deriving it, so
 * the baseline tracks the same brackets the engine will see. Conversions are scheduled only
 * in retired years before RMDs begin (RMDs themselves consume the low brackets), matching the
 * "gap years" the brief calls the workhorse window.
 *
 * Note: the engine ALSO offers conversionMode:'std-ded-only' natively, but that path needs
 * the rate-match strategy; here we want an explicit dp-precomputed PLAN so the floor is scored
 * through the identical executor as every candidate. The two agree to within rounding; we use
 * the explicit plan for ruler-consistency.
 */
export function stdDedOnlyPlan(scenario: Scenario): ConversionPlan {
    const plan: ConversionPlan = new Map();

    // Zero-conversion baseline to read per-year income + ages.
    const zero = runSimulation(
        scenario.yearsToRun,
        scenario.accounts,
        scenario.incomes,
        scenario.expenses,
        scenario.assumptions,
        scenario.taxState,
        undefined,
        { dpConversionPlan: new Map() },
    );

    const birthYear = getBirthYear(scenario.assumptions.milestones);
    const retireAge = retirementAgeOf(scenario.assumptions);
    const rmdStartAge = rmdStartAgeFor(birthYear);
    const fs = scenario.taxState.filingStatus;

    for (const y of realYears(zero)) {
        const age = y.year - birthYear;
        if (age < retireAge || age >= rmdStartAge) continue; // gap years only

        const fedParams = TaxService.getTaxParameters(y.year, fs, 'federal', undefined, scenario.assumptions);
        if (!fedParams) continue;
        const stdDed = fedParams.standardDeduction || 0;

        // Non-SS ordinary income already present this year (wages have stopped in
        // retirement; this is interest / pension / any taxable passive). Social Security
        // is excluded because only a fraction is taxable and the solver fills against the
        // non-SS ordinary base.
        const gross = TaxService.getGrossIncome(y.incomes, y.year);
        const ss = TaxService.getSocialSecurityBenefits(y.incomes, y.year);
        const nonSSOrdinary = Math.max(0, gross - ss);

        const headroom = Math.max(0, stdDed - nonSSOrdinary);
        if (headroom > 0) plan.set(y.year, headroom);
    }

    return plan;
}

// ---------------------------------------------------------------------------
// feasibilityFloor — candidate ≥ baseline on the objective?
// ---------------------------------------------------------------------------

export interface FeasibilityResult {
    /** terminalAfterTaxNW of the candidate plan (scored with the shared ruler). */
    candidateScore: number;
    /** terminalAfterTaxNW of the std-ded-only floor (same ruler). */
    floorScore: number;
    /** candidateScore − floorScore. ≥ 0 means the candidate clears the floor. */
    gap: number;
    /** Convenience: gap ≥ 0 (allowing a tiny epsilon for float noise). */
    passes: boolean;
    candidate: PlanScore;
    floor: PlanScore;
}

/**
 * Feasibility-floor property (cookbook "must pass"): score the candidate and the
 * std-ded-only baseline with the SAME ruler (built from the std-ded-only timeline) and
 * return the gap. The objective here is terminal after-tax net worth — to test a
 * different objective, read the corresponding field off the returned PlanScores.
 */
export function feasibilityFloor(
    scenario: Scenario,
    candidatePlan: ConversionPlan,
    epsilon = 1,
): FeasibilityResult {
    const floorPlan = stdDedOnlyPlan(scenario);

    // Build the ONE shared ruler from the strategy-independent std-ded-only baseline,
    // then score BOTH plans against it.
    const floorTimeline = runSimulation(
        scenario.yearsToRun, scenario.accounts, scenario.incomes, scenario.expenses,
        scenario.assumptions, scenario.taxState, undefined, { dpConversionPlan: floorPlan },
    );

    const floor = scorePlan(scenario, floorPlan, floorTimeline);
    const candidate = scorePlan(scenario, candidatePlan, floorTimeline);

    const gap = candidate.terminalAfterTaxNW - floor.terminalAfterTaxNW;
    return {
        candidateScore: candidate.terminalAfterTaxNW,
        floorScore: floor.terminalAfterTaxNW,
        gap,
        passes: gap >= -epsilon,
        candidate,
        floor,
    };
}

// ---------------------------------------------------------------------------
// scalingSweep — interior-peak diagnostic
// ---------------------------------------------------------------------------

export interface SweepPoint {
    factor: number;
    score: number;       // terminalAfterTaxNW
    totalConverted: number;
    ranOutOfMoney: boolean;
}

export interface SweepResult {
    points: SweepPoint[];
    /** Factor with the highest terminalAfterTaxNW. */
    argmaxFactor: number;
    /** True iff the argmax is strictly interior (not the smallest or largest factor tested). */
    interiorPeak: boolean;
    /** True iff score is (weakly) monotone increasing toward the largest factor — under-converting. */
    risingToTop: boolean;
    /** True iff score is (weakly) monotone increasing toward the smallest factor — over-converting. */
    risingToBottom: boolean;
}

/**
 * Scaling sweep (cookbook diagnostic): multiply every year's conversion in `basePlan` by
 * each factor, score each scaled plan with the SAME ruler, and report the curve + argmax.
 * A correct base plan sits at an INTERIOR peak (both neighbors lower). A score that keeps
 * rising toward 0× ⇒ over-converting; toward the top factor ⇒ under-converting.
 *
 * The ruler is built ONCE from the std-ded-only baseline (strategy-independent) and reused
 * for every scaled plan, per the brief's "one consistent ruler".
 */
export function scalingSweep(
    scenario: Scenario,
    basePlan: ConversionPlan,
    factors: number[] = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5],
): SweepResult {
    const floorPlan = stdDedOnlyPlan(scenario);
    const rulerSource = runSimulation(
        scenario.yearsToRun, scenario.accounts, scenario.incomes, scenario.expenses,
        scenario.assumptions, scenario.taxState, undefined, { dpConversionPlan: floorPlan },
    );

    const sorted = [...factors].sort((a, b) => a - b);
    const points: SweepPoint[] = sorted.map(factor => {
        const scaled: ConversionPlan = new Map();
        for (const [year, amt] of basePlan) scaled.set(year, amt * factor);
        const s = scorePlan(scenario, scaled, rulerSource);
        return {
            factor,
            score: s.terminalAfterTaxNW,
            totalConverted: s.totalConverted,
            ranOutOfMoney: s.ranOutOfMoney,
        };
    });

    let argmaxIdx = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i].score > points[argmaxIdx].score) argmaxIdx = i;
    }
    const argmaxFactor = points[argmaxIdx].factor;
    const interiorPeak = argmaxIdx > 0 && argmaxIdx < points.length - 1;

    const risingToTop = argmaxIdx === points.length - 1;
    const risingToBottom = argmaxIdx === 0;

    return { points, argmaxFactor, interiorPeak, risingToTop, risingToBottom };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function retirementAgeOf(assumptions: AssumptionsState): number {
    // Mirror getRetirementAge without importing it (keep the import surface minimal).
    const retire = assumptions.milestones.find(m => m.name === 'Retire');
    const ageCond = retire?.conditions.find(c => c.type === 'AGE');
    return ageCond?.value ?? 65;
}

/** SECURE Act 2.0 RMD start age by birth year (matches the engine's getRMDStartAge). */
function rmdStartAgeFor(birthYear: number): number {
    if (birthYear <= 1950) return 72;
    if (birthYear <= 1959) return 73;
    return 75;
}

// ===========================================================================
// Scenario builders
// ===========================================================================

/**
 * Shared assumptions skeleton wired for plan injection through planConversionDP:
 *   - rothConversionStrategy 'dp-precomputed'  → executor = planConversionDP
 *   - taxOptimizationEnabled true              → conversions allowed
 *   - autoRothConversions false                → no extra auto layer; the PLAN is the source
 *   - rothConversionUserSituation 'self-liquidate' → the ruler we score with
 *   - inflation OFF (nominal, flat) so plans differ only by conversion timing, not CPI noise
 */
function baseAssumptions(
    birthYear: number,
    retireAge: number,
    lifeExpectancy: number,
    ror: number,
): AssumptionsState {
    return {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(birthYear, retireAge, lifeExpectancy),
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: 0,
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 0,
            inflationAdjusted: false,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror },
            withdrawalRate: 4.0,
            autoRothConversions: false,
            taxOptimizationEnabled: true,
            rothConversionStrategy: 'dp-precomputed',
            rothConversionUserSituation: 'self-liquidate',
        },
        // BURN ORDER (the "withdrawalStrategy"). CRITICAL: with an empty order the engine
        // can tap NO account to fund a spending deficit — createOrderedSnapshots returns []
        // (WithdrawalPlanner.ts:280), planWithdrawals funds nothing, and the engine BORROWS
        // (a system DeficitDebtAccount) to live while the brokerage compounds untouched.
        // That fattens the residual balances and distorts after-tax-NW magnitudes. A real
        // order makes the engine sell to live. Standard tax-efficient drawdown: cash →
        // taxable brokerage → Traditional → Roth (spend the taxable buckets first; preserve
        // tax-free Roth longest — the cookbook's "spending the taxable account first leaves
        // Roth space to keep growing"). Both scenario builders use these exact account IDs.
        withdrawalStrategy: [
            { id: 'ws-cash', name: 'Cash', accountId: 'acc-cash' },
            { id: 'ws-brk', name: 'Brokerage', accountId: 'acc-brk' },
            { id: 'ws-trad', name: 'Traditional', accountId: 'acc-trad' },
            { id: 'ws-roth', name: 'Roth', accountId: 'acc-roth' },
        ],
    };
}

/**
 * "SS-HEAVY" IS A MISNOMER — this fixture actually delivers ~$0 Social Security, and that
 * is its PURPOSE: it is the $0-SS, large-Traditional ($1.5M), trad-first OVER-conversion
 * corner. With no torpedo the residual Traditional exits cheaply, so a naive optimizer
 * over-converts past the wealth peak. (See RothConversionFeasibilityFloor.test.ts, which
 * uses this as the over-converter and labels it "$0 SS".)
 *
 * WHY $0 SS despite the $5,000/mo PIA set below: at the claiming age the engine RECOMPUTES
 * the SS PIA from the household's earnings history (IncomeProjection.ts ~218/237,
 * calculateAIME) and OVERWRITES the hand-set calculatedPIA. With no demographics.priorEarnings
 * and no in-sim work income (retired), the recomputed PIA ≈ 0 — so the configured $5k/mo is
 * never paid (only a partial first year, before the projection zeroes it). Do NOT "fix" this
 * to pay $60k; it would destroy the over-converter corner the tests rely on. For a REAL
 * torpedo, supply demographics.priorEarnings (see makeRealSSLargeTradScenario in
 * RothConversionFeasibilityFloor.test.ts) or use CurrentSocialSecurityIncome.
 *
 * MFJ, ~5% growth, already retired at 62; gap years 62→66, RMDs at 75.
 */
export function makeSSHeavyScenario(): Scenario {
    const currentYear = new Date().getFullYear();
    const birthYear = currentYear - 62; // age 62 today
    const retireAge = 62;               // already retired
    const lifeExpectancy = 92;
    const ror = 5;

    const assumptions = baseAssumptions(birthYear, retireAge, lifeExpectancy, ror);
    const taxState: TaxState = {
        filingStatus: 'Married Filing Jointly',
        stateResidency: 'TX', // no state income tax — isolate the federal + torpedo effect
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: currentYear,
    };

    // $1.5M Traditional, 0% expense ratio so net growth ≈ ror. costBasis irrelevant for Trad.
    const traditional = new InvestedAccount(
        'acc-trad', 'Traditional 401k', 1_500_000, 0, 30, 0, 'Traditional 401k', false, 1.0, 1_500_000,
    );
    // Modest brokerage (pays conversion tax / spending), half of it gain.
    const brokerage = new InvestedAccount(
        'acc-brk', 'Brokerage', 300_000, 0, 10, 0, 'Brokerage', false, 1.0, 150_000,
    );
    // Small Roth seed (conversion destination must exist).
    const roth = new InvestedAccount(
        'acc-roth', 'Roth IRA', 50_000, 0, 10, 0, 'Roth IRA', false, 1.0, 50_000,
    );
    // Cash buffer.
    const cash = new SavedAccount('acc-cash', 'Cash', 50_000, 0);

    // CONFIGURED $5,000/mo but DELIVERS ~$0: the engine recomputes PIA from the (empty)
    // earnings history at claiming age and overwrites this value (see the function docstring).
    // This is intentional — the fixture is the $0-SS over-converter corner.
    const ss = new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 5_000, currentYear - 1);

    // Living expenses ~$80k/yr (forces some Traditional/brokerage draw alongside conversions).
    const living = new FoodExpense('exp-living', 'Living Expenses', 80_000, 'Annually', new Date(`${currentYear}-01-01`));

    return {
        accounts: [traditional, brokerage, roth, cash],
        incomes: [ss],
        expenses: [living],
        assumptions,
        taxState,
        yearsToRun: lifeExpectancy - retireAge, // run to end of plan
    };
}

/**
 * LOW-BRACKET / APPRECIATED-BROKERAGE PROFILE.
 * Early retiree (~55), large highly-appreciated taxable brokerage, SMALL Traditional,
 * little/no Social Security. This is the OVER-conversion-risk household: there is little
 * future RMD pressure and the Traditional exits cheaply, so aggressive conversion gives
 * back more tax now than it saves later. Long gap window (55→75) and no torpedo (no/low SS)
 * means the falling benefit curve is genuinely low — a correct plan converts little.
 *
 * DEAD-CASH NOTE (#161): historically, tax-opt execution demoted the SavedAccount behind
 * all non-penalized tiers, so the $60k cash idled for the whole horizon until a big-tax
 * year (e.g. an ACA-cliff-crossing conversion) capped brokerage sales and forced the
 * cascade to deploy it — a funding-path windfall of roughly +$460-530k that inflated any
 * big-tax-year comparison on this fixture (measured +$68k gap with the windfall vs -$459k
 * with cash pre-invested). FIXED with #161: savings now leads the non-penalized tier under
 * tax-opt, cash deploys for ordinary living expenses in the first retirement years, and the
 * windfall no longer exists (see DeadCashDeployment.test.ts for the regression pin).
 */
export function makeLowBracketBrokerageScenario(): Scenario {
    const currentYear = new Date().getFullYear();
    const birthYear = currentYear - 55; // age 55 today
    const retireAge = 55;               // already retired
    const lifeExpectancy = 92;
    const ror = 6;

    const assumptions = baseAssumptions(birthYear, retireAge, lifeExpectancy, ror);
    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'TX', // no state income tax
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: currentYear,
    };

    // SMALL Traditional ($250k) — low RMD pressure, cheap exit.
    const traditional = new InvestedAccount(
        'acc-trad', 'Traditional 401k', 250_000, 0, 30, 0, 'Traditional 401k', false, 1.0, 250_000,
    );
    // LARGE highly-appreciated brokerage ($1.2M, basis $300k → 75% gain).
    const brokerage = new InvestedAccount(
        'acc-brk', 'Brokerage', 1_200_000, 0, 20, 0, 'Brokerage', false, 1.0, 300_000,
    );
    const roth = new InvestedAccount(
        'acc-roth', 'Roth IRA', 40_000, 0, 10, 0, 'Roth IRA', false, 1.0, 40_000,
    );
    const cash = new SavedAccount('acc-cash', 'Cash', 60_000, 0);

    // Token SS at 70 (small) — keeps the torpedo nearly inactive.
    const ss = new FutureSocialSecurityIncome('inc-ss', 'Social Security', 70, 1_200, currentYear - 1);

    // Modest living expenses ~$55k/yr (mostly funded from the big brokerage).
    const living = new FoodExpense('exp-living', 'Living Expenses', 55_000, 'Annually', new Date(`${currentYear}-01-01`));

    return {
        accounts: [traditional, brokerage, roth, cash],
        incomes: [ss],
        expenses: [living],
        assumptions,
        taxState,
        yearsToRun: lifeExpectancy - retireAge,
    };
}

/**
 * Convenience: a flat "convert $X every gap year" plan, for sweeps and quick probes.
 * Fills retired pre-RMD years with `amountPerYear`.
 */
export function flatGapYearPlan(scenario: Scenario, amountPerYear: number): ConversionPlan {
    const plan: ConversionPlan = new Map();
    const birthYear = getBirthYear(scenario.assumptions.milestones);
    const retireAge = retirementAgeOf(scenario.assumptions);
    const rmdStartAge = rmdStartAgeFor(birthYear);
    for (let age = retireAge; age < rmdStartAge; age++) {
        plan.set(birthYear + age, amountPerYear);
    }
    return plan;
}
