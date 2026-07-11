import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../../App';

/**
 * #202 — Testing (~6,600 lines), the Monte Carlo tab, and the Scenario
 * Comparison tab are lazy-loaded (React.lazy + Suspense) instead of
 * eager-imported, so their code no longer ships in the main chunk that
 * loads on first paint.
 *
 * This smoke test renders the REAL (unmocked) Testing route so it actually
 * exercises the dynamic import() / Suspense boundary wired up in App.tsx,
 * rather than a vi.mock stand-in — a wrong export name or a missing
 * Suspense boundary would surface here as a thrown error or a fallback
 * that never resolves.
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
// Testing.tsx is intentionally NOT mocked here — this test wants the real
// lazy-loaded module.
vi.mock('../../../components/Layout/Overlays/Sidebar', () => ({ default: () => null }));
vi.mock('../../../components/Layout/Overlays/TopBar', () => ({ default: () => null }));
vi.mock('../../../components/Layout/Overlays/GlobalKeyboardShortcuts', () => ({ default: () => null }));
vi.mock('../../../components/Objects/CloudBackup/CloudBackupSync', () => ({ default: () => null }));
vi.mock('../../../components/Objects/CloudBackup/CloudBackupProvider', () => ({
    CloudBackupProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderAt(initialPath: string) {
    return render(
        <MemoryRouter initialEntries={[initialPath]}>
            <App />
        </MemoryRouter>
    );
}

describe('Lazy tab loading (#202)', () => {
    it('resolves the real lazy-loaded Testing chunk and renders its content', async () => {
        renderAt('/testing');
        // Experimental features are off by default, so the real (unmocked)
        // Testing component's gate message is what proves the module loaded
        // and rendered — this text only exists inside the real component,
        // not in any fallback or mock.
        // Generous timeout: in the test environment, Vite has to transform the
        // ~6,600-line Testing.tsx module (plus its own dependency tree) on
        // first dynamic import, which can take noticeably longer than RTL's
        // default 1000ms findBy* timeout.
        expect(
            await screen.findByText(
                'Enable experimental features in Assumptions to access Testing.',
                {},
                { timeout: 10000 }
            )
        ).toBeInTheDocument();
    });
});
