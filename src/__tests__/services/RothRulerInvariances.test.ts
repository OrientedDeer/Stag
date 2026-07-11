/**
 * fp-review F12 — the ruler-invariance PROPERTY tests the principles doc names but which
 * had no executable form (docs/roth-review/fp-2026-07-02/principles-objective.md §4b, §7).
 *
 * The decision quantity everywhere is a DIFFERENCE: candidate − std-ded baseline, both
 * scored with the ONE situation-based ruler. Three properties make that difference
 * trustworthy; only the first had a test before this file:
 *
 *   1. BASELINE INVARIANCE (tested: RothBaselineInvariance.test.ts) — the baseline arm
 *      is dollar-exact across selected strategies.
 *   2. ADD-A-DOLLAR INVARIANCE (this file) — adding flat cash to BOTH arms moves the
 *      measured gain ≈ $0. Catches one-arm floors, threshold artifacts, and arms
 *      tripping different code paths (e.g. one arm hitting a solvency fallback).
 *   3. RATE-EQUALITY / SIGN STRUCTURE (this file) — the Kitces marginal-rate equivalency
 *      as executable spec: converting is beneficial strictly below the exit rate and
 *      harmful strictly above it.
 *
 * Plus one DIRECTIONAL-MONOTONICITY property on the optimizer itself:
 *
 *   4. SS-MONOTONICITY (this file) — the fp-review's stated property: more Social
 *      Security (same everything else) must not DECREASE the chosen total conversions,
 *      because the torpedo makes the Traditional exit costlier.
 *      EXECUTED FOR THE FIRST TIME HERE, IT IS EMPIRICALLY FALSE — see the finding
 *      documented at the `it.fails` test below. The violation is economically coherent
 *      (not an optimizer bug): the property's rationale prices the torpedo only on the
 *      EXIT side, but a bigger benefit also consumes low-bracket headroom in every
 *      post-claim conversion year and torpedo-taxes conversions there at up to ~1.85×
 *      the bracket rate. The sharper directional core that DOES hold — more SS shifts
 *      conversions FORWARD into the pre-claim years — is asserted as a passing test.
 *
 * WHY SIGN STRUCTURE, NOT A CLEAN EQUALITY CORNER (task 2b honesty note): the textbook
 * indifference result (marginal rate now == exit rate ⇒ wealth delta of converting = 0)
 * holds only when the conversion tax is paid from money that would otherwise have grown
 * at the same after-tax rate as the IRA (canonically: withheld from the conversion
 * itself). Stag's engine pays conversion tax through the withdrawal order — cash first
 * (0% growth, so paying early is nearly free) then brokerage (realizing LTCG, an extra
 * friction) — and a big conversion year can also reroute the whole spending cascade
 * (deploying idle cash / Roth basis) and trigger the pre-65 ACA cliff cost (fp-review
 * F1), all of which move the true indifference point away from exact rate equality. An
 * "≈ $0 at equality" assertion would certify the tolerance, not the economics. The sign
 * structure on either side of the equality point is the part of the Kitces result the
 * engine genuinely embodies, so that is what we assert — on fixtures purpose-built so
 * the rate effect is the DOMINANT marginal mechanism (see makeCleanCheapExitScenario),
 * with bracket positions documented at each assertion.
 *
 * IF ANY PROPERTY FAILS: that is a REAL FINDING (the fp-review predicted these pass but
 * they had never been executed). Do not weaken the property — investigate and report.
 *
 * Synthetic, PII-free numbers only.
 */
