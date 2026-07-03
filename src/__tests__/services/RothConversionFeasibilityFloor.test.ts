/**
 * Roth conversion CORRECTNESS — the #89 ENGINE-DIRECT-SEARCH root fix, with the
 * feasibility floor retained as a backstop. Scored through the validated harness ruler.
 *
 * WHY rebuilt (history): the original #89 tests asserted "current plan >= the full-drain
 * alternative" — too weak (a plan can over-convert, scoring below the true peak, yet still
 * beat full drain, so that passed WHILE the bug was live). A first fix added a solvency-
 * gated feasibility FLOOR (fall back to the std-ded baseline when the DP scores below it),
 * which only CAPPED the downside at the conservative baseline. This file now tests the ROOT
 * fix (docs/roth-review/00-cookbook-review-synthesis.md §5): runSimulationWithOptimization
 * picks the plan by an ENGINE-DIRECT SEARCH — scoring candidate "fill to bracket" plans on
 * the REAL engine (after-tax terminal NW) and taking the max. Because the std-ded plan is in
 * the candidate set, the result is >= the baseline BY CONSTRUCTION (feasibility holds
 * natively, floor never fires), AND it reaches the actual peak instead of the conservative
 * fallback.
 *
 * Properties asserted, across a SOLVENT profile panel spanning the regimes:
 *   1. FEASIBILITY FLOOR holds (shipped after-tax NW >= std-ded baseline) — by construction.
 *   2. The floor is now a NO-OP backstop (feasibilityFloorApplied is never set on the default path).
 *   3. DOMINANCE: engine-search >= the LEGACY DP everywhere, and STRICTLY beats it where the DP
 *      mis-converted (it over-converted on the $0-SS profile; it mildly under-converts elsewhere).
 *   4. HITS THE PEAK: scaling the shipped plan up OR down doesn't materially beat it (the property
 *      the floor could NOT achieve — the floor only guaranteed "not below the baseline").
 *
 * The over-converter is makeSSHeavyScenario — a MISNOMER: it has $0 SS (no priorEarnings → PIA=0),
 * and that is WHY the legacy DP over-converted (no torpedo → the residual Traditional exits cheaply,
 * so draining it past the peak loses). The real-SS control isolates SS as the driver.
 */
