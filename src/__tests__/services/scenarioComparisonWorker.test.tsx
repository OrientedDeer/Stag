/**
 * #166 — the "Run Comparison" scenario simulation runs in an EPHEMERAL
 * joint-search worker (spawn → run → terminate) instead of freezing the main
 * thread, and deliberately NOT through the persistent #158 runner (whose
 * supersede-on-new-request semantics would let a live-projection recalc
 * silently cancel a comparison mid-run, or vice versa).
 *
 * jsdom has no real Worker, so — following the #158 precedent
 * (jointSearchWorkerParity.test.ts) — a fake Worker drives the REAL
 * `handleJointSearchRequest` with `structuredClone` standing in for the
 * postMessage boundary on both legs. Pinned here:
 *
 *   • runJointSearchEphemeral parity: resolves the same timeline as a direct
 *     synchronous runSimulationWithOptimization on the same inputs, and
 *     TERMINATES its worker (a fresh one is spawned per call);
 *   • error paths reject (worker-posted error, worker onerror) with the
 *     worker terminated — never a hung promise;
 *   • INDEPENDENCE: an in-flight persistent-runner request is neither
 *     superseded nor terminated by a concurrent ephemeral run — both
 *     complete (the property that motivated the ephemeral design);
 *   • end-to-end through ScenarioProvider.runComparison: a tax-opt scenario
 *     comparison completes off the "main thread" with a result identical to
 *     the sync path, busy state cleared; and a worker spawn failure falls
 *     back to the synchronous engine with the same result.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext, type ContextType } from 'react';

import { ScenarioContext } from '../../components/Objects/Scenarios/ScenarioContext';
import { ScenarioProvider } from '../../components/Objects/Scenarios/ScenarioProvider';
import type { SavedScenario } from '../../services/ScenarioTypes';
import {
    AnyAccount, InvestedAccount, SavedAccount, reconstituteAccount,
} from '../../components/Objects/Accounts/models';
import {
    AnyIncome, FutureSocialSecurityIncome, reconstituteIncome,
} from '../../components/Objects/Income/models';
import { AnyExpense, FoodExpense, reconstituteExpense } from '../../components/Objects/Expense/models';
import {
    AssumptionsState, defaultAssumptions, createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import {
    runSimulationWithOptimization, clearJointSearchArtifactCache,
} from '../../components/Objects/Assumptions/useSimulation';
import { handleJointSearchRequest } from '../../services/jointSearch.worker';
import {
    runJointSearchEphemeral, runJointSearchInWorker, JointSearchInput,
} from '../../services/jointSearchRunner';
import { linkOrphanLoanExpenses } from '../../services/simulation/linkOrphanLoanExpenses';
import type { JointSearchWorkerRequest, JointSearchWorkerResponse } from '../../services/jointSearchWorkerTypes';
import type { SimulationYear } from '../../services/simulation/types';

// ============================================================================
// Fake Worker — drives the real message handler across structuredClone legs
// ============================================================================

class FakeJointSearchWorker {
    static instances: FakeJointSearchWorker[] = [];
    /** When false, postMessage queues and the test calls deliver() manually. */
    static autoDeliver = true;

    onmessage: ((e: MessageEvent<JointSearchWorkerResponse>) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    terminated = false;
    private pending: JointSearchWorkerRequest[] = [];

    constructor() {
        FakeJointSearchWorker.instances.push(this);
    }

    postMessage(req: unknown): void {
        // postMessage leg: methods stripped, own props (className, Dates) kept.
        const cloned = structuredClone(req) as JointSearchWorkerRequest;
        if (FakeJointSearchWorker.autoDeliver) {
            queueMicrotask(() => this.deliver(cloned));
        } else {
            this.pending.push(cloned);
        }
    }

    deliver(req?: JointSearchWorkerRequest): void {
        const r = req ?? this.pending.shift();
        if (!r) throw new Error('FakeJointSearchWorker: no pending request to deliver');
        handleJointSearchRequest(r, (msg) => {
            if (this.terminated) return; // a terminated worker can't deliver
            // Return leg of the postMessage boundary.
            this.onmessage?.({ data: structuredClone(msg) } as MessageEvent<JointSearchWorkerResponse>);
        });
    }

    terminate(): void {
        this.terminated = true;
    }
}

