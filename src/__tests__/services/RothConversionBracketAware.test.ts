/**
 * #89 regression: the DP-precomputed Roth conversion strategy must be
 * WEALTH-OPTIMAL, not merely "never drains".
 *
 * The original pathology was the *retired min-tax* objective over-draining
 * Traditional to ~$0 — converting past the point where it adds after-tax wealth.
 * The fix (bracket-aware terminal) is allowed to drain a residual whose real exit
 * rate is high (that's wealth-positive); it must only avoid converting PAST the
 * wealth peak. So we assert: current after-tax terminal wealth ≥ the full-drain
 * alternative (the old min-tax plan, which drains to ~$0 here).
 *
 * Synthetic high-growth FIRE shape (~9.5% nominal) — the regime where min-tax
 * historically zeroed Traditional out. Synthetic, PII-free numbers only.
 */
import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { runSimulation, runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import { SimulationYear } from '../../services/simulation/types';
import * as TaxService from '../../components/Objects/Taxes/TaxService';
import { bracketAwareTradExitValue } from '../../services/simulation/RothConversionDP';
import { TAX_DATABASE, FilingStatus } from '../../data/TaxData';
import { EarningsRecord } from '../../services/SocialSecurityCalculator';

/** Standard LTCG rate applied to brokerage unrealized gains in the realized-wealth
 *  score. A fixed mid-bracket assumption; only needs to be applied consistently across
 *  the compared runs. */
const LTCG_RATE = 0.15;

const BIRTH_YEAR = 1985;
const RETIRE_AGE = 45;
const LIFE_EXP = 90;
const YEARS = LIFE_EXP - (2025 - BIRTH_YEAR) + 2;
const FILING: FilingStatus = 'Single';
const G = (7 + 2.5 - 0.2) / 100; // ~9.3% net nominal

type DpObjective = Parameters<typeof runSimulationWithOptimization>[11];

function assumptions(overrides: Partial<AssumptionsState['investments']> = {}): AssumptionsState {
    return {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(BIRTH_YEAR, RETIRE_AGE, LIFE_EXP),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 2.5, inflationAdjusted: true },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
            taxOptimizationEnabled: true,
            autoRothConversions: true,
            rothConversionStrategy: 'dp-precomputed',
            ...overrides,
        },
        withdrawalStrategy: [
            { id: 'ws-savings', name: 'Savings', accountId: 'acc-savings' },
            { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
            { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-traditional' },
        ],
    };
}
const taxState: TaxState = { filingStatus: FILING, stateResidency: 'Texas', deductionMethod: 'Standard', fedOverride: null, ficaOverride: null, stateOverride: null, year: 2025 };
const accounts = (): AnyAccount[] => [
    new InvestedAccount('acc-traditional', 'Traditional IRA', 900_000, 0, 10, 0.05, 'Traditional IRA', true, 0.2, 900_000),
    new InvestedAccount('acc-roth', 'Roth IRA', 250_000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 250_000),
    new InvestedAccount('acc-brokerage', 'Brokerage', 850_000, 0, 10, 0.05, 'Brokerage', true, 0.2, 650_000),
    new SavedAccount('acc-savings', 'Savings', 40_000, 4),
];
const incomes = () => [new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 2_800, 2025)];
const expenses = () => [new FoodExpense('exp-living', 'Living Expenses', 80_000, 'Annually', new Date('2025-01-01'))];

function run(invOverrides: Partial<AssumptionsState['investments']>, dpObjective?: DpObjective): SimulationYear[] {
    return runSimulationWithOptimization(YEARS, accounts(), incomes(), expenses(), assumptions(invOverrides), taxState, undefined, new Date('2025-06-15'), undefined, undefined, undefined, dpObjective);
}

const sumInv = (y: SimulationYear, tt: string, f: 'vestedAmount' | 'costBasis') => y.accounts.filter((a): a is InvestedAccount => a instanceof InvestedAccount && a.taxType === tt).reduce((x, a) => x + (a[f] ?? 0), 0);
const terminalTrad = (res: SimulationYear[]) => sumInv(res[res.length - 1], 'Traditional IRA', 'vestedAmount');

