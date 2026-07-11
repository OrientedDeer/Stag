/**
 * #183 — a saved-scenario comparison must simulate the SCENARIO'S OWN horizon
 * (lifeExpectancy − currentAge), not a hardcoded 50 years.
 *
 * The Current Plan simulates the full horizon (54 yrs on the default demo data,
 * up to 60 for a young saver). The scenario leg used to run a fixed 50 years, so
 * for any plan whose natural horizon exceeds 50 the scenario timeline was cut
 * short and `compareScenarios` back-filled the missing tail years with `?? 0` —
 * a fake $0-net-worth collapse in the final plan years, and a legacyValue read
 * off the wrong (earlier) age.
 *
 * These tests exercise the REAL ScenarioService + engine (no mocks) end-to-end
 * through ScenarioProvider.runComparison and assert the comparison timeline
 * spans the same years as the Current Plan with no zero-filled tail. A second
 * test pins the migrateAssumptions routing (LOW finding): a legacy scenario blob
 * (old demographics.{birthYear,lifeExpectancy}, no milestones array) is honored
 * because the merge now funnels through migrateAssumptions, which synthesizes
 * the built-in milestones the horizon derivation reads.
 */
import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext, type ContextType } from 'react';

import { ScenarioContext } from '../../components/Objects/Scenarios/ScenarioContext';
import { ScenarioProvider } from '../../components/Objects/Scenarios/ScenarioProvider';
import type { SavedScenario } from '../../services/ScenarioTypes';
import { AnyAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { AnyExpense, FoodExpense } from '../../components/Objects/Expense/models';
import {
    AssumptionsState, defaultAssumptions, createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import type { SimulationYear } from '../../services/simulation/types';

const NOW = new Date().getFullYear();

// A young saver: 30 now, plan to 90 → a 60-year natural horizon, comfortably
// past the old hardcoded 50. Large cash + small draw keeps net worth positive
// across the whole span so a legitimate depletion can't masquerade as the tail
// artifact.
const BIRTH_YEAR = NOW - 30;
const LIFE_EXPECTANCY = 90; // 60-year natural horizon, comfortably past the old hardcoded 50

const taxState: TaxState = {
    filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
    fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW,
};

const longHorizonAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(BIRTH_YEAR, 65, LIFE_EXPECTANCY),
    investments: {
        ...defaultAssumptions.investments,
        taxOptimizationEnabled: false, // sync leg — no worker needed in jsdom
    },
};

const makeAccounts = (): AnyAccount[] => [new SavedAccount('cash', 'Cash', 2_000_000, 2)];
const makeExpenses = (): AnyExpense[] => [new FoodExpense('exp', 'Living', 20_000, 'Annually', new Date(NOW, 0, 1))];

/** The Current Plan timeline: run the engine on the same inputs with a horizon
 *  larger than the natural span; the engine's own life-expectancy cap trims it
 *  to the plan's natural length. */
const makeCurrentPlanSimulation = (assumptions: AssumptionsState = longHorizonAssumptions): SimulationYear[] =>
    runSimulationWithOptimization(
        200, makeAccounts(), [], makeExpenses(), assumptions, taxState,
    );

const makeSavedScenario = (id: string, assumptions: AssumptionsState): SavedScenario => ({
    metadata: {
        id, name: `Scenario ${id}`,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Persisted shape: instances → className stamp → JSON round trip.
    inputs: JSON.parse(JSON.stringify({
        accounts: makeAccounts(),
        incomes: [],
        expenses: makeExpenses(),
        taxSettings: taxState,
        assumptions,
    })),
    version: '1.0.0',
});

type Captured = ContextType<typeof ScenarioContext>;

function renderProvider(): Captured {
    const captured = {} as Captured;
    const TestComponent = () => {
        Object.assign(captured, useContext(ScenarioContext));
        return null;
    };
    render(
        <ScenarioProvider>
            <TestComponent />
        </ScenarioProvider>
    );
    return captured;
}

describe('#183 saved-scenario comparison horizon', () => {
    it('simulates the scenario\'s own horizon (not 50) so the comparison has no zero-filled tail', async () => {
        const currentPlan = makeCurrentPlanSimulation();
        // The Current Plan runs its full natural horizon — well past the old
        // hardcoded 50-year (≈51-row) scenario cap.
        expect(currentPlan.length).toBeGreaterThan(51);

        const captured = renderProvider();
        const scenario = makeSavedScenario('long-1', longHorizonAssumptions);
        act(() => {
            captured.dispatch({ type: 'LOAD_SCENARIOS', payload: [scenario] });
        });

        await act(async () => {
            await captured.runComparison('current', 'long-1', currentPlan, longHorizonAssumptions, taxState);
        });

        expect(captured.state.error).toBeNull();
        expect(captured.state.comparisonResult).not.toBeNull();

        const result = captured.state.comparisonResult!;
        const scenarioSim = result.comparison.simulation;

        // The scenario leg ran the FULL horizon — before the fix it was capped at
        // 50 (→ 51 rows) and this length was short.
        expect(scenarioSim.length).toBeGreaterThan(51);
        expect(scenarioSim.length).toBe(result.baseline.simulation.length);

        // No zero-filled tail: no year where the Current Plan (baseline) has net
        // worth but the scenario (comparison) reads a fabricated $0. Before the
        // fix the final ~10 years all tripped this.
        const artifactYears = result.differences.netWorthByYear.filter(
            y => y.comparison === 0 && y.baseline !== 0
        );
        expect(artifactYears).toEqual([]);

        // Both legs cover the same final year — legacyValue is read at the same age.
        const lastBaselineYear = result.baseline.simulation[result.baseline.simulation.length - 1].year;
        const lastScenarioYear = scenarioSim[scenarioSim.length - 1].year;
        expect(lastScenarioYear).toBe(lastBaselineYear);
    });

    it('routes a legacy scenario blob through migrateAssumptions (old demographics, no milestones array)', async () => {
        // A pre-milestones save: life expectancy lived on demographics and there
        // was no milestones array. The old hand-rolled merge left milestones
        // undefined (and ignored demographics.lifeExpectancy); migrateAssumptions
        // synthesizes the End-of-Plan milestone from the legacy value, so the
        // horizon is honored.
        const LEGACY_LIFE = 88; // 58-year horizon for a 30-year-old
        const legacyAssumptionsBlob = {
            ...defaultAssumptions,
            investments: { ...defaultAssumptions.investments, taxOptimizationEnabled: false },
            demographics: { birthYear: BIRTH_YEAR, retirementAge: 65, lifeExpectancy: LEGACY_LIFE },
        } as unknown as AssumptionsState;
        // Drop the milestones array to emulate the legacy persisted shape.
        const scenario = makeSavedScenario('legacy-1', legacyAssumptionsBlob);
        delete (scenario.inputs.assumptions as Record<string, unknown>).milestones;

        const currentPlan = makeCurrentPlanSimulation();
        const captured = renderProvider();
        act(() => {
            captured.dispatch({ type: 'LOAD_SCENARIOS', payload: [scenario] });
        });

        await act(async () => {
            await captured.runComparison('current', 'legacy-1', currentPlan, longHorizonAssumptions, taxState);
        });

        expect(captured.state.error).toBeNull();
        const scenarioSim = captured.state.comparisonResult!.comparison.simulation;

        // Expected length: the same engine run at the legacy life expectancy.
        const legacyReference = makeCurrentPlanSimulation({
            ...longHorizonAssumptions,
            milestones: createBuiltinMilestones(BIRTH_YEAR, 65, LEGACY_LIFE),
        });
        // Horizon derived from the legacy lifeExpectancy (shorter than the 90
        // plan), not the hardcoded 50, and no crash on the absent milestones array.
        expect(scenarioSim.length).toBe(legacyReference.length);
        expect(scenarioSim.length).toBeLessThan(currentPlan.length); // 88 < 90
        expect(scenarioSim.length).toBeGreaterThan(51);
    });
});
