/**
 * #190: NetWorthCard history line used `acc.amount || 1` as the divisor for the
 * "vested ratio" it applies to historical snapshots. Roll an old 401k out to an
 * IRA and zero it (amount → 0) and the ratio became vestedAmount(0) / 1 = 0, so
 * every past snapshot of that account was multiplied by 0 — the account's entire
 * history vanished from the Dashboard net-worth line.
 *
 * Fixed: when the account is currently empty there's no vested ratio to apply, so
 * treat it as fully vested (ratio 1) and keep the historical points intact.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Capture the data handed to the line chart instead of rendering nivo.
let capturedData: Array<{ id: string; data: Array<{ x: unknown; y: number }> }> = [];
vi.mock('@nivo/line', () => ({
    ResponsiveLine: (props: { data: typeof capturedData }) => {
        capturedData = props.data;
        return <div data-testid="mock-line" />;
    },
}));
vi.mock('../../../components/Charts/useChartTheme', () => ({
    useChartTheme: () => ({ resolve: (v: string) => v }),
}));

import { NetWorthCard } from '../../../components/Charts/Networth';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { AssumptionsContext, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';

function renderCard(accounts: InvestedAccount[], amountHistory: Record<string, { date: string; num: number }[]>) {
    return render(
        <AssumptionsContext.Provider value={{ state: defaultAssumptions, dispatch: () => null }}>
            <AccountContext.Provider value={{ accounts, amountHistory } as never}>
                <ExpenseContext.Provider value={{ expenses: [] } as never}>
                    <NetWorthCard />
                </ExpenseContext.Provider>
            </AccountContext.Provider>
        </AssumptionsContext.Provider>
    );
}

describe('NetWorthCard history preserves an emptied account (#190)', () => {
    it('keeps past $50k snapshots on the line after the account is rolled out to $0', () => {
        // Rolled-out 401k: currently $0 (amount 0, no employer balance → vested 0),
        // but two monthly history snapshots recorded it at $50,000.
        const rolledOut = new InvestedAccount('acc1', 'Old 401k', 0, 0, 5, 0.1, 'Traditional 401k', true, 0.2, 0);
        const amountHistory = {
            acc1: [
                { date: '2025-01-15', num: 50000 },
                { date: '2025-02-15', num: 50000 },
            ],
        };
        renderCard([rolledOut], amountHistory);

        const points = capturedData[0].data;
        expect(points.length).toBe(2);
        // With the bug (ratio 0/1 = 0) every y would be 0. Fixed: ratio 1 → $50k.
        expect(points.every(p => p.y === 50000)).toBe(true);
    });
});
