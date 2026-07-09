import { describe, it, expect } from 'vitest';
import {
    planHorizonYears,
    getLifeExpectancy,
    createBuiltinMilestones,
    defaultAssumptions,
    type AssumptionsState,
} from '../../components/Objects/Assumptions/AssumptionsContext';

/**
 * Characterization tests pinning the single-source plan-horizon helper
 * (#183). buildProjection (Future/Withdrawal tabs) and ScenarioContext's
 * scenario-comparison run BOTH derive their `yearsToRun` from this helper, so
 * the current plan and a scenario can't drift to mismatched horizons.
 */
describe('planHorizonYears', () => {
    const assumptionsWithLifeExpectancy = (lifeExpectancy: number): AssumptionsState => ({
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(1990, 65, lifeExpectancy),
    });

    it('returns life-expectancy age minus current age', () => {
        const assumptions = assumptionsWithLifeExpectancy(90);
        // Sanity: the milestone really carries the life expectancy we set.
        expect(getLifeExpectancy(assumptions.milestones)).toBe(90);
        expect(planHorizonYears(assumptions, 40)).toBe(50);
    });

    it('floors at 1 year when the horizon has already passed', () => {
        const assumptions = assumptionsWithLifeExpectancy(90);
        // currentAge past life expectancy → 90 - 95 = -5, floored to 1.
        expect(planHorizonYears(assumptions, 95)).toBe(1);
        // Exactly at life expectancy → 90 - 90 = 0, floored to 1.
        expect(planHorizonYears(assumptions, 90)).toBe(1);
    });

    it('matches the raw formula it consolidates for arbitrary inputs', () => {
        const cases: Array<[number, number]> = [
            [85, 30],
            [90, 65],
            [100, 55],
            [70, 71],
        ];
        for (const [lifeExpectancy, currentAge] of cases) {
            const assumptions = assumptionsWithLifeExpectancy(lifeExpectancy);
            const expected = Math.max(1, lifeExpectancy - currentAge);
            expect(planHorizonYears(assumptions, currentAge)).toBe(expected);
        }
    });
});
