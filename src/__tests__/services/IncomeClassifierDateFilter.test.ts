/**
 * Tests for IncomeClassifier date filtering fix.
 * Verifies that incomes outside their active date range return $0.
 */
import { describe, it, expect } from 'vitest';
import { classifyIncome } from '../../services/simulation/IncomeClassifier';
import { WorkIncome } from '../../components/Objects/Income/models';

describe('IncomeClassifier date filtering', () => {
    it('should return $0 for income that ended before simulation year', () => {
        // Income ended in 2030, simulation year is 2035
        const endedIncome = new WorkIncome(
            'test-1', 'Ended Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date('2020-01-01'),  // start
            new Date('2030-12-31')   // end
        );

        const result = classifyIncome([endedIncome], 0, 0, 2035);
        
        expect(result.classified.spendable).toBe(0);
        expect(result.classified.breakdown.wages).toBe(0);
    });

    it('should return $0 for income that starts after simulation year', () => {
        // Income starts in 2040, simulation year is 2035
        const futureIncome = new WorkIncome(
            'test-2', 'Future Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date('2040-01-01'),  // start (future)
            undefined                 // no end
        );

        const result = classifyIncome([futureIncome], 0, 0, 2035);
        
        expect(result.classified.spendable).toBe(0);
        expect(result.classified.breakdown.wages).toBe(0);
    });

    it('should return full amount for active income', () => {
        // Income active from 2020-2040, simulation year is 2035
        const activeIncome = new WorkIncome(
            'test-3', 'Active Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date('2020-01-01'),  // start (past)
            new Date('2040-12-31')   // end (future)
        );

        const result = classifyIncome([activeIncome], 0, 0, 2035);
        
        expect(result.classified.spendable).toBe(100000);
        expect(result.classified.breakdown.wages).toBe(100000);
    });

    it('should prorate income that starts mid-year', () => {
        // Income starts July 1, 2035
        const midYearIncome = new WorkIncome(
            'test-4', 'Mid-Year Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date('2035-07-01'),  // start mid-year (month index 6)
            undefined                 // no end
        );

        const result = classifyIncome([midYearIncome], 0, 0, 2035);

        // July (index 6) through December (index 11) = 6 months = 6/12 = 50%
        expect(result.classified.spendable).toBeCloseTo(50000, 0);
    });
});
