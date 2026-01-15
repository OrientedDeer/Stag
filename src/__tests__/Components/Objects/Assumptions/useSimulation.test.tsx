import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../../../components/Objects/Assumptions/useSimulation';
import { AssumptionsState, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { SavedAccount, InvestedAccount } from '../../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../../components/Objects/Income/models';
import { FoodExpense } from '../../../../components/Objects/Expense/models';

// Base test assumptions
const baseAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {
        startAge: 30,
        startYear: 2025,
        lifeExpectancy: 90,
        retirementAge: 65
    },
    macro: {
        ...defaultAssumptions.macro,
        inflationRate: 0,
        inflationAdjusted: false
    },
    investments: {
        ...defaultAssumptions.investments,
        returnRates: { ror: 10 }
    },
    income: {
        ...defaultAssumptions.income,
        salaryGrowth: 0
    }
};

const baseTaxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'Texas', // No state tax
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: 2025
};

describe('useSimulation - runSimulation', () => {
    describe('Year 0 Baseline', () => {
        it('should create Year 0 with current input data', () => {
            const accounts = [new SavedAccount('sav-1', 'Savings', 10000, 2.5)];
            const incomes = [
                new WorkIncome(
                    'inc-1', 'Job', 100000, 'Annually', 'Yes',
                    0, 0, 0, 0, '', null, 'FIXED',
                    new Date('2020-01-01'), // startDate - active before 2025
                    new Date('2030-12-31')  // endDate - active through simulation
                )
            ];
            const expenses = [new FoodExpense('exp-1', 'Food', 24000, 'Annually', new Date('2025-01-01'))];

            const result = runSimulation(5, accounts, incomes, expenses, baseAssumptions, baseTaxState);

            // Year 0 should exist
            expect(result[0]).toBeDefined();
            expect(result[0].year).toBe(2025);

            // Year 0 should have the original inputs
            expect(result[0].accounts[0].amount).toBe(10000);
            expect(result[0].incomes[0].amount).toBe(100000);
            expect(result[0].expenses[0].amount).toBe(24000);

            // Year 0 cashflow should reflect input data
            expect(result[0].cashflow.totalIncome).toBe(100000);
        });

        it('should calculate Year 0 taxes correctly', () => {
            const incomes = [
                new WorkIncome(
                    'inc-1', 'Job', 100000, 'Annually', 'Yes',
                    5000, 0, 0, 0, '', null, 'FIXED',
                    new Date('2020-01-01'),
                    new Date('2030-12-31')
                )
            ];

            const result = runSimulation(1, [], incomes, [], baseAssumptions, baseTaxState);

            // Year 0 should have tax calculations
            expect(result[0].taxDetails.fed).toBeGreaterThan(0);
            expect(result[0].taxDetails.fica).toBeGreaterThan(0);
            // Texas has no state tax
            expect(result[0].taxDetails.state).toBe(0);
        });

        it('should track pre-tax contributions in Year 0', () => {
            const retirementAccount = new InvestedAccount(
                'ret-1', '401k', 50000, 0, 5, 0, 'Traditional 401k', true, 1.0
            );
            const incomes = [
                new WorkIncome(
                    'inc-1', 'Job', 100000, 'Annually', 'Yes',
                    10000, // preTax401k
                    500,   // insurance
                    0,     // roth401k
                    5000,  // employerMatch
                    'ret-1',
                    'Traditional 401k',
                    'FIXED',
                    new Date('2020-01-01'),
                    new Date('2030-12-31')
                )
            ];

            const result = runSimulation(1, [retirementAccount], incomes, [], baseAssumptions, baseTaxState);

            // Year 0 should track contributions
            // Note: taxDetails.preTax = getPreTaxExemptions - insurance
            // getPreTaxExemptions includes preTax401k + insurance + hsa = 10000 + 500 + 0 = 10500
            // So preTax = 10500 - 500 = 10000
            expect(result[0].taxDetails.preTax).toBe(10000);
            expect(result[0].taxDetails.insurance).toBe(500);
            expect(result[0].cashflow.investedMatch).toBe(5000);
        });

        it('should calculate Year 0 discretionary correctly', () => {
            const incomes = [
                new WorkIncome(
                    'inc-1', 'Job', 100000, 'Annually', 'Yes',
                    0, 0, 0, 0, '', null, 'FIXED',
                    new Date('2020-01-01'),
                    new Date('2030-12-31')
                )
            ];
            const expenses = [new FoodExpense('exp-1', 'Living', 30000, 'Annually', new Date('2025-01-01'))];

            const result = runSimulation(1, [], incomes, expenses, baseAssumptions, baseTaxState);

            // Discretionary = Income - PreTax - PostTax - Taxes - Expenses
            const year0 = result[0];
            const expectedDiscretionary = year0.cashflow.totalIncome -
                year0.taxDetails.preTax -
                year0.taxDetails.postTax -
                year0.taxDetails.fed -
                year0.taxDetails.state -
                year0.taxDetails.fica -
                30000; // expenses

            expect(year0.cashflow.discretionary).toBeCloseTo(expectedDiscretionary, 0);
        });
    });

    describe('Life Expectancy Capping', () => {
        it('should cap simulation at life expectancy', () => {
            const shortLifeAssumptions: AssumptionsState = {
                ...baseAssumptions,
                demographics: {
                    startAge: 85,
                    startYear: 2025,
                    lifeExpectancy: 90, // Only 5 years left
                    retirementAge: 65
                }
            };

            // Request 30 years but should only get 5 + Year 0 = 6 total
            const result = runSimulation(30, [], [], [], shortLifeAssumptions, baseTaxState);

            expect(result.length).toBe(6); // Year 0 + 5 years
            expect(result[0].year).toBe(2025);
            expect(result[5].year).toBe(2030); // Last year at age 90
        });

        it('should return only Year 0 when already at life expectancy', () => {
            const atEndAssumptions: AssumptionsState = {
                ...baseAssumptions,
                demographics: {
                    startAge: 90,
                    startYear: 2025,
                    lifeExpectancy: 90, // 0 years left
                    retirementAge: 65
                }
            };

            const result = runSimulation(30, [], [], [], atEndAssumptions, baseTaxState);

            expect(result.length).toBe(1); // Only Year 0
        });

        it('should run full duration when life expectancy is far out', () => {
            const longLifeAssumptions: AssumptionsState = {
                ...baseAssumptions,
                demographics: {
                    startAge: 30,
                    startYear: 2025,
                    lifeExpectancy: 100, // 70 years left
                    retirementAge: 65
                }
            };

            // Request 10 years - should get all 10 + Year 0
            const result = runSimulation(10, [], [], [], longLifeAssumptions, baseTaxState);

            expect(result.length).toBe(11); // Year 0 + 10 years
        });
    });

    describe('Monte Carlo Return Overrides', () => {
        it('should apply yearly return overrides when provided', () => {
            const account = new InvestedAccount(
                'inv-1', 'Investment', 100000, 0, 5, 0, 'Brokerage', true, 1.0
            );

            // Override returns: year 1 = 20%, year 2 = -10%
            const yearlyReturns = [20, -10];

            const result = runSimulation(2, [account], [], [], baseAssumptions, baseTaxState, yearlyReturns);

            // Year 0: $100,000
            expect(result[0].accounts[0].amount).toBe(100000);

            // Year 1: $100,000 * 1.20 = $120,000
            expect(result[1].accounts[0].amount).toBeCloseTo(120000, 0);

            // Year 2: $120,000 * 0.90 = $108,000
            expect(result[2].accounts[0].amount).toBeCloseTo(108000, 0);
        });

        it('should use default assumptions when no return override provided', () => {
            const account = new InvestedAccount(
                'inv-1', 'Investment', 100000, 0, 5, 0, 'Brokerage', true, 1.0
            );

            // No yearlyReturns = use assumptions (10% in baseAssumptions)
            const result = runSimulation(2, [account], [], [], baseAssumptions, baseTaxState);

            // Year 1: $100,000 * 1.10 = $110,000
            expect(result[1].accounts[0].amount).toBeCloseTo(110000, 0);

            // Year 2: $110,000 * 1.10 = $121,000
            expect(result[2].accounts[0].amount).toBeCloseTo(121000, 0);
        });

        it('should handle partial return overrides array', () => {
            const account = new InvestedAccount(
                'inv-1', 'Investment', 100000, 0, 5, 0, 'Brokerage', true, 1.0
            );

            // Only provide 1 year of overrides for a 3 year simulation
            const yearlyReturns = [15]; // Year 1 only

            const result = runSimulation(3, [account], [], [], baseAssumptions, baseTaxState, yearlyReturns);

            // Year 1 uses override (15%)
            expect(result[1].accounts[0].amount).toBeCloseTo(115000, 0);

            // Year 2 should use undefined (will be treated as default assumption)
            // The SimulationEngine handles undefined as no override
        });
    });

    describe('Timeline Continuity', () => {
        it('should pass previous timeline to each year for SS calculation', () => {
            const assumptions: AssumptionsState = {
                ...baseAssumptions,
                demographics: {
                    startAge: 30,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 65
                }
            };

            const incomes = [
                new WorkIncome(
                    'inc-1', 'Job', 100000, 'Annually', 'Yes',
                    0, 0, 0, 0, '', null, 'FIXED',
                    new Date('2020-01-01'),
                    new Date('2035-12-31')
                )
            ];

            const result = runSimulation(5, [], incomes, [], assumptions, baseTaxState);

            // Each year should have accumulated history
            expect(result.length).toBe(6);

            // Years should be sequential
            for (let i = 0; i < result.length; i++) {
                expect(result[i].year).toBe(2025 + i);
            }
        });

        it('should carry forward account balances year to year', () => {
            const account = new SavedAccount('sav-1', 'Savings', 10000, 5); // 5% APR

            const result = runSimulation(3, [account], [], [], baseAssumptions, baseTaxState);

            // Year 0: $10,000
            expect(result[0].accounts[0].amount).toBe(10000);

            // Year 1: $10,000 * 1.05 = $10,500
            expect(result[1].accounts[0].amount).toBeCloseTo(10500, 0);

            // Year 2: $10,500 * 1.05 = $11,025
            expect(result[2].accounts[0].amount).toBeCloseTo(11025, 0);

            // Year 3: $11,025 * 1.05 = $11,576.25
            expect(result[3].accounts[0].amount).toBeCloseTo(11576.25, 0);
        });

        it('should carry forward income/expense modifications', () => {
            const assumptions: AssumptionsState = {
                ...baseAssumptions,
                income: {
                    ...baseAssumptions.income,
                    salaryGrowth: 3 // 3% salary growth
                }
            };

            const incomes = [
                new WorkIncome(
                    'inc-1', 'Job', 100000, 'Annually', 'Yes',
                    0, 0, 0, 0, '', null, 'FIXED',
                    new Date('2020-01-01'),
                    new Date('2035-12-31')
                )
            ];

            const result = runSimulation(3, [], incomes, [], assumptions, baseTaxState);

            // Year 0: $100,000
            expect(result[0].incomes[0].amount).toBe(100000);

            // Year 1: $100,000 * 1.03 = $103,000
            expect(result[1].incomes[0].amount).toBeCloseTo(103000, 0);

            // Year 2: $103,000 * 1.03 = $106,090
            expect(result[2].incomes[0].amount).toBeCloseTo(106090, 0);
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty inputs', () => {
            const result = runSimulation(5, [], [], [], baseAssumptions, baseTaxState);

            expect(result.length).toBe(6);
            expect(result[0].accounts).toEqual([]);
            expect(result[0].incomes).toEqual([]);
            expect(result[0].expenses).toEqual([]);
        });

        it('should handle zero years requested', () => {
            const result = runSimulation(0, [], [], [], baseAssumptions, baseTaxState);

            // Should still return Year 0
            expect(result.length).toBe(1);
            expect(result[0].year).toBe(2025);
        });

        it('should handle negative years gracefully', () => {
            // Life expectancy cap should catch this
            const pastAssumptions: AssumptionsState = {
                ...baseAssumptions,
                demographics: {
                    startAge: 95,
                    startYear: 2025,
                    lifeExpectancy: 90, // Already past life expectancy
                    retirementAge: 65
                }
            };

            const result = runSimulation(10, [], [], [], pastAssumptions, baseTaxState);

            // yearsUntilDeath = max(0, 90 - 95) = 0
            // Should only get Year 0
            expect(result.length).toBe(1);
        });
    });
});