import { describe, it, expect } from 'vitest';
import {
    type AssumptionsState, defaultAssumptions, createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../components/Objects/Taxes/TaxContext';
import { type AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { type EarningsRecord } from '../../services/SocialSecurityCalculator';
import { runSimulation, runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import * as TaxService from '../../components/Objects/Taxes/TaxService';
import {
    type Scenario, type ConversionPlan, scorePlan, stdDedOnlyPlan, feasibilityFloor, flatGapYearPlan,
    executedConversionsByYear, realYears, makeSSHeavyScenario,
} from '../roth-cookbook/harness';

const TIMEOUT = { timeout: 300_000 };

// ---------------------------------------------------------------------------
// Shared: a real-SS large-Traditional household with an EARNINGS-HISTORY knob.
// Same shape as RothConversionFeasibilityFloor.test.ts::makeRealSSLargeTradScenario
// ($1.5M Trad, MFJ, Texas, SS claimed at 67 from a 35-year history, ~5% growth,
// taxable-first drawdown) — the knob scales the history so the recomputed PIA (and
// nothing else) differs between scenarios.
// ---------------------------------------------------------------------------
const NOW = new Date().getFullYear();
const BY = NOW - 62, RA = 62, LE = 92, ROR = 5;
const SS_CLAIM_AGE = 67;

function makeTorpedoScenario(annualEarnings: number): Scenario {
    const priorEarnings: EarningsRecord[] = [];
    for (let a = 25; a <= 59; a++) priorEarnings.push({ year: BY + a, amount: annualEarnings });
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: { priorEarnings },
        milestones: createBuiltinMilestones(BY, RA, LE),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments, returnRates: { ror: ROR },
            taxOptimizationEnabled: true, autoRothConversions: true,
            rothConversionStrategy: 'dp-precomputed',
        },
        withdrawalStrategy: [
            { id: 'ws-savings', name: 'Savings', accountId: 'acc-savings' },
            { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-traditional' },
            { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
        ],
    };
    const taxState: TaxState = {
        filingStatus: 'Married Filing Jointly', stateResidency: 'Texas', deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW,
    };
    const accounts: AnyAccount[] = [
        new InvestedAccount('acc-traditional', 'Traditional IRA', 1_500_000, 0, 10, 0, 'Traditional IRA', true, 0.2, 1_500_000),
        new InvestedAccount('acc-roth', 'Roth IRA', 100_000, 0, 10, 0, 'Roth IRA', true, 0.2, 100_000),
        new InvestedAccount('acc-brokerage', 'Brokerage', 400_000, 0, 10, 0, 'Brokerage', true, 0.2, 300_000),
        new SavedAccount('acc-savings', 'Savings', 50_000, 4),
    ];
    return {
        accounts,
        incomes: [new FutureSocialSecurityIncome('inc-ss', 'Social Security', SS_CLAIM_AGE, 3_000, NOW)],
        expenses: [new FoodExpense('exp-living', 'Living Expenses', 80_000, 'Annually', new Date(`${NOW}-01-01`))],
        assumptions, taxState, yearsToRun: LE - RA,
    };
}

/**
 * Confound-free CHEAP-EXIT household for the rate-sign test's "above" side.
 * Design constraints (each removes a mechanism that would otherwise dominate the
 * marginal rate effect — see the ABOVE test's comment for how they were discovered):
 *   - age 65+ in every conversion year → no ACA cliff cost, no early-withdrawal rules;
 *   - $0 cash → no dead-money-deployment windfall when a big tax bill arrives;
 *   - brokerage costBasis == amount → the tax-funding sale realizes no gains
 *     (friction-free payment source, no LTCG-stacking asymmetry between arms);
 *   - SMALL Traditional ($250k) + ~$0 SS (no earnings history → recomputed PIA ≈ 0)
 *     → the residual exits mostly through the 0% std-ded slice: a CHEAP exit.
 */
function makeCleanCheapExitScenario(): Scenario {
    const birthYear = NOW - 65, retireAge = 65, le = 92;
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(birthYear, retireAge, le),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 6 },
            withdrawalRate: 4.0,
            autoRothConversions: false,
            taxOptimizationEnabled: true,
            rothConversionStrategy: 'dp-precomputed',
            rothConversionUserSituation: 'self-liquidate',
        },
        withdrawalStrategy: [
            { id: 'ws-cash', name: 'Cash', accountId: 'acc-cash' },
            { id: 'ws-brk', name: 'Brokerage', accountId: 'acc-brk' },
            { id: 'ws-trad', name: 'Traditional', accountId: 'acc-trad' },
            { id: 'ws-roth', name: 'Roth', accountId: 'acc-roth' },
        ],
    };
    const taxState: TaxState = {
        filingStatus: 'Single', stateResidency: 'TX', deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW,
    };
    const accounts: AnyAccount[] = [
        new SavedAccount('acc-cash', 'Cash', 0, 0),
        new InvestedAccount('acc-trad', 'Traditional 401k', 250_000, 0, 30, 0, 'Traditional 401k', false, 1.0, 250_000),
        new InvestedAccount('acc-brk', 'Brokerage', 1_200_000, 0, 20, 0, 'Brokerage', false, 1.0, 1_200_000),
        new InvestedAccount('acc-roth', 'Roth IRA', 10_000, 0, 10, 0, 'Roth IRA', false, 1.0, 10_000),
    ];
    return {
        accounts,
        incomes: [new FutureSocialSecurityIncome('inc-ss', 'Social Security', 70, 1_200, NOW - 1)],
        expenses: [new FoodExpense('exp-living', 'Living Expenses', 55_000, 'Annually', new Date(`${NOW}-01-01`))],
        assumptions, taxState, yearsToRun: le - retireAge,
    };
}

