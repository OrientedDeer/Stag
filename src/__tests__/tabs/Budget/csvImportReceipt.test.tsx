import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useReducer } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ReceiptToastProvider } from '../../../components/Layout/Overlays/ReceiptToast';
import { useCSVImportFlow } from '../../../tabs/Budget/csvImport/useCSVImportFlow';
import {
    csvImportReducer,
    initialCSVImportState,
    type CSVImportState,
} from '../../../tabs/Budget/csvImport/csvImportReducer';
import type { Transaction, MonthlySnapshot, BudgetState } from '../../../components/Objects/Budget/BudgetContext';

const importSettings: BudgetState['importSettings'] = {
    dateColumn: 'Date',
    amountColumn: 'Amount',
    descriptionColumn: 'Description',
    categoryMappings: [],
    savedCSVFormats: [],
    autoCreateRules: false,
};

const txn = (id: string, date: Date): Transaction => ({
    id,
    date,
    description: id,
    amount: -10,
});

const snapshot = (month: number, year: number): MonthlySnapshot => ({
    id: `${year}-${month}`,
    month,
    year,
    spending: {},
    accountBalances: {},
    contributions: {},
    transactions: [],
    reconciled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
});

/**
 * Harness: seeds the import reducer's state with preview-ready transactions,
 * then exposes handleImport so the test can fire the completion path that
 * raises the receipt toast.
 */
const Harness = ({ seed, onReady }: { seed: Partial<CSVImportState>; onReady: (fn: () => void) => void }) => {
    const [state] = useReducer(csvImportReducer, { ...initialCSVImportState, ...seed });
    const actions = useCSVImportFlow({
        state,
        dispatch: vi.fn(),
        importSettings,
        existingTransactions: [],
        budgetDispatch: vi.fn(),
        getOrCreateMonth: (m, y) => snapshot(m, y),
    });
    onReady(actions.handleImport);
    return null;
};

const renderHarness = (seed: Partial<CSVImportState>) => {
    let handleImport: () => void = () => {};
    render(
        <MemoryRouter>
            <ReceiptToastProvider>
                <Harness seed={seed} onReady={fn => { handleImport = fn; }} />
            </ReceiptToastProvider>
        </MemoryRouter>
    );
    return () => act(() => handleImport());
};

describe('CSV import receipt (B1)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('fires a receipt naming the count and destination month', () => {
        const fire = renderHarness({
            stage: 'preview',
            transactions: [txn('a', new Date(2026, 5, 3)), txn('b', new Date(2026, 5, 10))],
            duplicates: [],
            saveFormat: false,
        });

        fire();

        const toast = screen.getByRole('status');
        expect(toast).toHaveTextContent('Imported 2 transactions to June 2026');
        // No new format saved → no Settings link.
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('links to Settings when a new CSV format was saved', () => {
        const fire = renderHarness({
            stage: 'preview',
            transactions: [txn('a', new Date(2026, 5, 3))],
            duplicates: [],
            csvContent: { headers: ['Date', 'Amount', 'Description'], rows: [], hasHeaders: true },
            mapping: { dateColumn: 0, descriptionColumn: 2, amountColumn: 1 },
            saveFormat: true,
            formatName: 'My Bank',
            matchedFormat: null,
        });

        fire();

        const toast = screen.getByRole('status');
        expect(toast).toHaveTextContent('saved CSV format "My Bank"');
        const link = screen.getByRole('link', { name: 'View Settings' });
        expect(link).toHaveAttribute('href', '/budget?tab=Settings');
    });

    it('reports a multi-month spread without listing every month', () => {
        const fire = renderHarness({
            stage: 'preview',
            transactions: [txn('a', new Date(2026, 4, 3)), txn('b', new Date(2026, 5, 10))],
            duplicates: [],
            saveFormat: false,
        });

        fire();

        expect(screen.getByRole('status')).toHaveTextContent('across 2 months');
    });

    it('does not fire when every transaction is a duplicate', () => {
        const dup = txn('a', new Date(2026, 5, 3));
        const fire = renderHarness({
            stage: 'preview',
            transactions: [dup],
            duplicates: [dup],
            saveFormat: false,
        });

        fire();

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