import { describe, it, expect } from 'vitest';
import {
    AssumptionsState, defaultAssumptions, createBuiltinMilestones,
    getBirthYear, getRetirementAge, getLifeExpectancy,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { EarningsRecord } from '../../services/SocialSecurityCalculator';
import { runSimulation, runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import { SimulationYear } from '../../services/simulation/types';
import {
    Scenario, ConversionPlan, PlanScore, feasibilityFloor, scalingSweep, flatGapYearPlan,
    scorePlan, stdDedOnlyPlan, executedConversionsByYear,
    makeSSHeavyScenario, makeLowBracketBrokerageScenario,
} from '../roth-cookbook/harness';

const TIMEOUT = { timeout: 300_000 };

// The LEGACY DP objective (pre-root-fix optimizer). Passing any dpObjective routes
// runSimulationWithOptimization through the retained DP path instead of the engine-direct search.
type DpObjective = Parameters<typeof runSimulationWithOptimization>[11];
const DP_OBJECTIVE: DpObjective = { objectiveMode: 'max-wealth', terminalValuation: 'bracket-aware', userSituation: 'self-liquidate' };

// Engine-direct search = the production default (no dpObjective).
const optimize = (sc: Scenario): SimulationYear[] =>
    runSimulationWithOptimization(sc.yearsToRun, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState);
const legacyDp = (sc: Scenario): SimulationYear[] =>
    runSimulationWithOptimization(sc.yearsToRun, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState,
        undefined, undefined, undefined, undefined, undefined, DP_OBJECTIVE);

// A real-SS large-Traditional fixture (NOT in the harness): $1.5M Trad, MFJ, realistic SS via a
// 35-year earnings history, standard trad-before-roth drawdown, ~5% growth. The control that
// isolates SS — same shape as the over-converter EXCEPT it has real Social Security.
// `stateResidency` defaults to no-tax Texas; the DC variant below puts a TAXED state on the
// panel (fp-review F2) so state-related ruler defects stay certifiable — before it, every
// profile was Texas and the fed-only exit valuation was untestable.
function makeRealSSLargeTradScenario(stateResidency: string = 'Texas'): Scenario {
    const NOW = new Date().getFullYear();
    const BY = NOW - 62, RA = 62, LE = 92, ROR = 5;
    const priorEarnings: EarningsRecord[] = [];
    for (let a = 25; a <= 59; a++) priorEarnings.push({ year: BY + a, amount: 130_000 });
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
    const taxState: TaxState = { filingStatus: 'Married Filing Jointly', stateResidency, deductionMethod: 'Standard', fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW };
    const accounts: AnyAccount[] = [
        new InvestedAccount('acc-traditional', 'Traditional IRA', 1_500_000, 0, 10, 0, 'Traditional IRA', true, 0.2, 1_500_000),
        new InvestedAccount('acc-roth', 'Roth IRA', 100_000, 0, 10, 0, 'Roth IRA', true, 0.2, 100_000),
        new InvestedAccount('acc-brokerage', 'Brokerage', 400_000, 0, 10, 0, 'Brokerage', true, 0.2, 300_000),
        new SavedAccount('acc-savings', 'Savings', 50_000, 4),
    ];
    return {
        accounts,
        incomes: [new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 3_000, NOW)],
        expenses: [new FoodExpense('exp-living', 'Living Expenses', 80_000, 'Annually', new Date(`${NOW}-01-01`))],
        assumptions, taxState, yearsToRun: LE - RA,
    };
}

const PANEL: { name: string; build: () => Scenario; dpMisconverts: boolean }[] = [
    { name: 'over-converter ($1.5M Trad, $0 SS, trad-first)', build: makeSSHeavyScenario, dpMisconverts: true },
    { name: 'real-SS large Trad ($1.5M Trad, ~$60k SS)', build: makeRealSSLargeTradScenario, dpMisconverts: false },
    { name: 'low-bracket / big brokerage', build: makeLowBracketBrokerageScenario, dpMisconverts: false },
    // Taxed-state profile (fp-review F2): same real-SS household resident in DC, so the
    // certification (floor / no-op backstop / DP dominance / scaling-sweep peak) also runs
    // where state tax prices both the conversions AND the residual's exit.
    { name: 'real-SS large Trad, DC resident (taxed state)', build: () => makeRealSSLargeTradScenario('DC'), dpMisconverts: false },
];

// Heavy per-profile computation (engine-search + legacy DP + scaling sweep), memoized so the
// describe blocks below only read the cache. runSimulation does not mutate its input accounts,
// so one scenario instance is safely reused across the runs (same pattern the harness uses).
interface Fixture { sc: Scenario; engine: SimulationYear[]; dp: SimulationYear[]; sweep: ReturnType<typeof scalingSweep> | null; }
const cache = new Map<string, Fixture>();
function fixture(name: string, build: () => Scenario): Fixture {
    let f = cache.get(name);
    if (!f) {
        const sc = build();
        const engine = optimize(sc);
        const dp = legacyDp(sc);
        const plan = executedConversionsByYear(engine);
        // The engine-direct search ALSO optimizes the withdrawal order, so the shipped plan was generated
        // under engine[0].chosenWithdrawalOrder — not necessarily sc's stored order. The scaling sweep must
        // re-run the plan under THAT order: scaling a Traditional-preserving plan under a trad-first order
        // would spuriously look over-converted (the Traditional is spent for living AND converted). Reorder
        // sc's withdrawalStrategy to match the chosen order so the sweep tests the plan as it actually ships.
        const chosen = engine[0].chosenWithdrawalOrder;
        const scSweep: Scenario = chosen
            ? { ...sc, assumptions: { ...sc.assumptions, withdrawalStrategy: chosen.map(c => sc.assumptions.withdrawalStrategy.find(w => w.accountId === c.accountId)!).filter(Boolean) } }
            : sc;
        const sweep = plan.size > 0 ? scalingSweep(scSweep, plan, [0.25, 0.5, 0.75, 1, 1.25, 1.5]) : null;
        f = { sc, engine, dp, sweep };
        cache.set(name, f);
    }
    return f;
}
const eps = (v: number) => Math.max(1, Math.abs(v) * 1e-6);

// ===========================================================================
// 1. FEASIBILITY FLOOR holds (by construction of the search) on every profile.
// ===========================================================================
describe('feasibility floor (#89) — shipped plan never scores below the std-ded baseline', TIMEOUT, () => {
    for (const p of PANEL) {
        it(`holds on: ${p.name}`, () => {
            const { engine } = fixture(p.name, p.build);
            const strat = engine[0].strategyTerminalAfterTaxNW!;
            const base = engine[0].stdDedBaselineTerminalAfterTaxNW!;
            expect(strat).toBeDefined();
            expect(base).toBeDefined();
            expect(strat).toBeGreaterThanOrEqual(base - eps(base));
        });
    }
});

// ===========================================================================
// 2. The floor is now a NO-OP backstop — the search avoids over-conversion natively,
//    so the default path never falls back to the std-ded baseline.
// ===========================================================================
describe('feasibility floor is a no-op backstop under engine-direct search', TIMEOUT, () => {
    for (const p of PANEL) {
        it(`does not engage on: ${p.name}`, () => {
            const { engine } = fixture(p.name, p.build);
            expect(!!engine[0].feasibilityFloorApplied).toBe(false);
        });
    }
});

// ===========================================================================
// 3. DOMINANCE: engine-search >= the legacy DP everywhere; strictly better where the DP
//    mis-converted. (Same situation ruler scores both, so the year-0 scalars are comparable.)
// ===========================================================================
describe('engine-direct search dominates the legacy DP', TIMEOUT, () => {
    for (const p of PANEL) {
        it(`engine-search >= legacy DP on: ${p.name}`, () => {
            const { engine, dp } = fixture(p.name, p.build);
            const e = engine[0].strategyTerminalAfterTaxNW!;
            const d = dp[0].strategyTerminalAfterTaxNW!;
            expect(e).toBeGreaterThanOrEqual(d - Math.max(2_000, Math.abs(d) * 2e-3));
        });
    }

    // NOTE: a direct "engine > legacy-DP on the over-converter" assertion would be confounded —
    // runSimulationWithOptimization applies the feasibility floor to BOTH paths, so the legacy DP
    // is itself floored to the baseline there. That the RAW over-converting plan loses is proven
    // unfloored, via the harness, in the "over-conversion is real" block below.
});

// ===========================================================================
// 4. HITS THE PEAK — scaling the shipped plan up OR down doesn't materially beat it.
//    This is the property the floor could not achieve (it only guaranteed >= baseline).
// ===========================================================================
describe('engine-direct search sits at the wealth peak (no over- AND no material under-conversion)', TIMEOUT, () => {
    for (const p of PANEL) {
        it(`shipped plan is at the peak on: ${p.name}`, () => {
            const { sweep } = fixture(p.name, p.build);
            if (!sweep) return; // nothing converted → nothing to optimize
            // No over-conversion: scaling DOWN never wins.
            expect(sweep.risingToBottom).toBe(false);
            const at1 = sweep.points.find(pt => pt.factor === 1)!.score;
            const best = Math.max(...sweep.points.map(pt => pt.score));
            // The shipped (1×) plan is within a small tolerance of the best uniform scaling — i.e.
            // you cannot materially beat it by scaling either way. Tolerance covers the search's
            // 1-D-headroom vs uniform-scaling approximation + float noise.
            expect(at1).toBeGreaterThanOrEqual(best - Math.max(5_000, Math.abs(best) * 5e-3));
        });
    }
});

// ===========================================================================
// 5. The over-conversion is REAL (a draining plan fails the floor), and the shipped plan
//    neutralizes it while keeping Traditional (it does NOT ship a drain-to-$0 plan).
// ===========================================================================
describe('over-conversion is real on the over-converter; the search neutralizes it', TIMEOUT, () => {
    it('a draining plan scores BELOW the std-ded baseline (feasibility violation)', () => {
        const sc = makeSSHeavyScenario();
        const drain = flatGapYearPlan(sc, 250_000); // ~drains the $1.5M Traditional toward $0
        const fl = feasibilityFloor(sc, drain);
        expect(fl.passes).toBe(false);
        expect(fl.gap).toBeLessThan(0);
    });

    it('the shipped plan clears the floor and retains Traditional', () => {
        const { engine } = fixture(PANEL[0].name, PANEL[0].build);
        expect(engine[0].strategyTerminalAfterTaxNW!).toBeGreaterThanOrEqual(engine[0].stdDedBaselineTerminalAfterTaxNW! - 1);
        const last = engine[engine.length - 1];
        const trad = last.accounts
            .filter((a): a is InvestedAccount => a instanceof InvestedAccount && (a.taxType === 'Traditional IRA' || a.taxType === 'Traditional 401k'))
            .reduce((s, a) => s + (a.vestedAmount ?? 0), 0);
        expect(trad).toBeGreaterThan(200_000);
    });
});

// ===========================================================================
// 6. WIRING (#3) + READOUT (#94).
// ===========================================================================
describe('wiring + readout', TIMEOUT, () => {
    it('unset rothConversionStrategy routes through the engine-search default (reproduces it)', () => {
        const sc = makeRealSSLargeTradScenario();
        const explicit = optimize(sc);
        const sc2 = makeRealSSLargeTradScenario();
        delete (sc2.assumptions.investments as Partial<AssumptionsState['investments']>).rothConversionStrategy;
        const def = optimize(sc2);
        expect(def[0].strategyTerminalAfterTaxNW!).toBeCloseTo(explicit[0].strategyTerminalAfterTaxNW!, 4);
    });

    it('the search actually converts on a profile that warrants it', () => {
        const { engine } = fixture(PANEL[1].name, PANEL[1].build);
        const total = [...executedConversionsByYear(engine).values()].reduce((s, v) => s + v, 0);
        expect(total).toBeGreaterThan(100_000);
    });

    it('the std-ded-only strategy reads a $0 after-tax-wealth gain', () => {
        const sc = makeRealSSLargeTradScenario();
        sc.assumptions.investments.rothConversionStrategy = 'std-ded-only';
        const y0 = optimize(sc)[0];
        expect(y0.strategyTerminalAfterTaxNW!).toBeCloseTo(y0.stdDedBaselineTerminalAfterTaxNW!, 6);
    });

    it('"After-Tax Wealth Gained" (strategy − baseline) is >= 0 across the whole panel', () => {
        for (const p of PANEL) {
            const { engine } = fixture(p.name, p.build);
            expect(engine[0].strategyTerminalAfterTaxNW! - engine[0].stdDedBaselineTerminalAfterTaxNW!).toBeGreaterThanOrEqual(-1);
        }
    });
});

// ===========================================================================
// 7. WIDENED CERTIFICATE (fp-review F6). Blocks 1-4 certify the shipped plan at ONE
//    horizon (the profile's configured LE) and only along the uniform-scaling ray —
//    a plan could be horizon-fragile or shape-wrong (right total, wrong YEARS) without
//    any of them failing. The three probes below bound that:
//      7a. HORIZON BAND    — re-score the shipped plan at LE−8 / LE+8; it must still
//                            clear the std-ded floor (not by construction there: the
//                            search optimized at the original LE only).
//      7b. PER-YEAR ±$10k  — first-order-condition check on representative conversion
//                            years (first / peak / last nonzero): no single-year nudge
//                            beats the shipped plan. Certifies optimality along per-year
//                            axes OUTSIDE the fill-to-h family.
//      7c. TWO-SCALAR      — pre-SS vs post-SS conversions scaled independently; the
//                            flat-h winner isn't materially beaten by a split-h shape.
//    Slack everywhere matches block 4's scaling-sweep convention: max($5k, 0.5%).
//    IF A PROFILE FAILS HERE, THAT IS A REAL DISCOVERY (foregone upside or horizon
//    fragility the certificate previously couldn't see) — investigate and report it;
//    do NOT widen the slack to make it pass.
// ===========================================================================

/** Block-4 slack convention (scaling-sweep peak check): max($5k, 0.5%). */
const peakSlack = (v: number) => Math.max(5_000, Math.abs(v) * 5e-3);

/** Clone `sc` with the End-of-Plan milestone moved to `le` and the horizon run out to it. */
function atLifeExpectancy(sc: Scenario, le: number): Scenario {
    const birthYear = getBirthYear(sc.assumptions.milestones);
    const retireAge = getRetirementAge(sc.assumptions.milestones);
    return {
        ...sc,
        assumptions: { ...sc.assumptions, milestones: createBuiltinMilestones(birthYear, retireAge, le) },
        yearsToRun: le - retireAge,
    };
}

/**
 * Re-order `sc`'s stored withdrawalStrategy to the order the optimizer actually shipped
 * under (engine[0].chosenWithdrawalOrder) — same reasoning as the scaling-sweep fixture:
 * re-scoring a Traditional-preserving plan under a trad-first order would spuriously
 * look mis-converted.
 */
function underChosenOrder(sc: Scenario, engine: SimulationYear[]): Scenario {
    const chosen = engine[0].chosenWithdrawalOrder;
    if (!chosen) return sc;
    return {
        ...sc,
        assumptions: {
            ...sc.assumptions,
            withdrawalStrategy: chosen
                .map(c => sc.assumptions.withdrawalStrategy.find(w => w.accountId === c.accountId)!)
                .filter(Boolean),
        },
    };
}

describe('widened certificate (F6a) — shipped plan clears the std-ded floor at LE −8 and +8', TIMEOUT, () => {
    for (const p of PANEL) {
        for (const delta of [-8, +8]) {
            it(`${p.name} @ LE${delta > 0 ? '+' : ''}${delta}`, () => {
                const { sc, engine } = fixture(p.name, p.build);
                const plan = executedConversionsByYear(engine);
                const le = getLifeExpectancy(sc.assumptions.milestones) + delta;
                // Re-score the SHIPPED plan (unchanged) in the same household living to a
                // different age, against the std-ded floor recomputed AT that horizon with
                // the ruler rebuilt from that horizon's baseline. All conversion years in
                // the shipped plans end before RMD start (73/75) < LE−8, so no plan year
                // falls off the shorter horizon.
                const scH = underChosenOrder(atLifeExpectancy(sc, le), engine);
                const fl = feasibilityFloor(scH, plan);
                // A plan that only wins at exactly the optimized LE is horizon-fragile.
                // Slack (vs the floor test's near-exact eps) because off-horizon the
                // floor is NOT guaranteed by construction — we certify "doesn't lose
                // materially", the block-4 convention.
                expect(fl.gap, `gap vs floor at LE=${le}`).toBeGreaterThanOrEqual(-peakSlack(fl.floorScore));
            });
        }
    }
});

// Per-profile perturbation fixture: ONE shared ruler (std-ded baseline at the profile's
// own horizon, under the chosen order) + the shipped plan's base score. Memoized so 7b
// and 7c reuse it (3 sims to build, then 1 sim per probe).
interface PerturbFixture { scOrdered: Scenario; ruler: SimulationYear[]; plan: ConversionPlan; base: PlanScore; }
const perturbCache = new Map<string, PerturbFixture>();
function perturbFixture(name: string, build: () => Scenario): PerturbFixture {
    let f = perturbCache.get(name);
    if (!f) {
        const { sc, engine } = fixture(name, build);
        const scOrdered = underChosenOrder(sc, engine);
        const plan = executedConversionsByYear(engine);
        const floorPlan = stdDedOnlyPlan(scOrdered);
        const ruler = runSimulation(
            scOrdered.yearsToRun, scOrdered.accounts, scOrdered.incomes, scOrdered.expenses,
            scOrdered.assumptions, scOrdered.taxState, undefined, { dpConversionPlan: floorPlan },
        );
        const base = scorePlan(scOrdered, plan, ruler);
        f = { scOrdered, ruler, plan, base };
        perturbCache.set(name, f);
    }
    return f;
}

/** First, peak (largest), and last nonzero conversion years of a plan (deduped). */
function representativeYears(plan: ConversionPlan): number[] {
    const nz = [...plan.entries()].filter(([, v]) => v > 0.5).sort((a, b) => a[0] - b[0]);
    if (nz.length === 0) return [];
    let peak = nz[0];
    for (const e of nz) if (e[1] > peak[1]) peak = e;
    return [...new Set([nz[0][0], peak[0], nz[nz.length - 1][0]])];
}

describe('widened certificate (F6b) — no single-year ±$10k perturbation beats the shipped plan', TIMEOUT, () => {
    for (const p of PANEL) {
        it(`first-order condition holds on: ${p.name}`, () => {
            const f = perturbFixture(p.name, p.build);
            const years = representativeYears(f.plan);
            if (years.length === 0) return; // nothing converted → nothing to perturb
            for (const year of years) {
                for (const d of [-10_000, +10_000]) {
                    const original = f.plan.get(year) ?? 0;
                    const amt = Math.max(0, original + d);
                    if (amt === original) continue; // fully clamped nudge is a no-op
                    const perturbed = new Map(f.plan);
                    perturbed.set(year, amt);
                    const s = scorePlan(f.scOrdered, perturbed, f.ruler);
                    // If moving ONE year by $10k beats the shipped plan by more than the
                    // block-4 slack, the optimum has per-year structure the fill-to-h
                    // family (and the uniform-scaling sweep) cannot see.
                    expect(s.terminalAfterTaxNW, `year ${year} ${d > 0 ? '+' : ''}${d}`)
                        .toBeLessThanOrEqual(f.base.terminalAfterTaxNW + peakSlack(f.base.terminalAfterTaxNW));
                }
            }
        });
    }
});

describe('widened certificate (F6c) — independent pre/post-SS scaling does not beat the flat-h winner', TIMEOUT, () => {
    // Only the real-SS profile has a live SS start (age 67) splitting its conversion years —
    // the one household where a split-h shape (higher h before the torpedo arrives, lower
    // after) could plausibly beat the flat-h family. 4 extra sims.
    it('real-SS large Trad: pre-SS × post-SS ∈ {0.9, 1.1}² never wins materially', () => {
        const p = PANEL[1];
        const f = perturbFixture(p.name, p.build);
        const ssStartYear = getBirthYear(f.scOrdered.assumptions.milestones) + 67; // claim age fixed at 67 in the fixture
        const pre = [...f.plan.keys()].filter(y => y < ssStartYear);
        const post = [...f.plan.keys()].filter(y => y >= ssStartYear && (f.plan.get(y) ?? 0) > 0.5);
        expect(pre.length, 'fixture must convert before SS starts').toBeGreaterThan(0);
        expect(post.length, 'fixture must convert after SS starts').toBeGreaterThan(0);
        for (const preF of [0.9, 1.1]) {
            for (const postF of [0.9, 1.1]) {
                const scaled: ConversionPlan = new Map();
                for (const [y, v] of f.plan) scaled.set(y, v * (y < ssStartYear ? preF : postF));
                const s = scorePlan(f.scOrdered, scaled, f.ruler);
                expect(s.terminalAfterTaxNW, `pre×${preF} post×${postF}`)
                    .toBeLessThanOrEqual(f.base.terminalAfterTaxNW + peakSlack(f.base.terminalAfterTaxNW));
            }
        }
    });
});
