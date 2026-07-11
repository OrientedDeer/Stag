/**
 * #204 — persist Monte Carlo results across a page refresh.
 *
 * Behavior under test, at the provider + tab boundary (mcSummaryCache mocked at
 * the module edge like montecarloWorkerCacheKey.test.ts mocks policyCache):
 *  - a successful run writes the summary to the cache under the DERIVED key;
 *  - tryRestoreSummary restores a matching cached summary (and the tab then shows
 *    results instead of "No simulation data");
 *  - a cache miss leaves the empty state untouched;
 *  - the RESTORE_SUMMARY reducer guard refuses to clobber an in-flight run or an
 *    existing summary (the stale-async-write race).
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, act, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';

import { MonteCarloContext } from '../../../../components/Objects/Assumptions/MonteCarloContext';
import { MonteCarloProvider } from '../../../../components/Objects/Assumptions/MonteCarloProvider';
import { type MonteCarloSummary } from '../../../../services/MonteCarloTypes';
import { runMonteCarloSimulation } from '../../../../services/MonteCarloEngine';
import {
    mcSummaryCacheKey,
    getCachedSummary,
    putCachedSummary,
} from '../../../../services/mcSummaryCache';
import type * as McSummaryCacheModule from '../../../../services/mcSummaryCache';
import { AccountContext } from '../../../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../../components/Objects/Expense/ExpenseContext';
import { AssumptionsContext, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext, defaultTaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { MonteCarloTab } from '../../../../tabs/Future/tabs/MonteCarloTab';
import { type SimulationYear } from '../../../../components/Objects/Assumptions/SimulationEngine';
import type { AssumptionsState } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import type { TaxState } from '../../../../components/Objects/Taxes/TaxContext';

vi.mock('../../../../services/MonteCarloEngine', () => ({
    runMonteCarloSimulation: vi.fn(),
}));

// Keep the real mcSummaryCacheKey (pure); mock only the IndexedDB edges.
vi.mock('../../../../services/mcSummaryCache', async (importActual) => {
    const actual = await importActual<typeof McSummaryCacheModule>();
    return {
        ...actual,
        getCachedSummary: vi.fn(),
        putCachedSummary: vi.fn(),
    };
});

// Stub the nivo-heavy fan chart so the tab renders cheaply in jsdom.
vi.mock('../../../../components/Charts/FanChart', () => ({
    FanChart: () => <div data-testid="stub-fan-chart" />,
}));

const localStorageMock = (() => {
    let store: { [key: string]: string } = {};
    return {
        getItem: vi.fn((k: string) => store[k] ?? null),
        setItem: vi.fn((k: string, v: string) => { store[k] = v; }),
        clear: vi.fn(() => { store = {}; }),
        removeItem: vi.fn((k: string) => { delete store[k]; }),
    };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const createMockSummary = (overrides: Partial<MonteCarloSummary> = {}): MonteCarloSummary => ({
    successRate: 85,
    totalScenarios: 100,
    successfulScenarios: 85,
    averageFinalNetWorth: 2_500_000,
    seed: 12345,
    percentiles: {
        p10: [{ year: 2025, netWorth: 100_000 }],
        p25: [{ year: 2025, netWorth: 150_000 }],
        p50: [{ year: 2025, netWorth: 200_000 }],
        p75: [{ year: 2025, netWorth: 250_000 }],
        p90: [{ year: 2025, netWorth: 300_000 }],
    },
    worstCase: { scenarioId: 0, timeline: [], success: false, finalNetWorth: -50_000, yearOfDepletion: 2050, yearlyReturns: [] },
    medianCase: { scenarioId: 50, timeline: [], success: true, finalNetWorth: 200_000, yearOfDepletion: null, yearlyReturns: [] },
    bestCase: { scenarioId: 99, timeline: [], success: true, finalNetWorth: 500_000, yearOfDepletion: null, yearlyReturns: [] },
    ...overrides,
});

const runAssumptions = defaultAssumptions;
const runTaxState = defaultTaxState;

beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    (getCachedSummary as Mock).mockResolvedValue(null);
    (putCachedSummary as Mock).mockResolvedValue(undefined);
    (runMonteCarloSimulation as Mock).mockResolvedValue(createMockSummary());
});

describe('#204 MonteCarloProvider summary persistence', () => {
    it('a successful run persists the summary under the derived key', async () => {
        const summary = createMockSummary();
        (runMonteCarloSimulation as Mock).mockResolvedValue(summary);

        const captured = {} as React.ContextType<typeof MonteCarloContext>;
        const Probe = () => { Object.assign(captured, useContext(MonteCarloContext)); return null; };
        render(<MonteCarloProvider><Probe /></MonteCarloProvider>);

        await act(async () => {
            await captured.runSimulation([], [], [], runAssumptions, runTaxState);
        });

        const expectedKey = mcSummaryCacheKey(captured.state.config, [], [], [], runAssumptions, runTaxState);
        expect(putCachedSummary).toHaveBeenCalledTimes(1);
        expect(putCachedSummary).toHaveBeenCalledWith(expectedKey, summary);
    });

    it('tryRestoreSummary restores a matching cached summary and reports true', async () => {
        const summary = createMockSummary({ successRate: 73 });
        (getCachedSummary as Mock).mockResolvedValue(summary);

        const captured = {} as React.ContextType<typeof MonteCarloContext>;
        const Probe = () => { Object.assign(captured, useContext(MonteCarloContext)); return null; };
        render(<MonteCarloProvider><Probe /></MonteCarloProvider>);

        let result = false;
        await act(async () => {
            result = await captured.tryRestoreSummary([], [], [], runAssumptions, runTaxState);
        });

        expect(result).toBe(true);
        expect(captured.state.summary?.successRate).toBe(73);
        // A restore is not a fresh run: it must not claim "just finished".
        expect(captured.state.isRunning).toBe(false);
        expect(captured.state.phase).toBe('idle');
    });

    it('a cache miss leaves the empty state and reports false', async () => {
        (getCachedSummary as Mock).mockResolvedValue(null);

        const captured = {} as React.ContextType<typeof MonteCarloContext>;
        const Probe = () => { Object.assign(captured, useContext(MonteCarloContext)); return null; };
        render(<MonteCarloProvider><Probe /></MonteCarloProvider>);

        let result = true;
        await act(async () => {
            result = await captured.tryRestoreSummary([], [], [], runAssumptions, runTaxState);
        });

        expect(result).toBe(false);
        expect(captured.state.summary).toBeNull();
    });

    it('tryRestoreSummary no-ops (no cache read) when a summary already exists', async () => {
        const captured = {} as React.ContextType<typeof MonteCarloContext>;
        const Probe = () => { Object.assign(captured, useContext(MonteCarloContext)); return null; };
        render(<MonteCarloProvider><Probe /></MonteCarloProvider>);

        act(() => { captured.dispatch({ type: 'COMPLETE_SIMULATION', payload: createMockSummary({ successRate: 91 }) }); });

        let result = true;
        await act(async () => {
            result = await captured.tryRestoreSummary([], [], [], runAssumptions, runTaxState);
        });

        expect(result).toBe(false);
        expect(getCachedSummary).not.toHaveBeenCalled();
        expect(captured.state.summary?.successRate).toBe(91);
    });

    it('RESTORE_SUMMARY does not clobber an in-flight run or an existing summary', () => {
        const captured = {} as React.ContextType<typeof MonteCarloContext>;
        const Probe = () => { Object.assign(captured, useContext(MonteCarloContext)); return null; };
        render(<MonteCarloProvider><Probe /></MonteCarloProvider>);

        // In-flight run: a late restore must be ignored.
        act(() => { captured.dispatch({ type: 'START_SIMULATION' }); });
        act(() => { captured.dispatch({ type: 'RESTORE_SUMMARY', payload: createMockSummary({ successRate: 10 }) }); });
        expect(captured.state.summary).toBeNull();
        expect(captured.state.isRunning).toBe(true);

        // Existing (newer) summary: a late restore must not overwrite it.
        act(() => { captured.dispatch({ type: 'COMPLETE_SIMULATION', payload: createMockSummary({ successRate: 88 }) }); });
        act(() => { captured.dispatch({ type: 'RESTORE_SUMMARY', payload: createMockSummary({ successRate: 10 }) }); });
        expect(captured.state.summary?.successRate).toBe(88);
    });
});

describe('#204 MonteCarloTab restore on mount', () => {
    const fakeYear = {
        year: new Date().getFullYear(),
        accounts: [], incomes: [], expenses: [], cashflow: {},
    } as unknown as SimulationYear;

    function renderTab() {
        return render(
            <AccountContext.Provider value={{ accounts: [], amountHistory: {}, dispatch: () => null } as unknown as React.ContextType<typeof AccountContext>}>
                <IncomeContext.Provider value={{ incomes: [], dispatch: () => null } as unknown as React.ContextType<typeof IncomeContext>}>
                    <ExpenseContext.Provider value={{ expenses: [], dispatch: () => null } as unknown as React.ContextType<typeof ExpenseContext>}>
                        <AssumptionsContext.Provider value={{ state: defaultAssumptions as AssumptionsState, dispatch: () => null }}>
                            <TaxContext.Provider value={{ state: defaultTaxState as TaxState, dispatch: () => null }}>
                                <MonteCarloProvider>
                                    <MonteCarloTab simulationData={[fakeYear]} />
                                </MonteCarloProvider>
                            </TaxContext.Provider>
                        </AssumptionsContext.Provider>
                    </ExpenseContext.Provider>
                </IncomeContext.Provider>
            </AccountContext.Provider>
        );
    }

    it('renders results (not "No simulation data") when a summary is cached', async () => {
        (getCachedSummary as Mock).mockResolvedValue(createMockSummary({ successRate: 77 }));

        renderTab();

        await waitFor(() => {
            expect(screen.queryByText('No simulation data')).not.toBeInTheDocument();
        });
        expect(screen.getByText('77.0%')).toBeInTheDocument();
    });

    it('shows the empty state when nothing is cached', async () => {
        (getCachedSummary as Mock).mockResolvedValue(null);

        renderTab();

        await waitFor(() => {
            expect(getCachedSummary).toHaveBeenCalled();
        });
        expect(screen.getByText('No simulation data')).toBeInTheDocument();
    });
});
