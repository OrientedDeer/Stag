/**
 * #158 — joint-search worker parity + artifact-memo correctness.
 *
 * CORRECTNESS INVARIANT: the worker path must produce results identical to the
 * sync path on the same inputs. Vitest can't run real web workers, so — like
 * the MC worker precedent (montecarloWorkerGuard.test.ts) — the worker's
 * message handler is invoked DIRECTLY, with `structuredClone` standing in for
 * the postMessage boundary on both legs:
 *
 *   main-thread instances --structuredClone--> handleJointSearchRequest
 *     (reconstitute -> runSimulationWithOptimization -> post done)
 *   done.timeline --structuredClone--> reconstituteTimeline (runner step)
 *
 * The result is deep-compared against a plain synchronous
 * runSimulationWithOptimization run on the ORIGINAL instances.
 *
 * Also pinned here:
 *   • cache-warm parity: a repeat run served from the per-order artifact memo
 *     cache is identical to the cold run (including NO duplicated year-0 logs —
 *     the year-0-protection contract);
 *   • the reconstitution wipeout guard (mirrors the MC worker's);
 *   • progress messages cross the boundary.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import {
    AssumptionsState, defaultAssumptions, createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import {
    runSimulationWithOptimization, clearJointSearchArtifactCache,
} from '../../components/Objects/Assumptions/useSimulation';
import { handleJointSearchRequest } from '../../services/jointSearch.worker';
import { reconstituteTimeline } from '../../services/jointSearchRunner';
import type { JointSearchWorkerRequest, JointSearchWorkerResponse } from '../../services/jointSearchWorkerTypes';
import type { SimulationYear } from '../../services/simulation/types';

// Compact tax-opt scenario (short horizon keeps the DP solve + ~13 replays/order
// affordable in CI): retired-today, SS at 67, Traditional-heavy — the joint
// optimizer genuinely engages (multiple candidate orders, real conversions).
const NOW = new Date().getFullYear();
const BY = NOW - 60, RA = 60, LE = 78, YEARS = LE - (NOW - BY);
const REF_DATE = new Date(NOW, 5, 15); // fixed mid-June reference for determinism

const accts = (): AnyAccount[] => [
    new SavedAccount('cash', 'Cash', 50_000, 2),
    new InvestedAccount('brk', 'Brokerage', 300_000, 0, 10, 0.05, 'Brokerage', true, 0.2, 200_000),
    new InvestedAccount('trad', 'Traditional 401k', 900_000, 0, 10, 0.05, 'Traditional 401k', true, 0.2, 900_000),
    new InvestedAccount('roth', 'Roth IRA', 100_000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 100_000),
];
const incomes = () => [new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 3_000, NOW)];
const expenses = () => [new FoodExpense('exp', 'Living', 60_000, 'Annually', new Date(NOW, 0, 1))];
const assumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(BY, RA, LE),
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: { ...defaultAssumptions.macro, inflationRate: 2.5, inflationAdjusted: true },
    investments: {
        ...defaultAssumptions.investments, returnRates: { ror: 6 },
        taxOptimizationEnabled: true, autoRothConversions: true, rothConversionStrategy: 'dp-precomputed',
    },
    withdrawalStrategy: [
        { id: 'w1', name: 'Cash', accountId: 'cash' },
        { id: 'w2', name: 'Brokerage', accountId: 'brk' },
        { id: 'w3', name: 'Traditional 401k', accountId: 'trad' },
        { id: 'w4', name: 'Roth IRA', accountId: 'roth' },
    ],
};
const taxState: TaxState = {
    filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
    fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW,
};

/** Drive the worker handler the way the real worker does, collecting messages. */
function runWorkerPath(): { timeline: SimulationYear[]; messages: JointSearchWorkerResponse[] } {
    const messages: JointSearchWorkerResponse[] = [];
    const req: JointSearchWorkerRequest = {
        requestId: 42,
        yearsToRun: YEARS,
        // postMessage leg: methods stripped, own props (incl. className, Dates) kept.
        accounts: accts().map(a => structuredClone(a)),
        incomes: incomes().map(i => structuredClone(i)),
        expenses: expenses().map(e => structuredClone(e)),
        assumptions,
        taxState,
        referenceDate: REF_DATE,
    };
    handleJointSearchRequest(req, (msg) => messages.push(msg));
    const done = messages.find(m => m.type === 'done');
    expect(done, 'worker must post a done message').toBeDefined();
    if (done?.type !== 'done') throw new Error('unreachable');
    // Return leg: clone the posted timeline, then the runner's reconstitution.
    return { timeline: reconstituteTimeline(structuredClone(done.timeline)), messages };
}