/** Score a candidate plan and the std-ded floor with ONE shared ruler; return both scores. */
function scoreVsFloor(sc: Scenario, candidate: ConversionPlan): { candidate: number; floor: number } {
    const floorPlan = stdDedOnlyPlan(sc);
    const rulerSource = runSimulation(
        sc.yearsToRun, sc.accounts, sc.incomes, sc.expenses,
        sc.assumptions, sc.taxState, undefined, { dpConversionPlan: floorPlan },
    );
    return {
        candidate: scorePlan(sc, candidate, rulerSource).terminalAfterTaxNW,
        floor: scorePlan(sc, floorPlan, rulerSource).terminalAfterTaxNW,
    };
}

// ===========================================================================
// 1. ADD-A-DOLLAR INVARIANCE (§4b): +$1,000 cash to BOTH arms ⇒ measured gain ≈ $0.
// ===========================================================================
describe('add-a-dollar invariance — flat cash added to both arms leaves the measured gain unchanged', TIMEOUT, () => {
    it('+$1,000 initial cash moves candidate−floor by ≈ $0 (and both scores weakly up)', () => {
        // The $0-SS over-converter household with a meaningful mid-size candidate plan
        // ($60k/gap-year — well inside feasible territory, distinct from the floor).
        const sc1 = makeSSHeavyScenario();
        const plan = flatGapYearPlan(sc1, 60_000);
        const r1 = feasibilityFloor(sc1, plan);

        const sc2 = makeSSHeavyScenario();
        sc2.accounts = sc2.accounts.map(a =>
            a.id === 'acc-cash' ? new SavedAccount('acc-cash', 'Cash', 51_000, 0) : a);
        const r2 = feasibilityFloor(sc2, plan);

        // Sanity/direction: more money can only help each arm. The uplift is bounded by
        // the perturbation compounding at the portfolio rate for the horizon:
        // $1,000 × 1.05^30 ≈ $4,300 (the cash itself earns 0% but is spent in year 1,
        // displacing a brokerage sale that then stays invested at ~5%).
        expect(r2.candidateScore).toBeGreaterThan(r1.candidateScore);
        expect(r2.floorScore).toBeGreaterThan(r1.floorScore);
        expect(r2.candidateScore - r1.candidateScore).toBeLessThan(5_000);
        expect(r2.floorScore - r1.floorScore).toBeLessThan(5_000);

        // THE PROPERTY: the gain (candidate − floor) must be invariant to flat cash added
        // to both arms. Ruler-wise the two arms must move identically; the only LEGITIMATE
        // residual is second-order tax-timing on the displaced $1,000 (the two arms realize
        // slightly different LTCG on the sale it displaces, ≤ 15% × $1,000 compounded
        // ≈ $650 at the absolute worst). The bug classes this guards against — a floor
        // firing on one arm only, arms crossing a threshold/code-path differently —
        // show up at $1k-$10k+. Tolerance $750 sits between the two. DO NOT widen it:
        // a larger delta means the two arms are not being measured with one instrument.
        expect(Math.abs(r2.gap - r1.gap)).toBeLessThan(750);
    });
});

