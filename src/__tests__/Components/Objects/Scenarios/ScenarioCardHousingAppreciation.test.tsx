/**
 * Regression test for #203: the ScenarioCard "Housing Appreciation" control must
 * write the assumptions path the simulation actually reads.
 *
 * The control historically wrote a phantom `macro.housingAppreciation` field, but
 * the engine reads `assumptions.expenses.housingAppreciation` (see
 * PropertyAccount.increment / MortgageExpense.increment). `migrateAssumptions` —
 * the shared reconstitution boundary every scenario run funnels through — only
 * copies keys that exist under `defaults.macro`, and `housingAppreciation` is not
 * one, so an edit made through the control was silently dropped and the scenario
 * ran with the base plan's housing appreciation regardless.
 *
 * This test drives the REAL control (renders ScenarioCard, opens the modal, edits
 * the input, saves) and asserts the saved blob survives migrateAssumptions into
 * the field the engine consumes — then that a projected home value reflects it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ScenarioCard } from '../../../../components/Objects/Scenarios/ScenarioCard';
import { SavedScenario } from '../../../../services/ScenarioTypes';
import {
    AssumptionsState,
    defaultAssumptions,
    migrateAssumptions,
} from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { PropertyAccount } from '../../../../components/Objects/Accounts/models';

const makeScenario = (assumptions: AssumptionsState): SavedScenario => ({
    metadata: {
        id: 'sc-1',
        name: 'Housing test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    inputs: {
        accounts: [],
        incomes: [],
        expenses: [],
        // taxSettings is not exercised here; the control only edits assumptions.
        taxSettings: {} as never,
        assumptions,
    },
    version: '1.0.0',
});

describe('#203 ScenarioCard housing appreciation writes the engine-read path', () => {
    it('edit survives migrateAssumptions and changes the projected home value', () => {
        // Base plan: a modest, known housing-appreciation rate. Turn off
        // inflation-adjustment so the projected value is purely appreciation-driven.
        const base: AssumptionsState = {
            ...defaultAssumptions,
            expenses: { ...defaultAssumptions.expenses, housingAppreciation: 1.4 },
            macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
        };
        const scenario = makeScenario(base);

        const onUpdateAssumptions = vi.fn();

        render(
            <ScenarioCard
                scenario={scenario}
                isBaseline={false}
                isComparison={false}
                onSelectBaseline={() => {}}
                onSelectComparison={() => {}}
                onDelete={() => {}}
                onExport={() => {}}
                onRename={() => {}}
                onUpdateAssumptions={onUpdateAssumptions}
            />
        );

        // Open the assumptions modal.
        fireEvent.click(screen.getByText('Edit'));

        // Drive the REAL control: the input next to the "Housing Appreciation (%)"
        // label. Bump appreciation well clear of the base 1.4%.
        const label = screen.getByText('Housing Appreciation (%)');
        const input = label.nextElementSibling as HTMLInputElement;
        expect(input).toBeInstanceOf(HTMLInputElement);
        fireEvent.change(input, { target: { value: '10' } });

        // Save — this is exactly what ScenarioManager wires to updateScenarioAssumptions.
        fireEvent.click(screen.getByText('Save Changes'));

        expect(onUpdateAssumptions).toHaveBeenCalledTimes(1);
        const savedBlob = onUpdateAssumptions.mock.calls[0][0];

        // The simulation runs the saved blob through migrateAssumptions. Assert the
        // engine-consumed field carries the edit.
        const migrated = migrateAssumptions(savedBlob, defaultAssumptions);
        expect(migrated.expenses.housingAppreciation).toBe(10);

        // And the projection differs: the home appreciates faster than base.
        const home = new PropertyAccount('h1', 'Home', 500_000, 'Owned', 0, 0, '');
        const baseValue = home.increment(base).amount;
        const editedValue = home.increment(migrated).amount;
        expect(editedValue).toBeGreaterThan(baseValue);
        expect(editedValue).toBeCloseTo(500_000 * 1.1, 6);
    });
});
