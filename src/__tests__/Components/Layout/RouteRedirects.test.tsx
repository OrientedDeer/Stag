import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from '../../../App';

/**
 * P7 — the Future group split into Plan (inputs) + Projection (outputs).
 * Old /future/* URLs must keep working as redirects so bookmarks and muscle
 * memory don't break.
 *
 * Page components and chrome are stubbed — this test is about the route
 * table in App.tsx, not the pages themselves.
 */
vi.mock('../../../tabs/Dashboard', () => ({ default: () => <div data-testid="page-dashboard" /> }));
vi.mock('../../../tabs/Current/AccountTab', () => ({ default: () => <div data-testid="page-accounts" /> }));
vi.mock('../../../tabs/Current/IncomeTab', () => ({ default: () => <div data-testid="page-income" /> }));
vi.mock('../../../tabs/Current/ExpenseTab', () => ({ default: () => <div data-testid="page-expense" /> }));
vi.mock('../../../tabs/Current/TaxesTab', () => ({ default: () => <div data-testid="page-taxes" /> }));
vi.mock('../../../tabs/Budget/BudgetTab', () => ({ default: () => <div data-testid="page-budget" /> }));
vi.mock('../../../tabs/Future/FutureTab', () => ({ default: () => <div data-testid="page-projection" /> }));
vi.mock('../../../tabs/Future/AssumptionTab', () => ({ default: () => <div data-testid="page-assumptions" /> }));
vi.mock('../../../tabs/Future/PriorityTab', () => ({ default: () => <div data-testid="page-allocation" /> }));
vi.mock('../../../tabs/Future/WithdrawalTab', () => ({ default: () => <div data-testid="page-withdrawal" /> }));
vi.mock('../../../tabs/Testing/Testing', () => ({ default: () => <div data-testid="page-testing" /> }));
vi.mock('../../../components/Layout/Overlays/Sidebar', () => ({ default: () => null }));
vi.mock('../../../components/Layout/Overlays/TopBar', () => ({ default: () => null }));
vi.mock('../../../components/Layout/Overlays/GlobalKeyboardShortcuts', () => ({ default: () => null }));
vi.mock('../../../components/Objects/CloudBackup/CloudBackupSync', () => ({ default: () => null }));
vi.mock('../../../components/Objects/CloudBackup/CloudBackupProvider', () => ({
    CloudBackupProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function LocationProbe() {
    const { pathname } = useLocation();
    return <div data-testid="pathname">{pathname}</div>;
}

function renderAt(initialPath: string) {
    return render(
        <MemoryRouter initialEntries={[initialPath]}>
            <App />
            <LocationProbe />
        </MemoryRouter>
    );
}

describe('App routes — Plan/Projection IA', () => {
    it.each([
        ['/plan/assumptions', 'page-assumptions'],
        ['/plan/allocation', 'page-allocation'],
        ['/plan/withdrawal', 'page-withdrawal'],
        ['/projection', 'page-projection'],
    ])('serves the new path %s', (path, testId) => {
        renderAt(path);
        expect(screen.getByTestId('pathname')).toHaveTextContent(path);
        expect(screen.getByTestId(testId)).toBeInTheDocument();
    });

    it.each([
        ['/future/assumptions', '/plan/assumptions', 'page-assumptions'],
        ['/future/allocation', '/plan/allocation', 'page-allocation'],
        ['/future/withdrawal', '/plan/withdrawal', 'page-withdrawal'],
        ['/future/charts', '/projection', 'page-projection'],
        ['/future', '/projection', 'page-projection'],
    ])('redirects legacy %s to %s', (oldPath, newPath, testId) => {
        renderAt(oldPath);
        expect(screen.getByTestId('pathname')).toHaveTextContent(newPath);
        expect(screen.getByTestId(testId)).toBeInTheDocument();
    });

    it('redirects the bare /plan group path to Assumptions', () => {
        renderAt('/plan');
        expect(screen.getByTestId('pathname')).toHaveTextContent('/plan/assumptions');
        expect(screen.getByTestId('page-assumptions')).toBeInTheDocument();
    });
});
