import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PriorityTab from '../../../tabs/Future/PriorityTab';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { SimulationContext } from '../../../components/Objects/Assumptions/SimulationContext';
import { PassiveIncome } from '../../../components/Objects/Income/models';

// #145: a milestone-started income must NOT count toward "today's" take-home until
// its start milestone has actually fired. Before the fix, an income gated only by a
// milestone (no fixed start date) was treated as active immediately, inflating the
// Allocation tab's take-home by income that won't start for years. PriorityTab now
// gates the income sum on the simulation's first-year reached-milestone set.

// The "Monthly Take-Home" summary renders the gross figure in the span immediately
// before the "gross" label.
function grossValue(): string | null | undefined {
    return screen.getByText('gross').previousElementSibling?.textContent;
}

const MILESTONE = 'm-future';

// Past start date so the date-window check passes — the MILESTONE is the gate under
// test. (The user's exact config omits the start date entirely; the milestone gate
// behaves identically — an unreached milestone still excludes the income.)
const milestoneIncome = () => [
    new PassiveIncome('p1', 'Milestone Job', 10000, 'Monthly', 'No', 'Other',
        new Date(2020, 0, 1), undefined, false, MILESTONE),
];

describe('PriorityTab milestone-started income (#145)', () => {
    it('excludes a milestone-started income from take-home before the milestone fires', () => {
        render(
            <IncomeContext.Provider value={{ incomes: milestoneIncome() }}>
                <ExpenseContext.Provider value={{ expenses: [] }}>
                    <PriorityTab />
                </ExpenseContext.Provider>
            </IncomeContext.Provider>
        );
        // No simulation results → empty reached-milestone set → income is not yet active.
        expect(grossValue()).toBe('$0');
    });

    it('includes the income once its start milestone is reached', () => {
        // simulation[0].activeMilestones is the engine's "reached as of today" set.
        const simulation = [{ activeMilestones: [MILESTONE] }] as never;
        render(
            <SimulationContext.Provider value={{ simulation, inputHash: null, dispatch: vi.fn() }}>
                <IncomeContext.Provider value={{ incomes: milestoneIncome() }}>
                    <ExpenseContext.Provider value={{ expenses: [] }}>
                        <PriorityTab />
                    </ExpenseContext.Provider>
                </IncomeContext.Provider>
            </SimulationContext.Provider>
        );
        // Milestone reached → income counts → gross take-home is non-zero.
        expect(grossValue()).not.toBe('$0');
    });
});