const syncRun = (): SimulationYear[] =>
    runSimulationWithOptimization(
        YEARS, accts(), incomes(), expenses(), assumptions, taxState, undefined, REF_DATE,
    );

const jointOptimizerLogCount = (tl: SimulationYear[]): number =>
    tl[0].logs.filter(l => l.includes('[joint optimizer]')).length;

/**
 * The ONE tolerated difference between two runs on identical inputs: the DP
 * solver's summary logs embed a wall-clock timing readout ("elapsed=2356.5ms")
 * that is nondeterministic by nature. Normalize just that token; every other
 * character of every log line — and every numeric field — must match exactly.
 */
const normalizeElapsed = (tl: SimulationYear[]): SimulationYear[] =>
    tl.map(y => ({ ...y, logs: y.logs.map(l => l.replace(/elapsed=[\d,.]+ms/g, 'elapsed=<t>ms')) }));

beforeEach(() => {
    clearJointSearchArtifactCache();
});

describe('joint-search worker parity (#158)', { timeout: 240_000 }, () => {
    it('serialize → reconstitute → search → serialize round-trip equals the sync path exactly', () => {
        const syncTimeline = syncRun();

        // Independent computation: the handler shares this test process's module
        // registry (and thus the artifact cache) with the sync run above.
        clearJointSearchArtifactCache();
        const { timeline: workerTimeline, messages } = runWorkerPath();

        // The full contract every consumer reads must survive the round trip.
        expect(workerTimeline.length).toBe(syncTimeline.length);
        expect(syncTimeline[0].chosenWithdrawalOrder).toBeDefined();
        expect(workerTimeline[0].chosenWithdrawalOrder).toEqual(syncTimeline[0].chosenWithdrawalOrder);
        expect(workerTimeline[0].orderOptimizationGain).toBe(syncTimeline[0].orderOptimizationGain);
        expect(workerTimeline[0].stdDedBaselineTerminalAfterTaxNW).toBe(syncTimeline[0].stdDedBaselineTerminalAfterTaxNW);
        expect(workerTimeline[0].strategyTerminalAfterTaxNW).toBe(syncTimeline[0].strategyTerminalAfterTaxNW);
        // dpTrace is stamped on DP-horizon years — it must survive both clones.
        expect(syncTimeline.some(y => y.dpTrace !== undefined)).toBe(true);

        // Class identity is restored (the UI's instanceof checks depend on it).
        expect(workerTimeline[0].accounts.some(a => a instanceof InvestedAccount)).toBe(true);

        // And the whole timeline is deep-equal, year by year (logs modulo the
        // nondeterministic DP wall-clock readout — see normalizeElapsed).
        expect(normalizeElapsed(workerTimeline)).toEqual(normalizeElapsed(syncTimeline));

        // Progress crossed the boundary (spinner honesty), tagged with the request id.
        const progress = messages.filter(m => m.type === 'progress');
        expect(progress.length).toBeGreaterThan(0);
        expect(progress.every(m => m.requestId === 42)).toBe(true);
    });

    it('cache-warm run equals cache-cold run, with no duplicated year-0 logs', () => {
        const cold = syncRun();
        // No clear: this run is served (baselines, DP contexts, DP plan) from the
        // per-order artifact memo cache.
        const warm = syncRun();
        expect(normalizeElapsed(warm)).toEqual(normalizeElapsed(cold));
        // Year-0 protection: log stamps must appear exactly once per result, not
        // accumulate into shared cached rows across runs.
        expect(jointOptimizerLogCount(cold)).toBe(1);
        expect(jointOptimizerLogCount(warm)).toBe(1);
    });

    it('reconstitution wipeout posts an error (guard mirrors the MC worker)', () => {
        const messages: JointSearchWorkerResponse[] = [];
        const stripped = accts().map(a => {
            const clone = structuredClone(a) as unknown as Record<string, unknown>;
            delete clone.className; // the discriminator loss the guard exists to catch
            return clone;
        });
        handleJointSearchRequest({
            requestId: 7,
            yearsToRun: YEARS,
            accounts: stripped,
            incomes: incomes().map(i => structuredClone(i)),
            expenses: expenses().map(e => structuredClone(e)),
            assumptions,
            taxState,
            referenceDate: REF_DATE,
        }, (msg) => messages.push(msg));
        expect(messages).toHaveLength(1);
        expect(messages[0].type).toBe('error');
        expect(messages[0].requestId).toBe(7);
        if (messages[0].type === 'error') {
            expect(messages[0].message).toMatch(/reconstituted 0 of 4 accounts/);
        }
    });
});
