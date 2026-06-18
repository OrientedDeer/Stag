/**
 * MC over-conversion cap (#89) — validation.
 *
 * The Monte-Carlo closed-loop policy is DP-solved, so it inherited the deterministic DP's
 * over-conversion on the low/no-SS, large-Traditional, trad-first corner. buildMcConversionPolicy
 * now runs the deterministic engine-search and rides its optimum (h*) on the policy as
 * `capHeadroom`; each path caps its conversion at fill-to-(stdDed + h*) (YearSolver.planConversionDP).
 * SELECTIVE: when the legacy DP wins the deterministic search (real-SS profiles, where it's already
 * optimal), capHeadroom is undefined ⇒ NO cap, preserving the #98 policy + its bull-path adaptivity.
 *
 * These tests prove (a) the cap engages selectively, and (b) on the corner it neutralizes the
 * over-conversion WITHOUT regressing the downside (paired same-seed capped-vs-uncapped after-tax
 * comparison; the production MC summary is nominal-only, so we score after-tax per-path here).
 */
import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { EarningsRecord } from '../../services/SocialSecurityCalculator';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import { solveMcConversionPlan, mcYearsToRun } from '../../services/MonteCarloEngine';
import { SeededRandom } from '../../services/RandomGenerator';
import { buildTradValuation, terminalAfterTaxNetWorth } from '../../tabs/Future/tabs/FutureUtils';
import { DPPolicy } from '../../services/simulation/RothConversionDP';
import type { MonteCarloConfig } from '../../services/MonteCarloTypes';
import { Scenario, makeSSHeavyScenario, makeLowBracketBrokerageScenario } from './harness';

const TIMEOUT = { timeout: 240_000 };
const mcConfig = (o: Partial<MonteCarloConfig> = {}): MonteCarloConfig => ({
    enabled: true, numScenarios: 40, seed: 12345, returnMean: 5, returnStdDev: 12, preset: 'custom', ...o,
});

