import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import FutureTab from '../../../tabs/Future/FutureTab';
import { SimulationContext } from '../../../components/Objects/Assumptions/SimulationContext';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { RSUAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';

/**
 * #132 — a configured RSU grant the projection can't value (no current share
 * price, or no fixed start date) recognizes $0 at vest and silently reaches the
 * headline numbers. FutureTab surfaces a TOP-LEVEL warning naming each affected
 * income. These render tests assert the banner shows for the two non-vesting
 * causes and stays hidden for a fully-valid / no-grant plan.
 */

// Stub the chart-heavy child tabs — these tests are about the top-level banner.
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

function makeRSUWorkIncome(opts: {
    startDate?: Date;
    rsuAccountId?: string | null;
}): WorkIncome {
    const w = new WorkIncome(
        'inc-1', 'Acme', 100_000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED',
    );
    w.rsuVestingSchedule = 'cliff-1yr';
    w.rsuGrantShares = 1000;
    w.rsuAccountId = 'rsuAccountId' in opts ? opts.rsuAccountId ?? null : 'rsu-1';
    w.startDate = opts.startDate;
    return w;
}

function makeRSUAccount(currentSharePrice?: number): RSUAccount {
    const acc = new RSUAccount('rsu-1', 'Acme RSUs', 0);
    acc.currentSharePrice = currentSharePrice;
    return acc;
}

function renderFutureTab(incomes: WorkIncome[], accounts: RSUAccount[]) {
    return render(
        <AccountContext.Provider value={{ accounts, amountHistory: {} }}>
            <IncomeContext.Provider value={{ incomes }}>
                <SimulationContext.Provider
                    value={{ simulation: [fakeYear], inputHash: 'test-hash', dispatch: () => null }}
                >
                    <FutureTab />
                </SimulationContext.Provider>
            </IncomeContext.Provider>
        </AccountContext.Provider>
    );
}

beforeEach(() => {
    localStorage.clear();
});

describe('FutureTab — non-vesting RSU warning (#132)', () => {
    it('renders the warning for a grant with no current share price', () => {
        renderFutureTab(
            [makeRSUWorkIncome({ startDate: new Date(2024, 0, 1) })],
            [makeRSUAccount(undefined)],
        );
        expect(screen.getByText("RSU Grant Won't Vest")).toBeInTheDocument();
        expect(screen.getByText(/no current share price set/i)).toBeInTheDocument();
        // The affected income is named so the user knows which one.
        expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    it('renders the warning for a milestone-started grant with no fixed start date', () => {
        renderFutureTab(
            [makeRSUWorkIncome({ startDate: undefined })],
            [makeRSUAccount(150)],
        );
        expect(screen.getByText("RSU Grant Won't Vest")).toBeInTheDocument();
        expect(screen.getByText(/no fixed start date/i)).toBeInTheDocument();
    });

    it('does NOT render the warning for a fully-valid grant', () => {
        renderFutureTab(
            [makeRSUWorkIncome({ startDate: new Date(2024, 0, 1) })],
            [makeRSUAccount(150)],
        );
        expect(screen.queryByText("RSU Grant Won't Vest")).not.toBeInTheDocument();
    });

    it('does NOT render the warning when there is no income at all', () => {
        renderFutureTab([], []);
        expect(screen.queryByText("RSU Grant Won't Vest")).not.toBeInTheDocument();
    });
});