/** A Worker whose construction fails — the "worker unavailable" environment. */
class ExplodingWorker {
    constructor() {
        throw new Error('worker construction refused');
    }
}

// ============================================================================
// Fixtures
// ============================================================================

const NOW = new Date().getFullYear();
const REF_DATE = new Date(NOW, 5, 15);

// Cheap non-tax-opt inputs for the runner-level tests: a single sim, no joint
// search (the parity of the joint search itself is #158's test; here the unit
// under test is the ephemeral runner's plumbing).
const BY = NOW - 60, RA = 60, LE = 70;
const cheapAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(BY, RA, LE),
};
const taxState: TaxState = {
    filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
    fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW,
};
const cheapAccounts = (): AnyAccount[] => [new SavedAccount('cash', 'Cash', 250_000, 2)];
const cheapExpenses = (): AnyExpense[] => [new FoodExpense('exp', 'Living', 20_000, 'Annually', new Date(NOW, 0, 1))];
const cheapInput = (yearsToRun: number): JointSearchInput => ({
    yearsToRun,
    accounts: cheapAccounts(),
    incomes: [],
    expenses: cheapExpenses(),
    assumptions: cheapAssumptions,
    taxState,
    referenceDate: REF_DATE,
});
const cheapSyncRun = (yearsToRun: number): SimulationYear[] =>
    runSimulationWithOptimization(
        yearsToRun, cheapAccounts(), [], cheapExpenses(), cheapAssumptions, taxState, undefined, REF_DATE,
    );

// Compact tax-opt scenario for the end-to-end comparison tests (the joint
// optimizer genuinely engages: multiple candidate orders, real conversions).
// Built as a FULL AssumptionsState so loadAndSimulateScenario's merge-with-
// defaults is value-identity and the reference run can use it directly.
const taxOptAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(NOW - 60, 60, 75),
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: { ...defaultAssumptions.macro, inflationRate: 2.5, inflationAdjusted: true },
    investments: {
        ...defaultAssumptions.investments, returnRates: { ror: 6 },
        taxOptimizationEnabled: true, autoRothConversions: true, rothConversionStrategy: 'dp-precomputed',
    },
    withdrawalStrategy: [
        { id: 'w1', name: 'Cash', accountId: 'cash' },
        { id: 'w2', name: 'Traditional 401k', accountId: 'trad' },
        { id: 'w3', name: 'Roth IRA', accountId: 'roth' },
    ],
};
const taxOptAccounts = (): AnyAccount[] => [
    new SavedAccount('cash', 'Cash', 50_000, 2),
    new InvestedAccount('trad', 'Traditional 401k', 400_000, 0, 10, 0.05, 'Traditional 401k', true, 0.2, 400_000),
    new InvestedAccount('roth', 'Roth IRA', 50_000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 50_000),
];
// Explicit startDate: the persisted JSON drops an undefined startDate and the
// plain reconstituteIncome then defaults it to `new Date()` AT RECONSTITUTION
// TIME — nondeterministic across the reference and provider runs of this test.
const taxOptIncomes = (): AnyIncome[] => [
    new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 2_500, NOW, new Date(NOW, 0, 1)),
];
const taxOptExpenses = (): AnyExpense[] => [new FoodExpense('exp', 'Living', 45_000, 'Annually', new Date(NOW, 0, 1))];

