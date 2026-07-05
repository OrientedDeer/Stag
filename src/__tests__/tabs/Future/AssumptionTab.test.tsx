import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AssumptionTab from '../../../tabs/Future/AssumptionTab';
import {
    AssumptionsContext,
    defaultAssumptions,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import type { AssumptionsState } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationContext } from '../../../components/Objects/Assumptions/SimulationContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { computeGKRateSuggestion, getAutoRate } from '../../../services/gkRateSuggestion';

// The modal is heavy (drag/drop milestone editor) and closed by default — a
// marker stub is enough to prove the tab wires it up.
vi.mock('../../../components/Objects/Assumptions/MilestoneModal', () => ({
    default: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="milestone-modal" /> : null,
}));

// The rate-suggestion service is covered by its own suites; here we only test
// the tab's wiring, so stub it with controllable fns.
vi.mock('../../../services/gkRateSuggestion', () => ({
    computeGKRateSuggestion: vi.fn(() => null),
    getAutoRate: vi.fn(() => null),
}));

// Headless UI's Listbox doesn't open via fireEvent in jsdom (its state machine
// ignores synthetic pointer events), so swap DropdownInput for a native select.
// The dropdown widget itself is covered elsewhere; this suite tests tab logic.
vi.mock('../../../components/Layout/InputFields/DropdownInput', () => ({
    DropdownInput: ({ label, value, onChange, options }: {
        label: string;
        value: string;
        onChange: (val: string) => void;
        options: ({ value: string; label: string } | string)[];
    }) => (
        <label>
            {label}
            <select value={value} onChange={e => onChange(e.target.value)}>
                {options.map(opt => {
                    const normalized = typeof opt === 'string' ? { value: opt, label: opt } : opt;
                    return (
                        <option key={normalized.value} value={normalized.value}>
                            {normalized.label}
                        </option>
                    );
                })}
            </select>
        </label>
    ),
}));

function renderTab(investments: Partial<AssumptionsState['investments']> = {}) {
    const dispatch = vi.fn();
    const state: AssumptionsState = {
        ...defaultAssumptions,
        investments: { ...defaultAssumptions.investments, ...investments },
    };
    render(
        <ExpenseContext.Provider value={{ expenses: [] }}>
            <AssumptionsContext.Provider value={{ state, dispatch }}>
                <SimulationContext.Provider value={{ simulation: [], inputHash: null, dispatch: vi.fn() }}>
                    <AssumptionTab />
                </SimulationContext.Provider>
            </AssumptionsContext.Provider>
        </ExpenseContext.Provider>
    );
    return { dispatch };
}

beforeEach(() => {
    vi.mocked(computeGKRateSuggestion).mockReturnValue(null);
    vi.mocked(getAutoRate).mockReturnValue(null);
});

describe('AssumptionTab layout', () => {
    it('renders all top-level sections', () => {
        renderTab();
        expect(screen.getByText('Assumptions')).toBeInTheDocument();
        expect(screen.getByText('Plan Basics')).toBeInTheDocument();
        expect(screen.getByText('Growth Rates')).toBeInTheDocument();
        expect(screen.getByText('Retirement Withdrawals')).toBeInTheDocument();
        expect(screen.getByText('Advanced Settings')).toBeInTheDocument();
        expect(screen.getByText('Reset to Defaults')).toBeInTheDocument();
        // Plan Basics inlines the built-in milestone inputs + custom-milestone entry.
        expect(screen.getByText('Birth Year')).toBeInTheDocument();
        expect(screen.getByText('Manage custom milestones')).toBeInTheDocument();
    });

    it('files the ACA-aware Roth settings under Retirement Withdrawals, not Advanced', () => {
        renderTab();
        // Advanced is still collapsed, yet the Roth conversion settings are visible.
        expect(screen.getByText('Roth Conversions')).toBeInTheDocument();
        expect(screen.getByText('ACA-Aware Conversions')).toBeInTheDocument();
    });

    it('groups app preferences into an App Settings card under Advanced', () => {
        renderTab();
        expect(screen.queryByText('App Settings')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('Advanced Settings'));

        expect(screen.getByText('App Settings')).toBeInTheDocument();
        expect(screen.getByText('Number Display')).toBeInTheDocument();
        expect(screen.getByText('Experimental')).toBeInTheDocument();
        expect(screen.getByText('Developer tools')).toBeInTheDocument();
        // Model details live in their own card.
        expect(screen.getByText('Model Details')).toBeInTheDocument();
        expect(screen.getByText('Healthcare Inflation (%) (above inflation)')).toBeInTheDocument();
        expect(screen.getByText('Prior Year Mode')).toBeInTheDocument();
    });
});

describe('AssumptionTab withdrawal-rate controls', () => {
    it('shows the Rate mode control for Guyton Klinger only', () => {
        renderTab({ withdrawalStrategy: 'Guyton Klinger' });
        expect(screen.getByText('Rate mode')).toBeInTheDocument();
    });

    it('shows a plain rate input (no Rate mode control) for Fixed Real', () => {
        renderTab({ withdrawalStrategy: 'Fixed Real' });
        expect(screen.queryByText('Rate mode')).not.toBeInTheDocument();
        expect(screen.getByText('Withdrawal Rate (%)')).toBeInTheDocument();
    });

    it('in Auto mode hides the rate input and shows the engine-derived rate', () => {
        vi.mocked(getAutoRate).mockReturnValue(4.7);
        renderTab({ withdrawalStrategy: 'Guyton Klinger', withdrawalRateMode: 'auto' });
        expect(screen.queryByText('Withdrawal Rate (%)')).not.toBeInTheDocument();
        expect(screen.getByText('Auto — currently 4.7%')).toBeInTheDocument();
    });

    it('in Auto mode falls back to a "computed on next run" line when no rate is derivable', () => {
        renderTab({ withdrawalStrategy: 'Guyton Klinger', withdrawalRateMode: 'auto' });
        expect(screen.getByText('Auto — computed on next run')).toBeInTheDocument();
    });

    it('in Manual mode shows the rate input and the drift banner with its apply button', () => {
        vi.mocked(computeGKRateSuggestion).mockReturnValue({
            direction: 'raise',
            configuredRate: 4,
            impliedRate: 5.23,
            suggestedRate: 5.3,
            plannedSpending: 53000,
            portfolioAtRetirement: 1000000,
        });
        const { dispatch } = renderTab({ withdrawalStrategy: 'Guyton Klinger', withdrawalRateMode: 'manual' });

        expect(screen.getByText('Withdrawal Rate (%)')).toBeInTheDocument();
        expect(screen.getByText('Your spending implies a higher initial rate')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Set rate to 5.3%'));
        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_INVESTMENTS',
            payload: { withdrawalRate: 5.3 },
        });
    });

    it('dispatches the rate mode when toggled', () => {
        const { dispatch } = renderTab({ withdrawalStrategy: 'Guyton Klinger', withdrawalRateMode: 'auto' });
        fireEvent.click(screen.getByRole('button', { name: 'Manual' }));
        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_INVESTMENTS',
            payload: { withdrawalRateMode: 'manual' },
        });
    });

    it('switching strategy dispatches only the strategy — no auto-seeded rate', () => {
        const { dispatch } = renderTab({ withdrawalStrategy: 'None' });
        fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: 'Guyton Klinger' } });
        // Exactly one dispatch, whose payload carries ONLY withdrawalStrategy —
        // the old #37 auto-seed bundled a withdrawalRate in; auto mode supersedes it.
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_INVESTMENTS',
            payload: { withdrawalStrategy: 'Guyton Klinger' },
        });
    });
});