/**
 * Realized total after-tax terminal wealth: Roth + the residual Trad's bracket-aware
 * self-liquidate exit value + brokerage net of LTCG + savings at face.
 *
 * The residual Trad is valued with the PRODUCTION `bracketAwareTradExitValue` (#15) —
 * not a re-implemented drawdown loop with a hardcoded tail rate — so this score can't
 * drift from what the DP actually optimizes (e.g. the #10 COLA and #14 tail-rate
 * changes flow through automatically).
 *
 * Note (#9): this is the USER-FACING realized wealth, a superset of the DP's internal
 * objective. The DP maximizes a discounted, brokerage-leak-charged proxy (terminal
 * roth + tradExit minus per-year brokerage taps), which can't be reconstructed from
 * terminal balances alone. Realized total wealth is the faithful, honest regression
 * target for "did the plan convert past the wealth peak" — and it's applied identically
 * to both compared runs, so the ≥ comparison is sound.
 */
function afterTaxWealth(res: SimulationYear[]): number {
    const y = res[res.length - 1];
    const ss = TaxService.getSocialSecurityBenefits(y.incomes, y.year);
    const fixed = Math.max(0, TaxService.getGrossIncome(y.incomes, y.year) - ss);
    const trad = sumInv(y, 'Traditional IRA', 'vestedAmount'), roth = sumInv(y, 'Roth IRA', 'vestedAmount');
    const bv = sumInv(y, 'Brokerage', 'vestedAmount'), bb = sumInv(y, 'Brokerage', 'costBasis');
    const savings = y.accounts.filter((a): a is SavedAccount => a instanceof SavedAccount).reduce((x, a) => x + ((a as unknown as { amount?: number }).amount ?? 0), 0);
    const fed = TAX_DATABASE.federal[2024][FILING];
    // COLA = the sim's 2.5% inflationAdjusted setting (grows SS/fixed across the drawdown).
    const tradExit = bracketAwareTradExitValue(trad, LIFE_EXP, G, fed, FILING, 'self-liquidate', ss, fixed, 0.025);
    return roth + tradExit + (bv - Math.max(0, bv - bb) * LTCG_RATE) + savings;
}

describe('#89 bracket-aware DP Roth conversion — wealth-optimality', { timeout: 120_000 }, () => {
    it('the OLD min-tax objective over-drains Traditional to ~$0 (pathology repro)', () => {
        // Without conversions this trad balloons to tens of millions at ~9.3%;
        // min-tax converts it down to nearly nothing. This makes the comparison
        // below a genuine "full-drain alternative".
        expect(terminalTrad(run({}, { objectiveMode: 'min-tax' }))).toBeLessThan(1_000_000);
    });

    it('current plan is WEALTH-OPTIMAL vs the full-drain alternative (does not convert past the peak)', () => {
        const wBracketAware = afterTaxWealth(run({}, { objectiveMode: 'max-wealth', terminalValuation: 'bracket-aware', userSituation: 'self-liquidate' }));
        const wFullDrain = afterTaxWealth(run({}, { objectiveMode: 'min-tax' }));
        // The bracket-aware plan must do at least as well as draining everything.
        expect(wBracketAware).toBeGreaterThanOrEqual(wFullDrain);
    });

    it('production DEFAULT strategy (unset → flipped to dp-precomputed) routes THROUGH the bracket-aware DP, not rate-match (#3)', () => {
        // Unset rothConversionStrategy entirely → it must fall through to the flipped
        // dp-precomputed default AND actually build+execute the DP plan. The #3 bug
        // resolved the strategy for PLANNING but handed the raw (unset) assumptions to
        // the Pass-3 executor, which fell back to rate-match and silently DISCARDED the
        // DP plan. The old `> min-tax-drain` assertion couldn't see that — rate-match
        // also beats the full drain. So we now assert the unset default reproduces the
        // EXPLICIT bracket-aware DP run (identical derived objective: max-wealth /
        // bracket-aware / self-liquidate / 2.5% COLA), which only holds if the executor
        // ran the DP plan rather than rate-match.
        const def = assumptions();
        delete (def.investments as Partial<AssumptionsState['investments']>).rothConversionStrategy;
        const defaultRun = runSimulationWithOptimization(YEARS, accounts(), incomes(), expenses(), def, taxState, undefined, new Date('2025-06-15'));
        const explicitDp = run({}, { objectiveMode: 'max-wealth', terminalValuation: 'bracket-aware', userSituation: 'self-liquidate', terminalCola: 0.025 });
        // Same DP plan executed → terminal Trad matches (rate-match would diverge sharply).
        expect(Math.abs(terminalTrad(defaultRun) - terminalTrad(explicitDp))).toBeLessThan(1);
        // …and clearly not the min-tax full-drain.
        expect(terminalTrad(defaultRun)).toBeGreaterThan(terminalTrad(run({}, { objectiveMode: 'min-tax' })));
    });

    it('userSituation adapts: bequeath converts more aggressively than self-liquidate', () => {
        const selfLiq = terminalTrad(run({}, { objectiveMode: 'max-wealth', terminalValuation: 'bracket-aware', userSituation: 'self-liquidate' }));
        const bequeath = terminalTrad(run({}, { objectiveMode: 'max-wealth', terminalValuation: 'bracket-aware', userSituation: 'bequeath' }));
        expect(bequeath).toBeLessThan(selfLiq);
    });
});

