import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import GlobalKeyboardShortcuts from '../../../components/Layout/Overlays/GlobalKeyboardShortcuts';
import {
    AssumptionsContext,
    defaultAssumptions,
    type AssumptionsState,
} from '../../../components/Objects/Assumptions/AssumptionsContext';

function LocationProbe() {
    const { pathname } = useLocation();
    return <div data-testid="pathname">{pathname}</div>;
}

function renderAt(initialPath: string, showDevTools: boolean) {
    const state: AssumptionsState = {
        ...defaultAssumptions,
        display: { ...defaultAssumptions.display, showDevTools },
    };
    return render(
        <AssumptionsContext.Provider value={{ state, dispatch: () => {} }}>
            <MemoryRouter initialEntries={[initialPath]}>
                <GlobalKeyboardShortcuts />
                <LocationProbe />
            </MemoryRouter>
        </AssumptionsContext.Provider>
    );
}

/**
 * P5 — Shift+↑/↓ sidebar navigation must mirror the sidebar: /testing is only
 * reachable when display.showDevTools is on.
 */
describe('GlobalKeyboardShortcuts — /testing gated by showDevTools', () => {
    it('Shift+ArrowDown from the last visible page skips /testing when hidden', () => {
        renderAt('/projection', false);
        fireEvent.keyDown(window, { key: 'ArrowDown', shiftKey: true });
        // Wraps straight past the hidden Testing entry to Dashboard.
        expect(screen.getByTestId('pathname')).toHaveTextContent('/dashboard');
    });

    it('Shift+ArrowDown reaches /testing when showDevTools is on', () => {
        renderAt('/projection', true);
        fireEvent.keyDown(window, { key: 'ArrowDown', shiftKey: true });
        expect(screen.getByTestId('pathname')).toHaveTextContent('/testing');
    });

    it('Shift+ArrowUp from Dashboard wraps to the last visible page when /testing is hidden', () => {
        renderAt('/dashboard', false);
        fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true });
        expect(screen.getByTestId('pathname')).toHaveTextContent('/projection');
    });
});