/** real-SS large-Traditional: the control where the legacy DP is optimal → the cap must NOT engage. */
function makeRealSSLargeTradScenario(): Scenario {
    const NOW = new Date().getFullYear();
    const BY = NOW - 62, RA = 62, LE = 92, ROR = 5;
    const priorEarnings: EarningsRecord[] = [];
    for (let a = 25; a <= 59; a++) priorEarnings.push({ year: BY + a, amount: 130_000 });
    const assumptions: AssumptionsState = {
        ...defaultAssumptions, demographics: { priorEarnings },
        milestones: createBuiltinMilestones(BY, RA, LE),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments, returnRates: { ror: ROR },
            taxOptimizationEnabled: true, autoRothConversions: true, rothConversionStrategy: 'dp-precomputed',
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

const solvePolicy = (sc: Scenario, cfg: MonteCarloConfig) =>
    solveMcConversionPlan(cfg, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState);

/** Per-path after-tax MC score (median / p10 of terminal after-tax NW + median total converted). */
function scoreMc(sc: Scenario, policy: DPPolicy | undefined, plan: Map<number, number> | undefined, cfg: MonteCarloConfig) {
    const years = mcYearsToRun(sc.assumptions);
    const baseAssumptions: AssumptionsState = { ...sc.assumptions, investments: { ...sc.assumptions.investments, rothConversionStrategy: 'rate-match' } };
    const baseline = runSimulation(years, sc.accounts, sc.incomes, sc.expenses, baseAssumptions, sc.taxState, undefined, { conversionMode: 'std-ded-only' });
    const ruler = buildTradValuation(baseline, sc.assumptions, sc.taxState);
    const rng = new SeededRandom(cfg.seed);
    const nws: number[] = []; const totals: number[] = [];
    for (let i = 0; i < cfg.numScenarios; i++) {
        const returns = rng.generateReturns(years, cfg.returnMean, cfg.returnStdDev);
        const tl = runSimulation(years, sc.accounts, sc.incomes, sc.expenses, sc.assumptions, sc.taxState, returns, { dpConversionPlan: plan, mcConversionPolicy: policy });
        nws.push(terminalAfterTaxNetWorth(tl, ruler));
        totals.push(tl.reduce((s, y) => s + (y.rothConversion?.amount ?? 0), 0));
    }
    nws.sort((a, b) => a - b); totals.sort((a, b) => a - b);
    const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
    return { median: q(nws, 0.5), p10: q(nws, 0.1), medianConv: q(totals, 0.5) };
}

describe('#89 MC over-conversion cap — selective engagement', TIMEOUT, () => {
    it('capHeadroom is SET on the over-converter (low/no-SS large-Trad) and UNSET on real-SS', () => {
        const over = solvePolicy(makeSSHeavyScenario(), mcConfig());
        expect(over.policy).toBeDefined();
        expect(over.policy!.capHeadroom).toBeDefined(); // the deterministic search's winner is std-ded/fill-to-h → cap engages

        const realSS = solvePolicy(makeRealSSLargeTradScenario(), mcConfig());
        expect(realSS.policy).toBeDefined();
        expect(realSS.policy!.capHeadroom).toBeUndefined(); // legacy DP wins → no cap → #98 policy preserved
    });
});

describe('#89 MC over-conversion cap — neutralizes over-conversion without regressing the downside', TIMEOUT, () => {
    it('on the over-converter: capped converts less AND median/p10 after-tax are not worse (paired, same seed)', () => {
        const sc = makeSSHeavyScenario();
        const cfg = mcConfig();
        const solved = solvePolicy(sc, cfg);
        const capped = solved.policy!;
        expect(capped.capHeadroom).toBeDefined();
        const uncapped: DPPolicy = { ...capped, capHeadroom: undefined }; // the raw #98 policy

        const cappedScore = scoreMc(sc, capped, solved.plan, cfg);
        const uncappedScore = scoreMc(sc, uncapped, solved.plan, cfg);

        // eslint-disable-next-line no-console
        console.log(`[mc-cap] over-converter capped vs uncapped — median $${Math.round(cappedScore.median).toLocaleString()} vs $${Math.round(uncappedScore.median).toLocaleString()}; ` +
            `p10 $${Math.round(cappedScore.p10).toLocaleString()} vs $${Math.round(uncappedScore.p10).toLocaleString()}; ` +
            `medianConv $${Math.round(cappedScore.medianConv).toLocaleString()} vs $${Math.round(uncappedScore.medianConv).toLocaleString()}`);

        // The cap binds: the over-converting policy converts strictly less once capped.
        expect(cappedScore.medianConv).toBeLessThan(uncappedScore.medianConv);
        // Downside NOT regressed (same seed ⇒ paired; over-conversion hurt, so capped should win or tie).
        const tol = (x: number) => Math.max(1, Math.abs(x) * 1e-6);
        expect(cappedScore.median).toBeGreaterThanOrEqual(uncappedScore.median - tol(uncappedScore.median));
        expect(cappedScore.p10).toBeGreaterThanOrEqual(uncappedScore.p10 - tol(uncappedScore.p10));
    });

    it('on low-bracket / big-brokerage (NOT an over-converter): the cap does not regress the policy', () => {
        // Load-bearing downside check: if the cap binds where the policy wasn't over-converting,
        // it could neuter the #98 bull-path adaptivity. Whether capHeadroom is undefined (DP won →
        // no cap → identical) or defined-but-non-binding, median/p10 after-tax must not drop.
        const sc = makeLowBracketBrokerageScenario();
        const cfg = mcConfig();
        const solved = solvePolicy(sc, cfg);
        const capped = solved.policy!;
        const uncapped: DPPolicy = { ...capped, capHeadroom: undefined };
        const cappedScore = scoreMc(sc, capped, solved.plan, cfg);
        const uncappedScore = scoreMc(sc, uncapped, solved.plan, cfg);
        // eslint-disable-next-line no-console
        console.log(`[mc-cap] low-bracket capped vs uncapped (capHeadroom=${capped.capHeadroom}) — median $${Math.round(cappedScore.median).toLocaleString()} vs $${Math.round(uncappedScore.median).toLocaleString()}; ` +
            `p10 $${Math.round(cappedScore.p10).toLocaleString()} vs $${Math.round(uncappedScore.p10).toLocaleString()}`);
        const tol = (x: number) => Math.max(1, Math.abs(x) * 1e-4);
        expect(cappedScore.median).toBeGreaterThanOrEqual(uncappedScore.median - tol(uncappedScore.median));
        expect(cappedScore.p10).toBeGreaterThanOrEqual(uncappedScore.p10 - tol(uncappedScore.p10));
    });
});
