import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PriorityTab from '../../../tabs/Future/PriorityTab';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import {
    AssumptionsContext,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { PassiveIncome } from '../../../components/Objects/Income/models';
import { CustomMilestone } from '../../../services/simulation/types';

// #145: a milestone-started income must NOT count toward "today's" take-home until
// its start milestone has actually fired. Before the fix, an income gated only by a
// milestone (no fixed start date) was counted immediately, inflating the Allocation
// tab's take-home by income that won't start for years. PriorityTab now gates the
// income sum on whether the start milestone is reached AS OF TODAY (evaluated with
// the engine's own evaluateAllMilestones against the current year/age/accounts).

const BIRTH_YEAR = 1985;

// The "Monthly Take-Home" summary renders the gross figure in the span immediately
// before the "gross" label.
function grossValue(): string | null | undefined {
    return screen.getByText('gross').previousElementSibling?.textContent;
}

function yearMilestone(id: string, year: number): CustomMilestone {
    return { id, name: id, conditions: [{ type: 'YEAR', operator: '>=', value: year }] };
}

function renderWith(milestoneFireYear: number) {
    const state = {
        ...defaultAssumptions,
        milestones: [...createBuiltinMilestones(BIRTH_YEAR, 65, 95), yearMilestone('M', milestoneFireYear)],
    };
    // Past start date so the date window passes — the MILESTONE 'M' is the gate.
    const incomes = [new PassiveIncome('p1', 'Milestone Job', 10000, 'Monthly', 'No', 'Other',
        new Date(2020, 0, 1), undefined, false, 'M')];
    return render(
        <AssumptionsContext.Provider value={{ state, dispatch: vi.fn() }}>
            <IncomeContext.Provider value={{ incomes }}>
                <ExpenseContext.Provider value={{ expenses: [] }}>
                    <PriorityTab />
                </ExpenseContext.Provider>
            </IncomeContext.Provider>
        </AssumptionsContext.Provider>
    );
}

describe('PriorityTab milestone-started income (#145)', () => {
    it('excludes the income while its start milestone is unreached (fires in the future)', () => {
        renderWith(2999); // YEAR >= 2999 — not reached today
        expect(grossValue()).toBe('$0');
    });

    it('includes the income once its start milestone is already reached', () => {
        renderWith(2000); // YEAR >= 2000 — reached today
        expect(grossValue()).not.toBe('$0');
    });
});