// =============================================================================
// #89 OVER-CONVERSION GUARD — the DP must sit at the after-tax-wealth PEAK, not
// merely ≥ the full-drain alternative. The bare ">= full-drain" test above passes
// even if the DP over-converts SOMEWHERE BETWEEN the true peak and full-drain (the
// #4-class bug). This guard scales the DP's OWN per-year conversions by a grid and
// asserts 1× is the max: if a future change makes the DP over-convert, scaling DOWN
// (0.5×, 0.75×) beats it; if it under-converts, scaling UP (1.25×, 1.5×) beats it —
// either way 1× stops being the max and the test fails. Deterministic, 5 forward
// sims, no Monte-Carlo.
//
// Fixture: LOW-growth + realistic SS, where the wealth-vs-aggressiveness curve has a
// clear INTERIOR peak (both neighbors strictly lower). The high-growth shape above is
// unsuitable — its peak sits near full-drain, so it doesn't exercise the over-convert
// guard. Anchored to the current year so the scenario shape is stable as years pass.
// =============================================================================
describe('#89 over-conversion guard — DP at the interior wealth peak', { timeout: 180_000 }, () => {
    const NOW = new Date().getFullYear();
    const BY = NOW - 63;          // age 63 today (early retirement, pre-RMD conversion window)
    const RA = 62, LE = 90, ROR = 2.5;
    const YRS = LE - (NOW - BY) + 2;
    const gS2 = (ROR + 2.5 - 0.2) / 100; // ~4.3% net nominal
    const refS2 = new Date(`${NOW}-06-15`);

    // 35-yr earnings history → non-zero PIA → realistic SS (torpedo active). Without it
    // PIA=0 and the interior peak the guard relies on doesn't form.
    const priorEarn = (): EarningsRecord[] => {
        const r: EarningsRecord[] = [];
        for (let a = 25; a <= 59; a++) r.push({ year: BY + a, amount: 95_000 });
        return r;
    };
    const asmp = (inv: Partial<AssumptionsState['investments']> = {}): AssumptionsState => ({
        ...defaultAssumptions,
        demographics: { priorEarnings: priorEarn() },
        milestones: createBuiltinMilestones(BY, RA, LE),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 2.5, inflationAdjusted: true },
        investments: {
            ...defaultAssumptions.investments, returnRates: { ror: ROR },
            taxOptimizationEnabled: true, autoRothConversions: true,
            rothConversionStrategy: 'dp-precomputed', ...inv,
        },
        withdrawalStrategy: [
            { id: 'ws-savings', name: 'Savings', accountId: 'acc-savings' },
            { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
            { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-traditional' },
        ],
    });
    const accS2 = (): AnyAccount[] => [
        new InvestedAccount('acc-traditional', 'Traditional IRA', 1_200_000, 0, 10, 0.05, 'Traditional IRA', true, 0.2, 1_200_000),
        new InvestedAccount('acc-roth', 'Roth IRA', 200_000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 200_000),
        new InvestedAccount('acc-brokerage', 'Brokerage', 400_000, 0, 10, 0.05, 'Brokerage', true, 0.2, 320_000),
        new SavedAccount('acc-savings', 'Savings', 40_000, 4),
    ];
    const incS2 = () => [new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 3_000, NOW)];
    const expS2 = () => [new FoodExpense('exp-living', 'Living Expenses', 70_000, 'Annually', new Date(`${NOW}-01-01`))];

    /** Full realized after-tax wealth at the life-expectancy year (production exit valuation). */
    const score = (res: SimulationYear[]): number => {
        const y = res.find(r => r.year === BY + LE) ?? res[res.length - 1];
        const ss = TaxService.getSocialSecurityBenefits(y.incomes, y.year);
        const fixed = Math.max(0, TaxService.getGrossIncome(y.incomes, y.year) - ss);
        const trad = sumInv(y, 'Traditional IRA', 'vestedAmount'), roth = sumInv(y, 'Roth IRA', 'vestedAmount');
        const bv = sumInv(y, 'Brokerage', 'vestedAmount'), bb = sumInv(y, 'Brokerage', 'costBasis');
        const savings = y.accounts.filter((a): a is SavedAccount => a instanceof SavedAccount).reduce((x, a) => x + ((a as unknown as { amount?: number }).amount ?? 0), 0);
        const fed = TAX_DATABASE.federal[2024][FILING];
        const tradExit = bracketAwareTradExitValue(trad, LE, gS2, fed, FILING, 'self-liquidate', ss, fixed, 0.025);
        return roth + tradExit + (bv - Math.max(0, bv - bb) * LTCG_RATE) + savings;
    };

    it('1× is the max of the conversion-scaling grid (and ≥ full-drain)', () => {
        // Shipped DP plan (production-derived max-wealth bracket-aware objective).
        const dpRes = runSimulationWithOptimization(YRS, accS2(), incS2(), expS2(), asmp(), taxState, undefined, refS2);
        const plan = new Map<number, number>();
        for (const y of dpRes) if ((y.rothConversion?.amount ?? 0) > 0) plan.set(y.year, y.rothConversion!.amount);
        expect(plan.size).toBeGreaterThan(0); // the fixture actually converts

        // Score the plan scaled by k (clamped to available Trad by the executor).
        const exec = asmp({ rothConversionStrategy: 'dp-precomputed' });
        const scoreScaled = (k: number): number => {
            const scaled = new Map<number, number>();
            for (const [yr, amt] of plan) scaled.set(yr, amt * k);
            const res = runSimulation(YRS, accS2(), incS2(), expS2(), exec, taxState, undefined, { referenceDate: refS2, conversionMode: 'rate-match', useRollingBaseline: false, dpConversionPlan: scaled });
            return score(res);
        };
        const grid = [0.5, 0.75, 1.0, 1.25, 1.5];
        const w: Record<number, number> = {};
        for (const k of grid) w[k] = scoreScaled(k);

        // 1× is the max of the grid (deterministic → effectively exact; $1 jitter slack).
        for (const k of grid) expect(w[1.0]).toBeGreaterThanOrEqual(w[k] - 1);
        // …and a STRICT interior peak: both immediate neighbors are below it (not a plateau
        // at an endpoint), so the guard genuinely brackets over- AND under-conversion.
        expect(w[1.0]).toBeGreaterThan(w[0.75]);
        expect(w[1.0]).toBeGreaterThan(w[1.25]);

        // Upper bracket retained: the DP does not over-convert all the way to full-drain.
        const fullDrain = runSimulationWithOptimization(YRS, accS2(), incS2(), expS2(), asmp(), taxState, undefined, refS2, undefined, undefined, undefined, { objectiveMode: 'min-tax' });
        expect(w[1.0]).toBeGreaterThanOrEqual(score(fullDrain) - 1);
    });
});
