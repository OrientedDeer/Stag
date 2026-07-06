/**
 * #189: dragging to reorder the withdrawal buckets toasted "projection updated"
 * but never recalculated — it only dispatched SET_WITHDRAWAL_STRATEGY, leaving
 * the SimulationContext (and the per-bucket timeline chips) stale until a Future
 * tab visit. With Tax Opt OFF (the only mode where the literal order matters) the
 * projection silently disagreed with the shown order.
 *
 * Fixed: onDragEnd now mirrors onAutoSort — build the projection, then dispatch
 * BOTH the new order and SET_SIMULATION_WITH_HASH.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

// Capture @hello-pangea/dnd's onDragEnd so the test can fire a drop directly
// (jsdom can't perform a real pointer drag).
let capturedOnDragEnd: ((result: unknown) => void) | undefined;
vi.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: (r: unknown) => void }) => {
        capturedOnDragEnd = onDragEnd;
        return <div>{children}</div>;
    },
    Droppable: ({ children }: { children: (p: unknown) => React.ReactNode }) =>
        <>{children({ droppableProps: {}, innerRef: () => {}, placeholder: null })}</>,
    Draggable: ({ children }: { children: (p: unknown, s: unknown) => React.ReactNode }) =>
        <>{children({ draggableProps: {}, dragHandleProps: {}, innerRef: () => {} }, {})}</>,
}));

// Keep the "recalc" cheap and deterministic — no engine run. `vi.hoisted` lets the
// hoisted vi.mock factory reference this sentinel safely.
const { builtSim } = vi.hoisted(() => ({ builtSim: [{ year: 2026 }] as unknown[] }));
vi.mock('../../../../tabs/Future/buildProjection', () => ({
    buildProjectionAsync: vi.fn().mockResolvedValue(builtSim),
}));

import WithdrawalTab from '../../../../tabs/Future/WithdrawalTab';
import { AssumptionsContext, defaultAssumptions, createBuiltinMilestones } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { AccountContext } from '../../../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../../components/Objects/Expense/ExpenseContext';
import { TaxContext, defaultTaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { SimulationContext } from '../../../../components/Objects/Assumptions/SimulationContext';
import { InvestedAccount } from '../../../../components/Objects/Accounts/models';

beforeEach(() => { capturedOnDragEnd = undefined; });

describe('WithdrawalTab drag-reorder recalculates the projection (#189)', () => {
    it('dispatches BOTH the new order and a simulation update after a drop', async () => {
        const assumptionsDispatch = vi.fn();
        const simulationDispatch = vi.fn();

        const state = {
            ...defaultAssumptions,
            milestones: createBuiltinMilestones(1980, 65, 90),
            investments: { ...defaultAssumptions.investments, taxOptimizationEnabled: false },
            withdrawalStrategy: [
                { id: 'ws-a', name: 'A', accountId: 'a1' },
                { id: 'ws-b', name: 'B', accountId: 'a2' },
            ],
        };
        const accounts = [
            new InvestedAccount('a1', 'A', 100000, 0, 5, 0.1, 'Traditional IRA', true, 1.0, 100000),
            new InvestedAccount('a2', 'B', 100000, 0, 5, 0.1, 'Roth IRA', true, 1.0, 100000),
        ];

        render(
            <AssumptionsContext.Provider value={{ state, dispatch: assumptionsDispatch } as never}>
                <AccountContext.Provider value={{ accounts } as never}>
                    <IncomeContext.Provider value={{ incomes: [] } as never}>
                        <ExpenseContext.Provider value={{ expenses: [] } as never}>
                            <TaxContext.Provider value={{ state: defaultTaxState, dispatch: () => null } as never}>
                                <SimulationContext.Provider value={{ simulation: [], dispatch: simulationDispatch } as never}>
                                    <WithdrawalTab />
                                </SimulationContext.Provider>
                            </TaxContext.Provider>
                        </ExpenseContext.Provider>
                    </IncomeContext.Provider>
                </AccountContext.Provider>
            </AssumptionsContext.Provider>
        );

        expect(capturedOnDragEnd).toBeTypeOf('function');

        // Drag bucket 0 below bucket 1.
        await act(async () => {
            capturedOnDragEnd!({ source: { index: 0 }, destination: { index: 1 } });
            // let the buildSimulation promise resolve
            await Promise.resolve();
            await Promise.resolve();
        });

        // The order was committed…
        const orderCall = assumptionsDispatch.mock.calls.find(c => c[0]?.type === 'SET_WITHDRAWAL_STRATEGY');
        expect(orderCall).toBeTruthy();
        expect(orderCall![0].payload.map((b: { accountId: string }) => b.accountId)).toEqual(['a2', 'a1']);

        // …AND the projection was recalculated (the bug: this never fired).
        const simCall = simulationDispatch.mock.calls.find(c => c[0]?.type === 'SET_SIMULATION_WITH_HASH');
        expect(simCall).toBeTruthy();
        expect(simCall![0].payload.simulation).toBe(builtSim);
    });
});
