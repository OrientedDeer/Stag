/**
 * High-3 is the average of annual RATES of basic pay (5 U.S.C. §8331(4)), not the
 * dollars paid in a calendar year. A federal employee who separates mid-year must
 * not have that half-paid final year averaged in at half value.
 */
import { describe, it, expect } from 'vitest';
import { projectIncomes } from '../../../services/simulation/IncomeProjection';
import { WorkIncome, FERSPensionIncome, CSRSPensionIncome, type AnyIncome } from '../../../components/Objects/Income/models';
import { defaultAssumptions, createBuiltinMilestones, type AssumptionsState } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type SimulationYear } from '../../../services/simulation/types';

const BIRTH_YEAR = 1970;

function assumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 90),
    };
}

function fedJob(salary: number, pensionSystem: 'FERS' | 'CSRS', startDate: Date, endDate?: Date): WorkIncome {
    return new WorkIncome(
        'work1', 'Fed Job', salary, 'Annually', 'Yes',
        0, 0, 0, 0, '',
        null, 'FIXED',
        startDate, endDate,
        0, 'custom', 'NONE', 0, 15, true, 6, null, 7,
        'NONE', 0, 'quarterly', 7, null, 37,
        pensionSystem,
    );
}

function simYear(year: number, incomes: AnyIncome[]): SimulationYear {
    return { year, incomes } as unknown as SimulationYear;
}

describe('FERS/CSRS High-3 uses annual pay rate, not prorated pay', () => {
    const start = new Date(2000, 0, 1);
    const separation = new Date(2030, 5, 30); // separates June 30 of the retirement year

    it('FERS: a mid-year separation year counts at its full annual rate', () => {
        const job = fedJob(100000, 'FERS', start, separation);
        const fers = new FERSPensionIncome(
            'fers1', 'FERS', 30, 0, 60, BIRTH_YEAR, 0, 0, 0,
            undefined, undefined, true, 'work1',
        );
        const history = [simYear(2028, [job]), simYear(2029, [job])];

        const result = projectIncomes(2030, [job, fers], [], assumptions(), history, 60, false, []);
        const updated = result.nextIncomes.find(i => i.id === 'fers1') as FERSPensionIncome;

        expect(updated.high3Salary).toBeCloseTo(100000, 0);
        // 30 yrs × $100k × 1% (age 60, not 62+)
        expect(updated.calculatedBenefit).toBeCloseTo(30000, 0);
    });

    it('FERS: a mid-year hire year in the history counts at its full annual rate', () => {
        const job = fedJob(100000, 'FERS', new Date(2028, 6, 1));
        const fers = new FERSPensionIncome(
            'fers1', 'FERS', 30, 0, 60, BIRTH_YEAR, 0, 0, 0,
            undefined, undefined, true, 'work1',
        );
        const history = [simYear(2028, [job]), simYear(2029, [job])];

        const result = projectIncomes(2030, [fers], [], assumptions(), history, 60, true, []);
        const updated = result.nextIncomes.find(i => i.id === 'fers1') as FERSPensionIncome;

        expect(updated.high3Salary).toBeCloseTo(100000, 0);
    });

    it('CSRS: a mid-year separation year counts at its full annual rate', () => {
        const job = fedJob(100000, 'CSRS', start, separation);
        const csrs = new CSRSPensionIncome(
            'csrs1', 'CSRS', 30, 0, 60, 0,
            undefined, undefined, true, 'work1',
        );
        const history = [simYear(2028, [job]), simYear(2029, [job])];

        const result = projectIncomes(2030, [job, csrs], [], assumptions(), history, 60, false, []);
        const updated = result.nextIncomes.find(i => i.id === 'csrs1') as CSRSPensionIncome;

        expect(updated.high3Salary).toBeCloseTo(100000, 0);
    });
});