// ===========================================================================
// 2. RATE-EQUALITY SIGN STRUCTURE (Kitces equivalency as executable spec — see the
//    file docstring for why the exact-equality corner is asserted as SIGNS instead).
// ===========================================================================
describe('rate-equality sign structure — convert below the exit rate: win; above it: lose', TIMEOUT, () => {
    it('BELOW: extra conversions at 10-12% with a 22%+ torpedo exit strictly help', () => {
        // Real-SS household: residual Traditional is large ($1.5M growing at 5%, only
        // std-ded nibbles taken), so its post-horizon exit prices marginal dollars at
        // 22%+ (RMDs stacked on ~$40k persisting SS, provisional-income torpedo).
        // The extra conversions go in the PRE-SS gap years (62-66) where the household
        // has ~$0 other ordinary income: the floor plan already fills the standard
        // deduction, so an extra $15k/year is taxed at 10-12% — clearly BELOW the exit.
        // NOTE: the engine never executes a conversion in the FIRST simulated year (the
        // retirement milestone only activates during it and planConversionDP gates on
        // isRetired), so start the extra conversions at RA+1 — a year-0 entry would be
        // silently skipped in BOTH arms and contribute nothing.
        const sc = makeTorpedoScenario(130_000);
        const floorPlan = stdDedOnlyPlan(sc);
        const plus: ConversionPlan = new Map(floorPlan);
        for (let age = RA + 1; age < SS_CLAIM_AGE; age++) {
            const y = BY + age;
            plus.set(y, (plus.get(y) ?? 0) + 15_000);
        }
        const s = scoreVsFloor(sc, plus);
        // Expected magnitude ≈ 4yr × $15k × (exit − now) ≥ $6k; the $1,000 margin only
        // filters float noise, it is not the economic claim.
        expect(s.candidate).toBeGreaterThan(s.floor + 1_000);
    });

    it('ABOVE: a $100k conversion at ~12-22% with a ~0-10% exit strictly hurts', () => {
        // PURPOSE-BUILT confound-free fixture (see makeCleanCheapExitScenario). The first
        // construction of this test used the harness's low-bracket/appreciated-brokerage
        // household and FAILED with the conversion IMPROVING wealth by ~$68k — which a
        // money-trace showed was NOT a rate effect at all. Two mechanisms swamped it:
        //   1. DEAD-CASH DEPLOYMENT: that fixture's std-ded floor arm never touches its
        //      $60k 0%-APR cash for 37 years; the big conversion's tax bill forces the
        //      engine to finally spend it (plus $40k of Roth basis), letting ~6%-growth
        //      brokerage stay invested — a funding-path windfall worth far more than the
        //      conversion tax. That is engine SPENDING policy, not conversion economics.
        //   2. ACA CLIFF (pre-65): since fp-review F1, crossing the 400%-FPL cliff costs
        //      real cash (default $12k/yr) — a genuine but non-bracket cost of a big
        //      pre-65 conversion year.
        // This fixture removes both: household is 66+ in the conversion year (no ACA, no
        // early-withdrawal ambiguity), $0 cash, and the brokerage basis == amount so the
        // tax-funding sale is friction-free and identical in both arms except for the tax
        // dollars themselves. Money-trace verified: the conversion year's extra sale is
        // EXACTLY spending + conversion tax.
        //
        // Economics: +$100k in one year (Single, ~$0 other ordinary income; the floor
        // already fills the std deduction) is taxed across 10/12/22% (~$16.7k ≈ 17%
        // effective) — clearly ABOVE the residual's ~0-10% exit (small $250k Traditional,
        // ~$0 SS, RMD drawdown mostly inside the std deduction and 10% bracket).
        const sc = makeCleanCheapExitScenario();
        const floorPlan = stdDedOnlyPlan(sc);
        // SECOND gap year, not the first: conversions never execute in the first
        // simulated year (see the BELOW test's note) — a first-year perturbation is a
        // no-op in both arms and the two scores come out byte-identical.
        const years = [...floorPlan.keys()].sort((a, b) => a - b);
        const targetYear = years[1];
        const plus: ConversionPlan = new Map(floorPlan);
        plus.set(targetYear, (plus.get(targetYear) ?? 0) + 100_000);
        const s = scoreVsFloor(sc, plus);
        // Observed harm ≈ −$32k terminal (the ~$16.7k tax paid early, compounded to the
        // horizon, net of the Trad→Roth revaluation); $1,000 margin = float noise only.
        expect(s.candidate).toBeLessThan(s.floor - 1_000);
    });
});

