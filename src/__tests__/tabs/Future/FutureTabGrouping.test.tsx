import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FutureTab from '../../../tabs/Future/FutureTab';
import { migrateSavedFutureTab } from '../../../tabs/Future/futureTabs';
import { SimulationContext } from '../../../components/Objects/Assumptions/SimulationContext';
import { type SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';

/**
 * P7 — the nine flat Projection subtabs are grouped: Monte Carlo (with its
 * nested Historical Backtest toggle) under "Risk", Tax + Scenarios under
 * "Strategy" behind a secondary toggle. Saved tab names from before the
 * regroup must migrate instead of crashing or vanishing.
 */

// Stub the chart-heavy child tabs — this test is about the tab chrome.
vi.mock('../../../tabs/Future/tabs/OverviewTab', () => ({ OverviewTab: () => <div data-testid="stub-overview" /> }));
vi.mock('../../../tabs/Future/tabs/CashflowTabs', () => ({ CashflowTab: () => <div data-testid="stub-cashflow" /> }));
vi.mock('../../../tabs/Future/tabs/DebtTab', () => ({ DebtTab: () => <div data-testid="stub-debt" /> }));
vi.mock('../../../tabs/Future/tabs/DataTab', () => ({ DataTab: () => <div data-testid="stub-data" /> }));
vi.mock('../../../tabs/Future/tabs/MonteCarloTab', () => ({ MonteCarloTab: () => <div data-testid="stub-monte-carlo" /> }));
vi.mock('../../../tabs/Future/tabs/TaxOptimizationTab', () => ({ TaxOptimizationTab: () => <div data-testid="stub-tax" /> }));
vi.mock('../../../tabs/Future/tabs/ScenarioComparisonTab', () => ({ ScenarioComparisonTab: () => <div data-testid="stub-scenarios" /> }));
vi.mock('../../../tabs/Future/tabs/FinancialRatiosTab', () => ({ FinancialRatiosTab: () => <div data-testid="stub-ratios" /> }));
vi.mock('../../../components/Charts/AssetsStreamChart', () => ({ AssetsStreamChart: () => <div data-testid="stub-assets-chart" /> }));
vi.mock('../../../tabs/Future/tabs/AfterTaxNetWorthChart', () => ({ AfterTaxNetWorthChart: () => <div data-testid="stub-aftertax-chart" /> }));
// Pin the input hash so the stale-simulation auto-recalc never fires.
vi.mock('../../../services/simulationHash', () => ({ getSimulationInputHash: () => 'test-hash' }));

const fakeYear = {
    year: new Date().getFullYear(),
    accounts: [],
    incomes: [],
    expenses: [],
    cashflow: {},
} as unknown as SimulationYear;

function renderFutureTab() {
    return render(
        <SimulationContext.Provider
            value={{ simulation: [fakeYear], inputHash: 'test-hash', dispatch: () => null }}
        >
            <FutureTab />
        </SimulationContext.Provider>
    );
}

const topTab = (name: string) => screen.getByRole('tab', { name });

beforeEach(() => {
    localStorage.clear();
});

describe('migrateSavedFutureTab', () => {
    it('keeps current tab names as-is', () => {
        expect(migrateSavedFutureTab('Risk')).toBe('Risk');
        expect(migrateSavedFutureTab('Data')).toBe('Data');
    });

    it('maps pre-grouping names to their new home', () => {
        expect(migrateSavedFutureTab('Monte Carlo')).toBe('Risk');
        expect(migrateSavedFutureTab('Tax')).toBe('Strategy');
        expect(migrateSavedFutureTab('Scenarios')).toBe('Strategy');
    });

    it('falls back to Overview for unknown or missing values', () => {
        expect(migrateSavedFutureTab('Bogus')).toBe('Overview');
        expect(migrateSavedFutureTab(null)).toBe('Overview');
    });
});

describe('FutureTab — grouped tabs', () => {
    it('renders the grouped top-level tabs', () => {
        renderFutureTab();
        for (const tab of ['Overview', 'Cashflow', 'Assets', 'Debt', 'Risk', 'Strategy', 'Ratios', 'Data']) {
            expect(topTab(tab)).toBeInTheDocument();
        }
        expect(screen.queryByRole('tab', { name: 'Monte Carlo' })).not.toBeInTheDocument();
    });

    it('keeps all tab panels mounted (CSS-hidden, not unmounted)', async () => {
        renderFutureTab();
        // Charts must stay mounted across tab switches — see renderTabContent.
        // MonteCarloTab/ScenarioComparisonTab are lazy (#202), so they resolve
        // via Suspense — findBy* (async) rather than getBy*.
        expect(await screen.findByTestId('stub-monte-carlo')).toBeInTheDocument();
        expect(screen.getByTestId('stub-tax')).toBeInTheDocument();
        expect(await screen.findByTestId('stub-scenarios')).toBeInTheDocument();
        expect(screen.getByTestId('stub-ratios')).toBeInTheDocument();
    });

    it('switches tabs and persists the selection', () => {
        renderFutureTab();
        fireEvent.click(topTab('Risk'));
        expect(topTab('Risk')).toHaveAttribute('aria-selected', 'true');
        expect(localStorage.getItem('stag_future_tab')).toBe('Risk');
    });

    // #202 — MonteCarloTab and ScenarioComparisonTab are lazy-loaded (React.lazy
    // + Suspense) from within FutureTab. They render inside a Suspense boundary
    // now, so a click no longer guarantees the real content is present in the
    // very next synchronous assertion — findBy* (async) is the correct query,
    // not getBy*. This also validates the `.then(m => ({ default: m.X }))`
    // export-name mapping in FutureTab.tsx: a typo there would leave `default`
    // undefined and React.lazy would throw instead of rendering the stub.
    it('lazily loads and renders the Monte Carlo tab on click (#202)', async () => {
        renderFutureTab();
        fireEvent.click(topTab('Risk'));
        expect(await screen.findByTestId('stub-monte-carlo')).toBeInTheDocument();
    });

    it('lazily loads and renders the Scenario Comparison tab on click (#202)', async () => {
        renderFutureTab();
        fireEvent.click(topTab('Strategy'));
        fireEvent.click(screen.getByRole('tab', { name: 'Scenarios' }));
        expect(await screen.findByTestId('stub-scenarios')).toBeInTheDocument();
    });

    it('Strategy hosts a Tax/Scenarios secondary toggle', () => {
        renderFutureTab();
        fireEvent.click(topTab('Strategy'));
        expect(topTab('Strategy')).toHaveAttribute('aria-selected', 'true');

        const taxToggle = screen.getByRole('tab', { name: 'Tax' });
        const scenariosToggle = screen.getByRole('tab', { name: 'Scenarios' });
        expect(taxToggle).toHaveAttribute('aria-selected', 'true');

        fireEvent.click(scenariosToggle);
        expect(scenariosToggle).toHaveAttribute('aria-selected', 'true');
        expect(taxToggle).toHaveAttribute('aria-selected', 'false');
        expect(localStorage.getItem('stag_strategy_subtab')).toBe('Scenarios');
    });

    it('migrates a stale saved "Monte Carlo" tab to Risk', () => {
        localStorage.setItem('stag_future_tab', 'Monte Carlo');
        renderFutureTab();
        expect(topTab('Risk')).toHaveAttribute('aria-selected', 'true');
    });

    it('migrates a stale saved "Scenarios" tab to Strategy with Scenarios active', () => {
        localStorage.setItem('stag_future_tab', 'Scenarios');
        renderFutureTab();
        expect(topTab('Strategy')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Scenarios' })).toHaveAttribute('aria-selected', 'true');
    });

    it('falls back to Overview for an unrecognized saved tab', () => {
        localStorage.setItem('stag_future_tab', 'Does Not Exist');
        renderFutureTab();
        expect(topTab('Overview')).toHaveAttribute('aria-selected', 'true');
    });
});
