import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CashflowTab } from '../../../tabs/Future/tabs/CashflowTabs';
import {
    AssumptionsContext,
    defaultAssumptions,
    type AssumptionsState,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import type { SimulationYear } from '../../../services/simulation/types';

// Replace the (lazy-loaded) Sankey with a stub that immediately reports an
// imbalance through onBalanceCheck — the same callback path the real chart's
// self-check uses.
vi.mock('../../../components/Charts/CashflowSankey', async () => {
    const React = await import('react');
    const CashflowSankey = (props: { onBalanceCheck?: (imbalances: unknown[]) => void }) => {
        const { onBalanceCheck } = props;
        React.useEffect(() => {
            onBalanceCheck?.([
                { nodeName: 'Expenses', inflows: 32400, outflows: 29100, difference: 3300 },
            ]);
        }, [onBalanceCheck]);
        return React.createElement('div', { 'data-testid': 'mock-sankey' });
    };
    return { CashflowSankey };
});

function makeYearData(year: number): SimulationYear {
    return {
        year,
        incomes: [],
        expenses: [],
        accounts: [],
        taxDetails: {
            fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0,
            capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
        },
        cashflow: {
            totalIncome: 0,
            totalExpense: 0,
            livingExpenses: 0,
            discretionary: 0,
            investedUser: 0,
            investedMatch: 0,
            totalInvested: 0,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {},
        },
        logs: [],
    };
}

function renderCashflowTab(display: Partial<AssumptionsState['display']> = {}) {
    const state: AssumptionsState = {
        ...defaultAssumptions,
        display: { ...defaultAssumptions.display, ...display },
    };
    return render(
        <AssumptionsContext.Provider value={{ state, dispatch: () => {} }}>
            <CashflowTab simulationData={[makeYearData(2026), makeYearData(2027)]} />
        </AssumptionsContext.Provider>
    );
}

/**
 * P5 — the Sankey imbalance banner is an accounting self-check, not something
 * an end user can act on. It only renders when display.showDevTools is on;
 * the balance check itself still runs either way (the stub always reports an
 * imbalance — only the flag changes between the two tests).
 */
describe('CashflowTab — Sankey imbalance banner gated by showDevTools', () => {
    it('hides the banner by default even when imbalances are reported', async () => {
        renderCashflowTab();
        // Wait for the lazy Sankey stub to mount and fire its balance check.
        await screen.findByTestId('mock-sankey');
        await waitFor(() =>
            expect(screen.queryByText(/Sankey Imbalance Detected/)).not.toBeInTheDocument()
        );
    });

    it('shows the banner when showDevTools is enabled', async () => {
        renderCashflowTab({ showDevTools: true });
        await screen.findByTestId('mock-sankey');
        expect(await screen.findByText(/Sankey Imbalance Detected/)).toBeInTheDocument();
        // The reported node and amounts surface in the banner body.
        expect(screen.getByText('Expenses')).toBeInTheDocument();
    });
});
