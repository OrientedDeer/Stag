import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import FutureTab from '../../../tabs/Future/FutureTab';
import { SimulationContext } from '../../../components/Objects/Assumptions/SimulationContext';
import { type SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { RSUAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';

/**
 * #132 — a configured RSU grant the projection can't value (no anchor, no linked
 * account, or no current share price) recognizes $0 at vest and silently reaches
 * the headline numbers. FutureTab surfaces a TOP-LEVEL warning naming each affected
 * income. These render tests assert the banner shows for each non-vesting cause,
 * stays hidden for a fully-valid / milestone-anchored / ended / no-grant plan, that
 * the footer guidance is cause-complete, and that two same-named incomes both list.
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
    id?: string;
    name?: string;
    startDate?: Date;
    startMilestoneId?: string;
    rsuAccountId?: string | null;
    end_date?: Date;
}): WorkIncome {
    const w = new WorkIncome(
        opts.id ?? 'inc-1', opts.name ?? 'Acme', 100_000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED',
    );
    w.rsuVestingSchedule = 'cliff-1yr';
    w.rsuGrantShares = 1000;
    w.rsuAccountId = 'rsuAccountId' in opts ? opts.rsuAccountId ?? null : 'rsu-1';
    w.startDate = opts.startDate;
    if ('startMilestoneId' in opts) w.startMilestoneId = opts.startMilestoneId;
    if ('end_date' in opts) w.end_date = opts.end_date;
    return w;
}

// A second RSU account id so a grant can link a real account while another links a
// dangling one in the mixed-cause test.
function makeRSUAccount(currentSharePrice?: number, id = 'rsu-1'): RSUAccount {
    const acc = new RSUAccount(id, 'Acme RSUs', 0);
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
        expect(screen.getByText(/set a Current Share Price/i)).toBeInTheDocument();
        // The affected income is named so the user knows which one.
        expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    it('renders the warning for a genuinely un-anchored grant (no start date AND no milestone)', () => {
        renderFutureTab(
            [makeRSUWorkIncome({ startDate: undefined })],
            [makeRSUAccount(150)],
        );
        expect(screen.getByText("RSU Grant Won't Vest")).toBeInTheDocument();
        expect(screen.getByText(/neither a start date nor a start milestone/i)).toBeInTheDocument();
        expect(screen.getByText(/set a start date or start milestone/i)).toBeInTheDocument();
    });

    it('renders the warning for a grant with no linked account (#132 fix [5])', () => {
        renderFutureTab(
            [makeRSUWorkIncome({ startDate: new Date(2024, 0, 1), rsuAccountId: null })],
            [makeRSUAccount(150)],
        );
        expect(screen.getByText("RSU Grant Won't Vest")).toBeInTheDocument();
        expect(screen.getByText(/isn't linked to an RSU account/i)).toBeInTheDocument();
        expect(screen.getByText(/link an RSU account/i)).toBeInTheDocument();
    });

    it('renders the warning for a grant with a DANGLING account id (account deleted)', () => {
        renderFutureTab(
            [makeRSUWorkIncome({ startDate: new Date(2024, 0, 1), rsuAccountId: 'deleted-acct' })],
            [makeRSUAccount(150)],
        );
        expect(screen.getByText("RSU Grant Won't Vest")).toBeInTheDocument();
        expect(screen.getByText(/isn't linked to an RSU account/i)).toBeInTheDocument();
    });

    it('does NOT render the warning for a milestone-started grant with a valid price (#132 fix [1])', () => {
        renderFutureTab(
            [makeRSUWorkIncome({ startDate: undefined, startMilestoneId: 'ms-retire' })],
            [makeRSUAccount(150)],
        );
        expect(screen.queryByText("RSU Grant Won't Vest")).not.toBeInTheDocument();
    });

    it('does NOT render the warning for an ENDED job even with a blank price', () => {
        renderFutureTab(
            [makeRSUWorkIncome({ startDate: new Date(2010, 0, 1), end_date: new Date(2015, 0, 1) })],
            [makeRSUAccount(undefined)],
        );
        expect(screen.queryByText("RSU Grant Won't Vest")).not.toBeInTheDocument();
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

    it('footer guidance is cause-complete for a MIXED no-price + no-account plan (#132 fix [4])', () => {
        renderFutureTab(
            [
                // no-price: links a real account (rsu-1) whose price is blank.
                makeRSUWorkIncome({ id: 'inc-price', name: 'Acme Price', startDate: new Date(2024, 0, 1), rsuAccountId: 'rsu-1' }),
                // no-account: unset link.
                makeRSUWorkIncome({ id: 'inc-acct', name: 'Acme Acct', startDate: new Date(2024, 0, 1), rsuAccountId: null }),
            ],
            [makeRSUAccount(undefined, 'rsu-1')],
        );
        expect(screen.getByText("RSU Grant Won't Vest")).toBeInTheDocument();
        // Both per-item reasons present.
        expect(screen.getByText(/no current share price set/i)).toBeInTheDocument();
        expect(screen.getByText(/isn't linked to an RSU account/i)).toBeInTheDocument();
        // Footer covers BOTH remedies, not just the price fix.
        expect(screen.getByText(/set a Current Share Price on the linked RSU account/i)).toBeInTheDocument();
        expect(screen.getByText(/link an RSU account/i)).toBeInTheDocument();
    });

    it('lists BOTH of two same-named non-vesting incomes (unique key, #132 fix [3])', () => {
        renderFutureTab(
            [
                makeRSUWorkIncome({ id: 'inc-a', name: 'Acme', startDate: new Date(2024, 0, 1), rsuAccountId: 'rsu-1' }),
                makeRSUWorkIncome({ id: 'inc-b', name: 'Acme', startDate: new Date(2024, 0, 1), rsuAccountId: 'rsu-1' }),
            ],
            [makeRSUAccount(undefined, 'rsu-1')],
        );
        expect(screen.getByText("RSU Grant Won't Vest")).toBeInTheDocument();
        // Two same-named incomes with the same reason → two distinct <li> rows. With a
        // `name-reason` key one row was silently dropped; a unique id key keeps both.
        expect(screen.getAllByText('Acme')).toHaveLength(2);
    });
});