// ===========================================================================
// 3. SS-MONOTONICITY — FINDING (fp-review F12, discovered when this property was first
//    executed on 2026-07-02): the review's stated property "more SS ⇒ chosen total
//    conversions weakly rise (the torpedo makes the exit costlier)" is FALSE against
//    the current optimizer, and the violation looks economically CORRECT, not a bug.
//
//    Minimal repro (makeTorpedoScenario below; identical households except a 35-year
//    earnings history of $40k/yr vs $150k/yr → recomputed PIA is the only difference):
//      low SS:  total conversions ≈ $723k (~$60k/yr, ages 63-74), chosen order
//               savings→brokerage→ROTH→TRAD; scaling sweep of the chosen plan peaks
//               at 1× (interior peak, factors 0.75-2 all lower).
//      high SS: total conversions ≈ $493k, chosen order savings→brokerage→TRAD→ROTH;
//               ALSO an interior 1× peak — so the optimizer is NOT under-converting;
//               the true optimum is genuinely lower.
//    Where the money moved: the high-SS household converts MORE in the PRE-claim years
//    (≈$295k over ages 63-66 vs ≈$243k, incl. two ~$90-95k years right before claiming)
//    and then collapses to ~$24.8k/yr once SS starts — the benefit fills the low
//    brackets in every post-claim conversion year and the phase-in torpedo prices
//    marginal conversion dollars at up to ~1.85× the bracket rate. The review's
//    rationale prices the torpedo on the EXIT side only; it is a TWO-SIDED cost.
//    TOTAL monotonicity is therefore not a theorem of this model; the directional core
//    that survives is the forward SHIFT, asserted as the passing test below.
//
//    The property test was retained as `it.fails` (NOT weakened): if a future optimizer
//    change makes it pass, vitest will flag it and the finding should be re-examined.
//    THAT HAPPENED with #191 (senior deductions priced by the DP) — see the history
//    note on the test itself; it now runs as a normal passing pin.
// ===========================================================================

interface MonoFixture { ssAnnual: number; total: number; preClaimTotal: number; }
let monoCache: { low: MonoFixture; high: MonoFixture } | null = null;
function monoFixtures(): { low: MonoFixture; high: MonoFixture } {
    if (monoCache) return monoCache;
    const run = (annualEarnings: number): MonoFixture => {
        const sc = makeTorpedoScenario(annualEarnings);
        const engine = runSimulationWithOptimization(
            sc.yearsToRun, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState);
        const plan = executedConversionsByYear(engine);
        let total = 0, preClaimTotal = 0;
        for (const [year, amt] of plan) {
            total += amt;
            if (year < BY + SS_CLAIM_AGE) preClaimTotal += amt;
        }
        // Read the realized benefit off a post-claim year (the engine recomputes the PIA
        // from the earnings history at claim) so the knob is verifiably live.
        const y = realYears(engine).find(r => r.year === BY + SS_CLAIM_AGE + 3)!;
        return { ssAnnual: TaxService.getSocialSecurityBenefits(y.incomes, y.year), total, preClaimTotal };
    };
    monoCache = { low: run(40_000), high: run(150_000) };
    return monoCache;
}

