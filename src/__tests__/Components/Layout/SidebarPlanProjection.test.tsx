import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../../../components/Layout/Overlays/Sidebar';
import {
    AssumptionsContext,
    defaultAssumptions,
} from '../../../components/Objects/Assumptions/AssumptionsContext';

// Keep the test focused on nav entries — stub the data-management footer.
vi.mock('../../../components/Objects/CloudBackup/CloudBackupPanel', () => ({ default: () => null }));
vi.mock('../../../components/Objects/CloudBackup/BackupReminder', () => ({ default: () => null }));
vi.mock('../../../components/Objects/Theme/ThemeSwitcher', () => ({ default: () => null }));

function renderSidebar() {
    return render(
        <AssumptionsContext.Provider value={{ state: defaultAssumptions, dispatch: () => {} }}>
            <MemoryRouter>
                <Sidebar isOpen={false} />
            </MemoryRouter>
        </AssumptionsContext.Provider>
    );
}

/**
 * P7 — the old Future group (Assumptions, Allocation, Withdrawal, Charts) is
 * split: plan inputs live under "Plan", projection outputs under a top-level
 * "Projection" link.
 */
describe('Sidebar — Plan/Projection IA', () => {
    it('renders the Plan group with its three sub-links', () => {
        renderSidebar();
        expect(screen.getByText('Plan')).toBeInTheDocument();
        expect(screen.getByText('Assumptions').closest('a')).toHaveAttribute('href', '/plan/assumptions');
        expect(screen.getByText('Allocation').closest('a')).toHaveAttribute('href', '/plan/allocation');
        expect(screen.getByText('Withdrawal').closest('a')).toHaveAttribute('href', '/plan/withdrawal');
    });

    it('renders Projection as a top-level link', () => {
        renderSidebar();
        expect(screen.getByText('Projection').closest('a')).toHaveAttribute('href', '/projection');
    });

    it('no longer shows the old Future group or Charts entry', () => {
        renderSidebar();
        expect(screen.queryByText('Future')).not.toBeInTheDocument();
        expect(screen.queryByText('Charts')).not.toBeInTheDocument();
    });

    it('keeps the rest of the nav intact', () => {
        renderSidebar();
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Current')).toBeInTheDocument();
        expect(screen.getByText('Budget')).toBeInTheDocument();
    });
});
