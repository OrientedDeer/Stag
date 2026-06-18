/**
 * #98 — Monte Carlo closed-loop conversion POLICY (replaced the #93 scalar overlay).
 *
 * The MC engine solves a STOCHASTIC DP once (integrating the return distribution
 * MC draws) to produce a policy: conversion as a function of (year, trad, roth)
 * state. Each path looks the policy up at its REALIZED state each year
 * (YearSolver.planConversionDP via lookupConversionPolicy) — no per-path re-solve.
 *
 * On an ON-TRACK path (flat returns = the projection RoR) we pin two properties:
 *
 *  1. WIRING (exact): the conversion the sim applies each year equals the policy
 *     looked up at that path's realized start-of-year (Traditional, Roth IRA)
 *     balances. This proves the MC path is genuinely policy-driven — the amount
 *     comes from the policy at the realized state, not a scaled fixed plan.
 *
 *  2. REDUCES TO THE DETERMINISTIC OPTIMUM (within interpolation granularity):
 *     the same years convert and the amounts match the deterministic DP schedule
 *     within a small tolerance. Unlike the old #93 overlay (which reused the
 *     exact plan map, so on-track matched to the dollar), #98 reads a policy
 *     TABLE by bilinear interpolation, so on-track agreement is bucket-level —
 *     an accepted #98 approximation, not a regression.
 *
 * Inflation-adjusted is OFF and every account's expense ratio is 0, so the MC
 * per-year override return (config.returnMean, applied flat) equals the
 * deterministic per-account growth rate (returnRates.ror) — the path is genuinely
 * on-track (meanShift 0, volatility 0 ⇒ the stochastic solve reduces to the
 * deterministic DP).
 */
import { describe, it, expect } from 'vitest';

import { runMonteCarloSimulationSync } from '../../services/MonteCarloEngine';
import { MonteCarloConfig } from '../../services/MonteCarloTypes';
import {
    runSimulationWithOptimization,
    buildMcConversionPolicy,
} from '../../components/Objects/Assumptions/useSimulation';
import { lookupConversionPolicy } from '../../services/simulation/RothConversionDP';
import { InvestedAccount, SavedAccount, AnyAccount } from '../../components/Objects/Accounts/models';
import { SocialSecurityIncome } from '../../components/Objects/Income/models';
import { OtherExpense } from '../../components/Objects/Expense/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
    getLifeExpectancy,
    getBirthYear,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { SimulationYear } from '../../services/simulation/types';

const ROR = 5; // % nominal; with expenseRatio 0 and inflationAdjusted off, the
               // on-track MC override return is exactly this.
const BIRTH_YEAR = new Date().getFullYear() - 65; // already retired (age 65 today)

function makeAccounts() {
    // Large Traditional IRA so the bracket-aware DP schedules real conversions;
    // brokerage + savings provide a non-Trad source to pay the conversion tax.
    // expenseRatio = 0 everywhere keeps the on-track override return = ROR exactly.
    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 900000, 0, 20, 0 /* expenseRatio */, 'Traditional IRA',
    );
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 300000, 0, 10, 0, 'Brokerage', true, 0.2, 240000,
    );
    const roth = new InvestedAccount(
        'roth-1', 'Roth IRA', 50000, 0, 10, 0, 'Roth IRA', true, 0.2, 50000,
    );
    const savings = new SavedAccount('savings-1', 'Savings', 80000, 0 /* interest */);
    return [traditional, brokerage, roth, savings];
}

function makeIncomes() {
    return [
        new SocialSecurityIncome(
            'ss-1', 'Social Security', 1800, 'Monthly', 65, undefined,
            new Date(`${BIRTH_YEAR + 65}-01-01`),
        ),
    ];
}

function makeExpenses() {
    return [new OtherExpense('living-1', 'Living Expenses', 40000, 'Annually', new Date('2020-01-01'))];
}

function makeAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 60 /* retired in past */, 80),
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: true,
            // rothConversionStrategy stays at the dp-precomputed default.
            returnRates: { ror: ROR },
        },
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
            { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
            { id: 'ws-3', name: 'Roth', accountId: 'roth-1' },
            { id: 'ws-4', name: 'Savings', accountId: 'savings-1' },
        ],
    };
}

function makeTaxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: new Date().getFullYear(),
    };
}

/** Per-year conversion amounts (year → $), only years with a positive conversion. */
function conversionsByYear(timeline: SimulationYear[]): Map<number, number> {
    const m = new Map<number, number>();
    for (const y of timeline) {
        const amt = y.rothConversion?.amount ?? 0;
        if (amt > 0) m.set(y.year, amt);
    }
    return m;
}

const totalTrad = (accts: AnyAccount[]): number => accts
    .filter((a): a is InvestedAccount => a instanceof InvestedAccount &&
        (a.taxType === 'Traditional 401k' || a.taxType === 'Traditional IRA'))
    .reduce((s, a) => s + a.vestedAmount, 0);
const totalRothIra = (accts: AnyAccount[]): number => accts
    .filter((a): a is InvestedAccount => a instanceof InvestedAccount && a.taxType === 'Roth IRA')
    .reduce((s, a) => s + a.vestedAmount, 0);

