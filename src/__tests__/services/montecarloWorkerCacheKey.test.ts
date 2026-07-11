/**
 * #130 — the MC policy-cache key must agree with what the run actually
 * consumes. The worker rounds `returnMean`/`returnStdDev` to 4dp when building
 * the IndexedDB cache key (absorbing float noise so re-runs with the same
 * displayed rate hit cache), but historically the solve
 * (`solveMcConversionPlan`) and the run (`runMonteCarloSimulation`) were handed
 * the UNROUNDED `req.config` directly. Two configs that round to the same key
 * (e.g. 7.00000%   vs 7.00004%) could therefore share a cached policy that was
 * actually solved for a *different* rate than the one being run — and
 * `policyCache.getCachedPlan`'s "full-key recheck" doesn't catch this, because
 * the full key IS the rounded key.
 *
 * Fix under test: round once at worker entry into a single `config` object
 * used for the cache key, the solve, AND the run, so all three always agree.
 *
 * The worker isn't runnable as a real Web Worker under vitest (mirrors the
 * montecarloWorkerGuard.test.ts precedent), so — like jointSearch.worker.ts's
 * `handleJointSearchRequest` — the message handler is exported as
 * `handleMcRequest` and invoked directly here, with the engine/cache modules
 * mocked to capture exactly what each consumer receives.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const solveMcConversionPlanMock = vi.fn();
const runMonteCarloSimulationMock = vi.fn();
vi.mock('../../services/MonteCarloEngine', () => ({
    solveMcConversionPlan: (...args: unknown[]) => solveMcConversionPlanMock(...args),
    runMonteCarloSimulation: (...args: unknown[]) => runMonteCarloSimulationMock(...args),
}));

const getCachedPlanMock = vi.fn();
const putCachedPlanMock = vi.fn();
vi.mock('../../services/policyCache', () => ({
    getCachedPlan: (...args: unknown[]) => getCachedPlanMock(...args),
    putCachedPlan: (...args: unknown[]) => putCachedPlanMock(...args),
}));

import { handleMcRequest } from '../../services/montecarlo.worker';
import type { McWorkerRequest, McWorkerResponse } from '../../services/montecarloWorkerTypes';
import type { MonteCarloConfig } from '../../services/MonteCarloTypes';
import { SavedAccount } from '../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import type { TaxState } from '../../components/Objects/Taxes/TaxContext';

function createConfig(overrides: Partial<MonteCarloConfig> = {}): MonteCarloConfig {
    return {
        enabled: true,
        numScenarios: 10,
        returnMean: 7,
        returnStdDev: 15,
        seed: 12345,
        preset: 'custom',
        ...overrides,
    };
}

const assumptions = {
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(1970, 65, 90),
};

const taxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'Virginia',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: new Date().getFullYear(),
};

function buildRequest(config: MonteCarloConfig): McWorkerRequest {
    return {
        config,
        accounts: [structuredClone(new SavedAccount('a1', 'Cash', 100_000, 2))],
        incomes: [
            structuredClone(new PassiveIncome('i1', 'Dividends', 10_000, 'Annually', 'No', 'Dividend')),
        ],
        expenses: [structuredClone(new FoodExpense('e1', 'Groceries', 20_000, 'Annually'))],
        assumptions,
        taxState,
    };
}

async function runHandler(config: MonteCarloConfig): Promise<McWorkerResponse[]> {
    const messages: McWorkerResponse[] = [];
    await handleMcRequest(buildRequest(config), (msg) => messages.push(msg));
    return messages;
}

beforeEach(() => {
    vi.clearAllMocks();
    getCachedPlanMock.mockResolvedValue(null);
    putCachedPlanMock.mockResolvedValue(undefined);
    solveMcConversionPlanMock.mockReturnValue({});
    runMonteCarloSimulationMock.mockResolvedValue({
        successRate: 100,
        totalScenarios: 10,
        successfulScenarios: 10,
    });
});

describe('MC worker cache key agrees with the config actually consumed (#130)', () => {
    it('solve and run receive the SAME rounded returnMean/returnStdDev that were hashed into the cache key', async () => {
        // Full-precision inputs that round differently than they start —
        // exactly the float-noise case the 4dp rounding is meant to absorb.
        const config = createConfig({ returnMean: 0.07000049, returnStdDev: 0.15000021 });

        const messages = await runHandler(config);
        expect(messages.some((m) => m.type === 'error')).toBe(false);

        expect(getCachedPlanMock).toHaveBeenCalledTimes(1);
        const cacheKey = getCachedPlanMock.mock.calls[0][0] as string;
        const parsed = JSON.parse(cacheKey) as { rm: number; rs: number };
        expect(parsed.rm).toBe(0.07);
        expect(parsed.rs).toBe(0.15);

        expect(solveMcConversionPlanMock).toHaveBeenCalledTimes(1);
        const solveConfig = solveMcConversionPlanMock.mock.calls[0][0] as MonteCarloConfig;
        expect(solveConfig.returnMean).toBe(parsed.rm);
        expect(solveConfig.returnStdDev).toBe(parsed.rs);

        expect(runMonteCarloSimulationMock).toHaveBeenCalledTimes(1);
        const runConfig = runMonteCarloSimulationMock.mock.calls[0][0] as MonteCarloConfig;
        expect(runConfig.returnMean).toBe(parsed.rm);
        expect(runConfig.returnStdDev).toBe(parsed.rs);
    });

    it('a cache HIT still runs the simulation with the rounded config (skips solve, not the run)', async () => {
        const cachedPolicy = { policy: new Map([[0, 0]]) };
        getCachedPlanMock.mockResolvedValue(cachedPolicy);

        const config = createConfig({ returnMean: 0.07000049, returnStdDev: 0.15000021 });
        await runHandler(config);

        expect(solveMcConversionPlanMock).not.toHaveBeenCalled();
        expect(runMonteCarloSimulationMock).toHaveBeenCalledTimes(1);
        const runConfig = runMonteCarloSimulationMock.mock.calls[0][0] as MonteCarloConfig;
        expect(runConfig.returnMean).toBe(0.07);
        expect(runConfig.returnStdDev).toBe(0.15);
    });

    it('other config fields (unrelated to rounding) pass through unchanged', async () => {
        const config = createConfig({
            returnMean: 6.999999, returnStdDev: 14.999999, numScenarios: 250, seed: 999, compareToBaseline: true,
        });
        await runHandler(config);

        const solveConfig = solveMcConversionPlanMock.mock.calls[0][0] as MonteCarloConfig;
        expect(solveConfig.numScenarios).toBe(250);
        expect(solveConfig.seed).toBe(999);
        expect(solveConfig.compareToBaseline).toBe(true);
    });
});
