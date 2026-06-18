/**
 * Roth conversion CORRECTNESS — rebuilt from scratch on the cookbook's real properties,
 * scored through the validated harness (src/__tests__/roth-cookbook/harness.ts), not the
 * DP's own internal model.
 *
 * WHY rebuilt: the prior #89 tests asserted the wrong (too-weak) thing — "current plan
 * after-tax wealth >= the full-drain alternative". Per the cookbook, beating the full-drain
 * baseline is WEAKER than sitting at the wealth peak: a plan can over-convert (score below the
 * true peak) yet still beat full drain, so that assertion passes WHILE the over-conversion bug
 * is live. These tests instead assert the cookbook's actual properties:
 *
 *   PRIMARY — the FEASIBILITY FLOOR (#89): the shipped plan's after-tax terminal net worth must
 *   be >= the trivial, always-feasible std-ded-only baseline, on EVERY solvent profile. This is
 *   exactly what runSimulationWithOptimization's solvency-gated feasibility floor guarantees.
 *
 *   NO OVER-CONVERSION — scaling the shipped plan DOWN must never beat it (the cookbook's scaling
 *   sweep). HONEST LIMITATION: the floor falls back to the std-ded baseline, which is CONSERVATIVE
 *   (it mildly UNDER-converts vs the true peak), so we assert "not over-converting" (argmax not at
 *   the bottom), NOT "sits exactly at the peak". Hitting the peak needs the engine-direct-search
 *   root fix — see docs/roth-review/00-cookbook-review-synthesis.md §5.
 *
 * Profile panel of SOLVENT fixtures spanning the regimes:
 *   - over-converter: $1.5M Trad, $0 SS, MFJ, standard trad-before-roth drawdown (= makeSSHeavyScenario;
 *     note that "SS-heavy" is a MISNOMER — it actually has $0 SS, which is WHY it over-converts: with no
 *     torpedo the residual Traditional exits cheaply, so draining it past the peak gives back more tax
 *     now than it saves). The floor engages here.
 *   - real-SS large Trad: same $1.5M Trad but realistic SS (~$60k via priorEarnings). The torpedo raises
 *     the exit rate, so the DP correctly converts to the peak — the floor does NOT engage.
 *   - low-bracket / big appreciated brokerage: small Trad, cheap exit — the DP is near-optimal.
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
    Scenario, feasibilityFloor, scalingSweep, stdDedOnlyPlan, flatGapYearPlan,
    executedConversionsByYear, makeSSHeavyScenario, makeLowBracketBrokerageScenario,
} from '../roth-cookbook/harness';

const TIMEOUT = { timeout: 240_000 };

// A real-SS large-Traditional fixture (NOT in the harness): $1.5M Trad, MFJ, realistic SS via a
// 35-year earnings history, standard trad-before-roth drawdown, ~5% growth. Mirrors the over-
// converter EXCEPT it has real Social Security — the control that isolates SS as the driver.
function makeRealSSLargeTradScenario(): Scenario {
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
    const taxState: TaxState = { filingStatus: 'Married Filing Jointly', stateResidency: 'Texas', deductionMethod: 'Standard', fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW };
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

const optimize = (sc: Scenario): SimulationYear[] =>
    runSimulationWithOptimization(sc.yearsToRun, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState);

const PANEL: { name: string; build: () => Scenario; floorEngages: boolean }[] = [
    { name: 'over-converter ($1.5M Trad, $0 SS, trad-first)', build: makeSSHeavyScenario, floorEngages: true },
    { name: 'real-SS large Trad ($1.5M Trad, ~$60k SS)', build: makeRealSSLargeTradScenario, floorEngages: false },
    { name: 'low-bracket / big brokerage', build: makeLowBracketBrokerageScenario, floorEngages: false },
];

// ===========================================================================
// PRIMARY — the feasibility floor holds on the shipped plan, on EVERY profile.
// ===========================================================================
describe('feasibility floor (#89) — shipped plan never scores below the std-ded baseline', TIMEOUT, () => {
    for (const p of PANEL) {
        it(`holds on: ${p.name}`, () => {
            const res = optimize(p.build());
            const strat = res[0].strategyTerminalAfterTaxNW!;
            const base = res[0].stdDedBaselineTerminalAfterTaxNW!;
            expect(strat).toBeDefined();
            expect(base).toBeDefined();
            // After-tax "wealth gained" (strategy − baseline) must be >= 0 (small float eps).
            expect(strat).toBeGreaterThanOrEqual(base - Math.max(1, Math.abs(base) * 1e-6));
        });
    }
});

// ===========================================================================
// The floor ENGAGES on the over-converter and is a NO-OP elsewhere (selective).
// ===========================================================================
describe('feasibility floor — engages only where the DP over-converts', TIMEOUT, () => {
    for (const p of PANEL) {
        it(`${p.floorEngages ? 'engages' : 'no-op'} on: ${p.name}`, () => {
            const res = optimize(p.build());
            expect(!!res[0].feasibilityFloorApplied).toBe(p.floorEngages);
        });
    }

    it('when engaged, the fallback keeps Traditional (does NOT ship a drain-to-$0 plan)', () => {
        const res = optimize(makeSSHeavyScenario());
        expect(res[0].feasibilityFloorApplied).toBe(true);
        const last = res[res.length - 1];
        const trad = last.accounts
            .filter((a): a is InvestedAccount => a instanceof InvestedAccount && (a.taxType === 'Traditional IRA' || a.taxType === 'Traditional 401k'))
            .reduce((s, a) => s + (a.vestedAmount ?? 0), 0);
        // The std-ded fallback converts only the free headroom, so a large Traditional remains —
        // unlike the raw DP plan, which drained it toward $0.
        expect(trad).toBeGreaterThan(200_000);
    });
});

// ===========================================================================
// SHOW BOTH: over-conversion is REAL on the over-converter (a draining plan FAILS the floor),
// and the shipped plan (post-floor) CLEARS it.
// ===========================================================================
describe('over-conversion is real on the over-converter, and the floor neutralizes it', TIMEOUT, () => {
    it('a draining plan scores BELOW the std-ded baseline (feasibility violation)', () => {
        const sc = makeSSHeavyScenario();
        // ~$250k/gap-year drains the $1.5M Traditional toward $0 — what the raw DP did.
        const drain = flatGapYearPlan(sc, 250_000);
        const fl = feasibilityFloor(sc, drain);
        expect(fl.passes).toBe(false);
        expect(fl.gap).toBeLessThan(0);
    });

    it('the std-ded baseline trivially clears its own floor (sanity)', () => {
        const sc = makeSSHeavyScenario();
        const fl = feasibilityFloor(sc, stdDedOnlyPlan(sc));
        expect(fl.passes).toBe(true);
    });

    it('the shipped (floored) plan clears the floor on the over-converter', () => {
        const res = optimize(makeSSHeavyScenario());
        expect(res[0].strategyTerminalAfterTaxNW!).toBeGreaterThanOrEqual(res[0].stdDedBaselineTerminalAfterTaxNW! - 1);
    });
});

// ===========================================================================
// NO OVER-CONVERSION in the shipped plan, across the panel (honest re: mild under-conversion).
// ===========================================================================
describe('no over-conversion — scaling the shipped plan DOWN never beats it', TIMEOUT, () => {
    for (const p of PANEL) {
        it(`shipped plan is not over-converted on: ${p.name}`, () => {
            const sc = p.build();
            const res = optimize(sc);
            const plan = executedConversionsByYear(res);
            if (plan.size === 0) return; // nothing converted → nothing to over-convert
            const sweep = scalingSweep(sc, plan, [0.25, 0.5, 0.75, 1, 1.25, 1.5]);
            // Over-conversion would show as the score rising toward the SMALLEST factor
            // (scaling down helps). The floor guarantees this never happens. We do NOT assert an
            // interior peak: the floored fallback may mildly UNDER-convert (argmax > 1) — the
            // documented limitation, not a regression.
            expect(sweep.risingToBottom).toBe(false);
        });
    }
});

// ===========================================================================
// WIRING (#3) — the production default routes THROUGH the DP path (and the floor),
// not silently to rate-match.
// ===========================================================================
describe('wiring — default + dp-precomputed execute the DP/floor path', TIMEOUT, () => {
    it('unset rothConversionStrategy reproduces the explicit dp-precomputed result', () => {
        const sc = makeRealSSLargeTradScenario();
        const explicit = optimize(sc);

        const sc2 = makeRealSSLargeTradScenario();
        delete (sc2.assumptions.investments as Partial<AssumptionsState['investments']>).rothConversionStrategy;
        const def = optimize(sc2);

        // Same derived objective + executor → identical shipped after-tax NW (rate-match would diverge).
        expect(def[0].strategyTerminalAfterTaxNW!).toBeCloseTo(explicit[0].strategyTerminalAfterTaxNW!, 4);
    });

    it('the DP path actually converts on a profile that warrants it', () => {
        const res = optimize(makeRealSSLargeTradScenario());
        const total = [...executedConversionsByYear(res).values()].reduce((s, v) => s + v, 0);
        expect(total).toBeGreaterThan(100_000);
    });
});

// ===========================================================================
// READOUT (#94) — the After-Tax Wealth Gained scalars are coherent across the panel.
// ===========================================================================
describe('after-tax-wealth readout (#94) — coherent scalars', TIMEOUT, () => {
    it('baseline figure is invariant to the selected strategy (dp vs std-ded-only), to the dollar', () => {
        const a = makeRealSSLargeTradScenario();
        const dp = optimize(a)[0].stdDedBaselineTerminalAfterTaxNW!;

        const b = makeRealSSLargeTradScenario();
        b.assumptions.investments.rothConversionStrategy = 'std-ded-only';
        const sd = optimize(b)[0].stdDedBaselineTerminalAfterTaxNW!;

        expect(dp).toBeGreaterThan(0);
        expect(Math.abs(dp - sd)).toBeLessThan(1);
    });

    it('the std-ded-only strategy reads a $0 gain (strategy === baseline)', () => {
        const sc = makeRealSSLargeTradScenario();
        sc.assumptions.investments.rothConversionStrategy = 'std-ded-only';
        const y0 = optimize(sc)[0];
        expect(y0.strategyTerminalAfterTaxNW!).toBeCloseTo(y0.stdDedBaselineTerminalAfterTaxNW!, 6);
    });

    it('"After-Tax Wealth Gained" (strategy − baseline) is >= 0 across the whole panel', () => {
        for (const p of PANEL) {
            const y0 = optimize(p.build())[0];
            expect(y0.strategyTerminalAfterTaxNW! - y0.stdDedBaselineTerminalAfterTaxNW!).toBeGreaterThanOrEqual(-1);
        }
    });
});