describe('#98 MC closed-loop conversion policy — on-track path', () => {
    it('is policy-driven and reduces to the deterministic optimum', { timeout: 60000 }, () => {
        const incomes = makeIncomes();
        const expenses = makeExpenses();
        const assumptions = makeAssumptions();
        const taxState = makeTaxState();

        // Horizon the MC engine uses internally (life expectancy − current age).
        const yearsToRun = Math.max(0,
            getLifeExpectancy(assumptions.milestones)
            - (new Date().getFullYear() - getBirthYear(assumptions.milestones)));

        // 1) Deterministic projection (open-loop schedule) — the optimum to reduce to.
        // NOTE (#89 root fix): the deterministic DEFAULT is now the engine-direct search.
        // The MC closed-loop policy is still DP-solved (buildMcConversionPolicy), so the
        // on-track path reduces to the LEGACY-DP deterministic schedule — run here with the
        // same auto-derived objective buildDpSolveInputs uses. (Aligning the MC policy with
        // the engine-direct search is a tracked follow-up; until then they intentionally differ.)
        const dpObjective = {
            objectiveMode: 'max-wealth' as const,
            terminalValuation: 'bracket-aware' as const,
            userSituation: assumptions.investments.rothConversionUserSituation ?? ('self-liquidate' as const),
            terminalCola: assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate / 100 : 0,
        };
        const det = runSimulationWithOptimization(
            yearsToRun, makeAccounts(), incomes, expenses, assumptions, taxState,
            undefined, undefined, undefined, undefined, undefined, dpObjective,
        );
        const detConversions = conversionsByYear(det);
        expect(detConversions.size).toBeGreaterThan(0); // else the test is vacuous.

        // 2) The closed-loop policy the MC engine will solve & look up (σ = 0).
        const policyPlan = buildMcConversionPolicy(
            yearsToRun, makeAccounts(), incomes, expenses, assumptions, taxState, ROR, 0,
        );
        expect(policyPlan?.policy).toBeDefined();

        // 3) Single on-track MC path (flat returns == ROR).
        const config: MonteCarloConfig = {
            enabled: true,
            numScenarios: 1,
            seed: 12345,
            returnMean: ROR,
            returnStdDev: 0,
            preset: 'custom',
        };
        const mc = runMonteCarloSimulationSync(
            config, makeAccounts(), incomes, expenses, assumptions, taxState,
        );
        const timeline = mc.medianCase.timeline; // one scenario ⇒ this IS the on-track path.
        const mcConversions = conversionsByYear(timeline);

        // --- Property 1: WIRING (exact). The applied conversion == the policy
        // looked up at the path's realized start-of-year (Trad, Roth IRA) state.
        // start-of-year(year N) = end-of-year(N-1); for the first sim year it's
        // the initial accounts.
        const sotByYear = new Map<number, AnyAccount[]>();
        for (let i = 0; i < timeline.length; i++) {
            sotByYear.set(timeline[i].year, i === 0 ? makeAccounts() : timeline[i - 1].accounts);
        }
        for (const [year, mcAmt] of mcConversions) {
            const sot = sotByYear.get(year)!;
            const looked = lookupConversionPolicy(
                policyPlan!.policy!, year, totalTrad(sot), totalRothIra(sot)) ?? 0;
            // Applied = min(policy lookup, available Trad). The fixture's Trad
            // dwarfs the conversion, so the clamp never binds ⇒ exact to $1.
            expect(Math.abs(mcAmt - looked)).toBeLessThanOrEqual(1);
        }

        // --- Property 2: REDUCES TO THE DETERMINISTIC OPTIMUM (bucket-level).
        // Same conversion years.
        expect([...mcConversions.keys()].sort()).toEqual([...detConversions.keys()].sort());
        // Per-year amounts agree within policy interpolation granularity — about
        // one conversion bucket (dC = MAX_CONVERSION_CAP / CONVERSION_BUCKETS =
        // $500k/200 = $2.5k here). NOT $1 like the old #93 exact-map reuse: #98
        // interpolates a policy TABLE, so per-year agreement is bucket-level (the
        // aggregate guard below keeps the jitter unbiased).
        for (const [year, detAmt] of detConversions) {
            const mcAmt = mcConversions.get(year) ?? 0;
            expect(Math.abs(mcAmt - detAmt)).toBeLessThanOrEqual(Math.max(3000, detAmt * 0.05));
        }
        // Aggregate conversion stays close. The early (large) conversion years
        // match the deterministic optimum to the dollar; divergence is confined to
        // the late small-conversion tail, where the real-sim (trad, roth) walk has
        // drifted from the DP's internal walk and bucket interpolation rounds the
        // small amounts — a mild ~1.8% under-conversion here, well within 3%.
        const detTotal = [...detConversions.values()].reduce((s, a) => s + a, 0);
        const mcTotal = [...mcConversions.values()].reduce((s, a) => s + a, 0);
        expect(Math.abs(mcTotal - detTotal) / detTotal).toBeLessThan(0.03);
    });

    it('adapts per path: a bull path converts more than a crash path', { timeout: 60000 }, () => {
        const incomes = makeIncomes();
        const expenses = makeExpenses();
        const assumptions = makeAssumptions();
        const taxState = makeTaxState();

        // A volatile run so paths genuinely diverge. The closed-loop policy looks
        // up the conversion at each path's realized (trad, roth): a bull path grows
        // Traditional and converts MORE; a crash path shrinks it and converts LESS.
        // The #93 scalar overlay could not ADD conversion on sustained bull paths —
        // this is the behavior #98 fixes.
        const config: MonteCarloConfig = {
            enabled: true,
            numScenarios: 50,
            seed: 24680,
            returnMean: 7,
            returnStdDev: 18,
            preset: 'custom',
        };
        const mc = runMonteCarloSimulationSync(
            config, makeAccounts(), incomes, expenses, assumptions, taxState,
        );

        const sumConv = (tl: SimulationYear[]) =>
            [...conversionsByYear(tl).values()].reduce((s, a) => s + a, 0);
        const bullTotal = sumConv(mc.bestCase.timeline);
        const crashTotal = sumConv(mc.worstCase.timeline);

        // The policy fired, and the bull path converted strictly more than the crash path.
        expect(bullTotal).toBeGreaterThan(0);
        expect(bullTotal).toBeGreaterThan(crashTotal);
        // Sanity on the summary.
        expect(mc.successRate).toBeGreaterThanOrEqual(0);
        expect(mc.successRate).toBeLessThanOrEqual(100);
    });
});
