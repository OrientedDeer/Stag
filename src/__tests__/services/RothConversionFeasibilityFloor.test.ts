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
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { EarningsRecord } from '../../services/SocialSecurityCalculator';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import { SimulationYear } from '../../services/simulation/types';
import {
    Scenario, feasibilityFloor, scalingSweep, flatGapYearPlan,
    executedConversionsByYear, makeSSHeavyScenario, makeLowBracketBrokerageScenario,
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