/** The persisted scenario shape: instances → className stamp → JSON round trip. */
const makeSavedScenario = (id: string): SavedScenario => ({
    metadata: {
        id, name: `Scenario ${id}`,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    inputs: JSON.parse(JSON.stringify({
        accounts: taxOptAccounts(),
        incomes: taxOptIncomes(),
        expenses: taxOptExpenses(),
        taxSettings: taxState,
        assumptions: taxOptAssumptions,
    })),
    version: '1.0.0',
});

/**
 * The sync-path reference for the saved scenario: reconstitute the persisted
 * inputs exactly as loadAndSimulateScenario does, then run the engine
 * directly on the main thread. Computed once (heavy) and shared.
 */
let referenceTimeline: SimulationYear[] | null = null;
const getReferenceTimeline = (): SimulationYear[] => {
    if (!referenceTimeline) {
        const inputs = makeSavedScenario('ref').inputs;
        const reconstitutedAccounts = inputs.accounts.map(reconstituteAccount).filter(Boolean) as AnyAccount[];
        const incomes = inputs.incomes.map(reconstituteIncome).filter(Boolean) as AnyIncome[];
        const expenses = inputs.expenses.map(reconstituteExpense).filter(Boolean) as AnyExpense[];
        const { accounts } = linkOrphanLoanExpenses(reconstitutedAccounts, expenses);
        clearJointSearchArtifactCache();
        referenceTimeline = runSimulationWithOptimization(
            50, accounts, incomes, expenses, taxOptAssumptions, inputs.taxSettings,
        );
    }
    return referenceTimeline;
};

/**
 * The one tolerated log difference between two runs on identical inputs: the
 * DP solver's nondeterministic wall-clock readout (same normalization as
 * jointSearchWorkerParity.test.ts).
 */
const normalizeElapsed = (tl: SimulationYear[]): SimulationYear[] =>
    tl.map(y => ({ ...y, logs: y.logs.map(l => l.replace(/elapsed=[\d,.]+ms/g, 'elapsed=<t>ms')) }));

// ============================================================================
// Provider harness
// ============================================================================

type Captured = ContextType<typeof ScenarioContext>;

function renderProvider(): Captured {
    const captured = {} as Captured;
    const capture = (ctx: Captured): void => {
        Object.assign(captured, ctx);
    };
    const TestComponent = () => {
        capture(useContext(ScenarioContext));
        return null;
    };
    render(
        <ScenarioProvider>
            <TestComponent />
        </ScenarioProvider>
    );
    return captured;
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
    FakeJointSearchWorker.instances = [];
    FakeJointSearchWorker.autoDeliver = true;
    clearJointSearchArtifactCache();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('runJointSearchEphemeral (#166)', { timeout: 240_000 }, () => {
    it('resolves the sync-path timeline and terminates its single-use worker (fresh worker per call)', async () => {
        vi.stubGlobal('Worker', FakeJointSearchWorker);

        const timeline = await runJointSearchEphemeral(cheapInput(5));
        expect(normalizeElapsed(timeline)).toEqual(normalizeElapsed(cheapSyncRun(5)));
        // Class identity is restored across the round trip.
        expect(timeline[0].accounts[0]).toBeInstanceOf(SavedAccount);
        expect(FakeJointSearchWorker.instances).toHaveLength(1);
        expect(FakeJointSearchWorker.instances[0].terminated).toBe(true);

        // A second run spawns a NEW worker (no reuse — ephemeral by contract).
        const again = await runJointSearchEphemeral(cheapInput(5));
        expect(normalizeElapsed(again)).toEqual(normalizeElapsed(timeline));
        expect(FakeJointSearchWorker.instances).toHaveLength(2);
        expect(FakeJointSearchWorker.instances[1]).not.toBe(FakeJointSearchWorker.instances[0]);
        expect(FakeJointSearchWorker.instances[1].terminated).toBe(true);
    });

    it('rejects (and terminates) on a worker-posted error — the wipeout guard crosses the boundary', async () => {
        vi.stubGlobal('Worker', FakeJointSearchWorker);
        const input = cheapInput(3);
        // Lose the className discriminator: the real handler's reconstitution
        // wipeout guard posts an error message.
        input.accounts = [{ id: 'x', name: 'X', amount: 1 } as unknown as AnyAccount];

        await expect(runJointSearchEphemeral(input)).rejects.toThrow(/reconstituted 0 of 1 accounts/);
        expect(FakeJointSearchWorker.instances).toHaveLength(1);
        expect(FakeJointSearchWorker.instances[0].terminated).toBe(true);
    });

    it('rejects (and terminates) on a worker onerror — the promise never hangs', async () => {
        vi.stubGlobal('Worker', FakeJointSearchWorker);
        FakeJointSearchWorker.autoDeliver = false; // hold the request; fail the worker instead

        const pending = runJointSearchEphemeral(cheapInput(3));
        const w = FakeJointSearchWorker.instances[0];
        w.onerror?.({ message: 'worker blew up at load' } as ErrorEvent);

        await expect(pending).rejects.toThrow('worker blew up at load');
        expect(w.terminated).toBe(true);
    });

    it('rejects immediately when Workers are unavailable (jsdom default)', async () => {
        // No stub: jsdom has no Worker global.
        expect(typeof Worker).toBe('undefined');
        await expect(runJointSearchEphemeral(cheapInput(3))).rejects.toThrow(/Workers unavailable/);
    });

    it('does NOT supersede an in-flight persistent-runner request (and is not superseded by it)', async () => {
        vi.stubGlobal('Worker', FakeJointSearchWorker);
        FakeJointSearchWorker.autoDeliver = false;

        // A live-projection recalc is in flight on the persistent runner…
        let persistentState: 'pending' | 'resolved' | 'rejected' = 'pending';
        const persistentPromise = runJointSearchInWorker(cheapInput(4)).then(
            (t) => { persistentState = 'resolved'; return t; },
            (e) => { persistentState = 'rejected'; throw e; },
        );
        expect(FakeJointSearchWorker.instances).toHaveLength(1);
        const persistentWorker = FakeJointSearchWorker.instances[0];

        // …when a scenario comparison starts. It must get its OWN worker.
        const ephemeralPromise = runJointSearchEphemeral(cheapInput(6));
        expect(FakeJointSearchWorker.instances).toHaveLength(2);
        const ephemeralWorker = FakeJointSearchWorker.instances[1];
        expect(ephemeralWorker).not.toBe(persistentWorker);

        // The comparison completes first — the live recalc is untouched:
        // not terminated, not rejected with JointSearchSupersededError.
        ephemeralWorker.deliver();
        const ephemeralTimeline = await ephemeralPromise;
        expect(persistentState).toBe('pending');
        expect(persistentWorker.terminated).toBe(false);
        expect(ephemeralWorker.terminated).toBe(true);

        // And the live recalc still completes normally afterwards.
        persistentWorker.deliver();
        const persistentTimeline = await persistentPromise;
        expect(persistentState).toBe('resolved');
        expect(persistentWorker.terminated).toBe(false); // persistent worker stays alive

        // Both produced their own sync-parity results (different horizons).
        expect(normalizeElapsed(ephemeralTimeline)).toEqual(normalizeElapsed(cheapSyncRun(6)));
        expect(normalizeElapsed(persistentTimeline)).toEqual(normalizeElapsed(cheapSyncRun(4)));
    });
});

describe('scenario comparison through the worker (#166, end-to-end)', { timeout: 240_000 }, () => {
    it('Run Comparison on a tax-opt scenario runs in the ephemeral worker and matches the sync path exactly', async () => {
        vi.stubGlobal('Worker', FakeJointSearchWorker);
        const reference = getReferenceTimeline();
        clearJointSearchArtifactCache();

        const captured = renderProvider();
        const scenario = makeSavedScenario('sc-1');
        act(() => {
            captured.dispatch({ type: 'LOAD_SCENARIOS', payload: [scenario] });
        });

        await act(async () => {
            await captured.runComparison('current', 'sc-1', reference, taxOptAssumptions, taxState);
        });

        // The scenario leg ran in exactly one single-use worker, now terminated.
        expect(FakeJointSearchWorker.instances).toHaveLength(1);
        expect(FakeJointSearchWorker.instances[0].terminated).toBe(true);

        // Busy state cleared, no error, and the comparison result carries a
        // simulation IDENTICAL to the direct sync run on the same inputs.
        expect(captured.state.isLoading).toBe(false);
        expect(captured.state.error).toBeNull();
        expect(captured.state.comparisonResult).not.toBeNull();
        const comparisonSim = captured.state.comparisonResult!.comparison.simulation;
        expect(comparisonSim.length).toBe(reference.length);
        expect(normalizeElapsed(comparisonSim)).toEqual(normalizeElapsed(reference));
    });

    it('falls back to the synchronous engine (same result) when the worker cannot be constructed', async () => {
        vi.stubGlobal('Worker', ExplodingWorker);
        const reference = getReferenceTimeline();
        clearJointSearchArtifactCache();

        const captured = renderProvider();
        const scenario = makeSavedScenario('sc-2');
        act(() => {
            captured.dispatch({ type: 'LOAD_SCENARIOS', payload: [scenario] });
        });

        await act(async () => {
            await captured.runComparison('current', 'sc-2', reference, taxOptAssumptions, taxState);
        });

        expect(captured.state.isLoading).toBe(false);
        expect(captured.state.error).toBeNull();
        expect(captured.state.comparisonResult).not.toBeNull();
        const comparisonSim = captured.state.comparisonResult!.comparison.simulation;
        expect(normalizeElapsed(comparisonSim)).toEqual(normalizeElapsed(reference));
    });
});
