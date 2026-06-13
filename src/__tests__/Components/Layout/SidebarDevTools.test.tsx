import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../../../components/Layout/Overlays/Sidebar';
import {
    AssumptionsContext,
    defaultAssumptions,
    AssumptionsState,
} from '../../../components/Objects/Assumptions/AssumptionsContext';

// Keep the test focused on nav entries — stub the data-management footer.
vi.mock('../../../components/Objects/CloudBackup/CloudBackupPanel', () => ({ default: () => null }));
vi.mock('../../../components/Objects/CloudBackup/BackupReminder', () => ({ default: () => null }));
vi.mock('../../../components/Objects/Theme/ThemeSwitcher', () => ({ default: () => null }));

function renderSidebar(display: Partial<AssumptionsState['display']> = {}) {
    const state: AssumptionsState = {
        ...defaultAssumptions,
        display: { ...defaultAssumptions.display, ...display },
    };
    return render(
        <AssumptionsContext.Provider value={{ state, dispatch: () => {} }}>
            <MemoryRouter>
                <Sidebar isOpen={false} />
            </MemoryRouter>
        </AssumptionsContext.Provider>
    );
}

/**
 * P5 — the Testing tab is a developer surface: its sidebar entry is gated
 * behind display.showDevTools. The /testing route itself stays mounted
 * regardless (direct URLs keep working) — this only hides the nav entry.
 */
describe('Sidebar — Testing entry gated by showDevTools', () => {
    it('hides the Testing entry by default', () => {
        renderSidebar();
        expect(screen.queryByText('Testing')).not.toBeInTheDocument();
        // Sanity: the rest of the nav is intact.
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Budget')).toBeInTheDocument();
    });

    it('shows the Testing entry when showDevTools is enabled', () => {
        renderSidebar({ showDevTools: true });
        const testingLink = screen.getByText('Testing').closest('a');
        expect(testingLink).not.toBeNull();
        expect(testingLink).toHaveAttribute('href', '/testing');
    });

    it('does not show Testing for experimental features alone (showDevTools owns the gate)', () => {
        renderSidebar({ showExperimentalFeatures: true, showDevTools: false });
        expect(screen.queryByText('Testing')).not.toBeInTheDocument();
    });
});