describe('SS-monotonicity — directional properties of the chosen conversions', TIMEOUT, () => {
    it('sanity: the earnings-history knob produces materially different benefits', () => {
        const { low, high } = monoFixtures();
        expect(low.ssAnnual).toBeGreaterThan(0);
        expect(high.ssAnnual).toBeGreaterThan(low.ssAnnual + 10_000);
    });

    // THE REVIEW'S PROPERTY. Slack $25k = search-grid quantization only.
    //
    // HISTORY: from 2026-07-02 (fp-review F12) this was pinned as `it.fails` — the
    // optimizer violated it by ≈ $230k (low-SS ≈ $723k vs high-SS ≈ $493k), and the
    // violation was adjudicated economically correct (the torpedo is a TWO-SIDED
    // cost; see the block comment above). The `it.fails` sentinel said: if a future
    // optimizer change makes this pass, re-examine.
    //
    // RE-EXAMINED 2026-07-06 (#191): once the DP prices the 65+ senior deductions
    // (regular add-on + OBBBA bonus) that the engine actually bills, both
    // households' retirement-year 0%-space grows and total conversions jump
    // (low-SS ≈ $1,009k, high-SS ≈ $1,209k) — and the property briefly held with
    // ≈ +$200k of margin, as decisively as it used to fail. That pass was flagged
    // fixture-specific: "if it flips again under a future optimizer change,
    // re-adjudicate rather than blindly restoring `it.fails`."
    //
    // RE-FLIPPED 2026-07-06 (#199): this scenario retires in year 0 (BY = NOW−62,
    // RA = 62 ⇒ retirementYear == startYear), and the DP used to plan a conversion
    // for that UNEXECUTABLE year-0 retirement context — a fictional age-62
    // conversion the engine never runs (its loop starts at startYear+1). Excluding
    // year 0 (#199) corrects the DP's internal Trad walk, which had been running a
    // year ahead / ~$57.5k low; the low-SS household — whose big pre-claim 0%-space
    // was the one the fictional year-0 conversion was mis-consuming — now converts
    // materially MORE in its real years (low-SS ≈ $1,446k), while the high-SS
    // household is ≈ flat (≈ $1,211k). So the review's TOTAL-monotonicity property
    // is VIOLATED again — exactly the two-sided-torpedo economics the block comment
    // above adjudicated (total monotonicity is NOT a theorem of this model). Per
    // that block comment's original stance and the #191 note's own instruction,
    // the honest encoding is the `it.fails` sentinel: we EXPECT the property to be
    // violated. If a FUTURE optimizer change makes it pass again, vitest will flag
    // this and the finding must be re-examined (do not silently weaken it).
    it.fails('high-SS total conversions ≥ low-SS total is VIOLATED (two-sided torpedo; re-flipped by #199)', () => {
        const { low, high } = monoFixtures();
        expect(high.total, `low-SS total=${Math.round(low.total)} high-SS total=${Math.round(high.total)}`)
            .toBeGreaterThanOrEqual(low.total - 25_000);
    });

    // The directional core that DOES hold: in the pre-claim window the two households face
    // IDENTICAL conversion prices (no SS on either side yet), while the high-SS household
    // faces a costlier exit AND costlier post-claim conversion years — so it front-loads:
    // its pre-claim conversions must be at least the low-SS household's. $10k slack for
    // search-grid quantization.
    it('more SS shifts conversions FORWARD: high-SS pre-claim conversions ≥ low-SS pre-claim', () => {
        const { low, high } = monoFixtures();
        expect(high.preClaimTotal, `low pre-claim=${Math.round(low.preClaimTotal)} high pre-claim=${Math.round(high.preClaimTotal)}`)
            .toBeGreaterThanOrEqual(low.preClaimTotal - 10_000);
    });
});
