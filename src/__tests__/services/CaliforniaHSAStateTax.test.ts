import { describe, it, expect } from 'vitest';
import { type TaxState } from '../../components/Objects/Taxes/TaxContext';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { calculateStateTax } from '../../components/Objects/Taxes/TaxService';
import { WorkIncome } from '../../components/Objects/Income/models';
import { InvestedAccount } from '../../components/Objects/Accounts/models';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';

// California does not conform to IRC §223: payroll HSA contributions stay in CA
// wages and no HSA deduction is allowed (FTB Pub 1001; Schedule CA (540) adds
// them back). Other modeled states (DC/VA/NC) conform and exclude them.

const taxState = (stateResidency: string): TaxState => ({
    filingStatus: 'Single',
    stateResidency,
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: 2025,
});

const noInflation: AssumptionsState = {
    ...defaultAssumptions,
    macro: { ...defaultAssumptions.macro, inflationAdjusted: false, inflationRate: 0 },
};

const job = (hsa: number) =>
    new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
        new Date(2020, 0, 1), undefined, hsa);

describe('California state tax ignores payroll HSA contributions', () => {
    it('calculateStateTax: CA tax is unchanged by an HSA payroll contribution', () => {
        const withHSA = calculateStateTax(taxState('California'), [job(4000)], [], 2025, noInflation);
        const withoutHSA = calculateStateTax(taxState('California'), [job(0)], [], 2025, noInflation);
        expect(withHSA).toBeCloseTo(withoutHSA, 2);
    });

    it('calculateStateTax: a conforming state (DC) still excludes HSA contributions', () => {
        const withHSA = calculateStateTax(taxState('DC'), [job(4000)], [], 2025, noInflation);
        const withoutHSA = calculateStateTax(taxState('DC'), [job(0)], [], 2025, noInflation);
        expect(withoutHSA - withHSA).toBeGreaterThan(200);
    });

    it('simulation: a CA worker\'s state tax is unchanged by HSA contributions', () => {
        const currentYear = new Date().getFullYear();
        const assumptions: AssumptionsState = {
            ...noInflation,
            milestones: createBuiltinMilestones(currentYear - 40, 65, 90),
        };
        const run = (hsa: number) => runSimulation(
            2,
            [new InvestedAccount('hsa1', 'HSA', 10000, 0, 0, 0, 'HSA')],
            [job(hsa)],
            [],
            assumptions,
            taxState('California'),
        );
        const withHSA = run(4000);
        const withoutHSA = run(0);
        for (let i = 0; i < 2; i++) {
            expect(withHSA[i].taxDetails.state).toBeCloseTo(withoutHSA[i].taxDetails.state, 0);
            // Federal still excludes HSA (§106/§223), so federal tax drops (year 0 is a partial year).
            expect(withoutHSA[i].taxDetails.fed - withHSA[i].taxDetails.fed).toBeGreaterThan(50);
        }
    });
});
