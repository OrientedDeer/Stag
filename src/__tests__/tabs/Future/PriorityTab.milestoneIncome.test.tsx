import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PriorityTab from '../../../tabs/Future/PriorityTab';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { SimulationContext } from '../../../components/Objects/Assumptions/SimulationContext';
import {
    AssumptionsContext,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { PassiveIncome } from '../../../components/Objects/Income/models';
import { CustomMilestone, SimulationYear } from '../../../services/simulation/types';

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

// #2 (review of #152): an income gated on a RELATIVE milestone ("N years after X",
// valueType MILESTONE_PLUS) must still count today when that milestone has fired.
// A from-scratch today-evaluation has no milestone history, so MILESTONE_PLUS can't
// resolve — useTodayMilestoneSet feeds it the engine's per-milestone reach years out
// of the SimulationContext timeline (milestoneEvents) so it resolves correctly.
describe('PriorityTab relative (MILESTONE_PLUS) milestone income (#152 review #2)', () => {
    const REF_REACH_YEAR = 2015; // when the engine recorded the reference milestone firing

    // M_plus = "2 years after M_ref" (YEAR metric). M_ref itself has an unsatisfiable
    // FIXED condition today so ONLY the sim-provided reach year can resolve M_plus.
    function milestones(): CustomMilestone[] {
        return [
            ...createBuiltinMilestones(BIRTH_YEAR, 65, 95),
            { id: 'M_ref', name: 'Reference', conditions: [{ type: 'YEAR', operator: '>=', value: 9999 }] },
            {
                id: 'M_plus',
                name: 'Two Years After Reference',
                conditions: [{ type: 'YEAR', operator: '>=', value: 2, valueType: 'MILESTONE_PLUS', referenceMilestoneId: 'M_ref' }],
            },
        ];
    }

    function renderWithSim(simulation: SimulationYear[]) {
        const state = { ...defaultAssumptions, milestones: milestones() };
        const incomes = [new PassiveIncome('p1', 'Relative Job', 10000, 'Monthly', 'No', 'Other',
            new Date(2020, 0, 1), undefined, false, 'M_plus')];
        return render(
            <AssumptionsContext.Provider value={{ state, dispatch: vi.fn() }}>
                <IncomeContext.Provider value={{ incomes }}>
                    <ExpenseContext.Provider value={{ expenses: [] }}>
                        <SimulationContext.Provider value={{ simulation, dispatch: vi.fn(), inputHash: '' }}>
                            <PriorityTab />
                        </SimulationContext.Provider>
                    </ExpenseContext.Provider>
                </IncomeContext.Provider>
            </AssumptionsContext.Provider>
        );
    }

    it('counts the income: the sim supplies the reference reach year so M+2 resolves as reached', () => {
        const simulation = [{
            year: REF_REACH_YEAR,
            milestoneEvents: [{ milestoneId: 'M_ref', yearReached: REF_REACH_YEAR, ageReached: 30 }],
        } as unknown as SimulationYear];
        renderWithSim(simulation);
        // M_ref reached 2015 → M_plus target 2017 → today (>2017) → income active.
        expect(grossValue()).not.toBe('$0');
    });

    it('without sim reach-year data the relative milestone cannot resolve (degrades to hidden, not a crash)', () => {
        renderWithSim([]); // empty timeline → no milestoneEvents → MILESTONE_PLUS stays null
        expect(grossValue()).toBe('$0');
    });
});
