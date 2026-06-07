import { describe, it, expect } from 'vitest';
import {
    calculateNetWorth,
    calculateLiquidNetWorth,
    calculateTotalDebt,
    calculateAnnualExpenses,
    evaluateMilestone,
    evaluateAllMilestones,
    isActiveByMilestone,
    MilestoneContext,
} from '../../services/simulation/MilestoneEvaluator';
import { InvestedAccount, SavedAccount, DebtAccount, PropertyAccount, ESPPAccount, DeficitDebtAccount } from '../../components/Objects/Accounts/models';
import { MortgageExpense, LoanExpense, OtherExpense } from '../../components/Objects/Expense/models';
import { CustomMilestone } from '../../services/simulation/types';

describe('MilestoneEvaluator', () => {
    describe('calculateNetWorth', () => {
        it('calculates net worth with simple accounts', () => {
            const accounts = [
                new InvestedAccount('401k', '401k', 500000, 0, 0, 0.1, 'Traditional 401k'),
                new SavedAccount('savings', 'Savings', 50000, 1.5),
            ];

            expect(calculateNetWorth(accounts, [])).toBe(550000);
        });

        it('subtracts debt accounts', () => {
            const accounts = [
                new SavedAccount('savings', 'Savings', 100000, 1.5),
                new DebtAccount('debt', 'Car Loan', 20000, '', 5),
            ];

            expect(calculateNetWorth(accounts, [])).toBe(80000);
        });

        it('handles property with mortgage', () => {
            // Property account has value 500k and loan balance 300k
            const accounts = [
                new PropertyAccount('house', 'Home', 500000, 'Financed', 300000, 300000, ''),
            ];
            // Note: MortgageExpense would also have loan_balance but that's
            // typically the same debt tracked in PropertyAccount, so we test separately
            const expenses: any[] = [];

            // Net worth = 500k value - 300k loan = 200k
            const netWorth = calculateNetWorth(accounts, expenses);
            expect(netWorth).toBe(200000);
        });

        it('includes mortgage from expense when no property account', () => {
            const accounts: any[] = [];
            const expenses = [
                new MortgageExpense(
                    'mort', 'Mortgage', 'Monthly',
                    500000, 300000, 400000, 4, 30,
                    1.2, 0, 0.5, 200, 0.3, 0, 0,
                    'Itemized', 0, '',
                    new Date()
                ),
            ];

            // Just the mortgage liability, no property account asset
            const netWorth = calculateNetWorth(accounts, expenses);
            expect(netWorth).toBe(-300000);
        });

        it('includes ESPP accounts as assets', () => {
            const accounts = [
                new ESPPAccount('espp', 'ESPP Stock', 25000, []),
            ];

            expect(calculateNetWorth(accounts, [])).toBe(25000);
        });

        it('includes deficit debt as liability', () => {
            const accounts = [
                new SavedAccount('savings', 'Savings', 10000, 1.5),
                new DeficitDebtAccount('deficit', 'Deficit', 5000),
            ];

            expect(calculateNetWorth(accounts, [])).toBe(5000);
        });
    });

    describe('calculateLiquidNetWorth', () => {
        it('only includes brokerage and savings', () => {
            const accounts = [
                new InvestedAccount('401k', '401k', 500000, 0, 0, 0.1, 'Traditional 401k'),
                new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage'),
                new SavedAccount('savings', 'Savings', 50000, 1.5),
            ];

            // Only brokerage (100k) + savings (50k) = 150k
            expect(calculateLiquidNetWorth(accounts)).toBe(150000);
        });

        it('includes ESPP as liquid', () => {
            const accounts = [
                new ESPPAccount('espp', 'ESPP', 30000, []),
                new SavedAccount('savings', 'Savings', 20000, 1.5),
            ];

            expect(calculateLiquidNetWorth(accounts)).toBe(50000);
        });

        it('excludes retirement accounts', () => {
            const accounts = [
                new InvestedAccount('roth', 'Roth IRA', 200000, 0, 0, 0.1, 'Roth IRA'),
                new InvestedAccount('trad', 'Traditional IRA', 150000, 0, 0, 0.1, 'Traditional IRA'),
            ];

            expect(calculateLiquidNetWorth(accounts)).toBe(0);
        });
    });

    describe('calculateTotalDebt', () => {
        it('sums all debt sources', () => {
            const accounts = [
                new DebtAccount('car', 'Car Loan', 15000, '', 5),
                new DebtAccount('student', 'Student Loans', 25000, '', 6),
            ];

            expect(calculateTotalDebt(accounts, [])).toBe(40000);
        });

        it('includes mortgage from expenses', () => {
            const accounts: any[] = [];
            const expenses = [
                new MortgageExpense(
                    'mort', 'Mortgage', 'Monthly',
                    400000, 250000, 300000, 4, 30,
                    1.2, 0, 0.5, 200, 0.3, 0, 0,
                    'Itemized', 0, 'house',
                    new Date()
                ),
            ];

            expect(calculateTotalDebt(accounts, expenses)).toBe(250000);
        });

        it('includes loan expenses', () => {
            const accounts: any[] = [];
            const expenses = [
                new LoanExpense(
                    'loan', 'Personal Loan', 10000, 'Monthly',
                    8, 'Compounding', 500, 'No', 0, ''
                ),
            ];

            expect(calculateTotalDebt(accounts, expenses)).toBe(10000);
        });
    });

    describe('evaluateMilestone', () => {
        const baseContext: MilestoneContext = {
            accounts: [
                new InvestedAccount('brok', 'Brokerage', 500000, 0, 0, 0.1, 'Brokerage'),
                new SavedAccount('savings', 'Savings', 100000, 1.5),
            ],
            expenses: [],
            year: 2030,
            age: 35,
        };

        it('evaluates NET_WORTH >= condition', () => {
            const milestone: CustomMilestone = {
                id: 'fi',
                name: 'Financial Independence',
                conditions: [{ type: 'NET_WORTH', operator: '>=', value: 500000 }],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(true);
        });

        it('evaluates NET_WORTH < condition (not met)', () => {
            const milestone: CustomMilestone = {
                id: 'fi',
                name: 'Financial Independence',
                conditions: [{ type: 'NET_WORTH', operator: '>=', value: 1000000 }],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(false);
        });

        it('evaluates LIQUID_NET_WORTH condition', () => {
            const milestone: CustomMilestone = {
                id: 'coast',
                name: 'Coast FIRE',
                conditions: [{ type: 'LIQUID_NET_WORTH', operator: '>=', value: 600000 }],
            };

            // 500k brokerage + 100k savings = 600k liquid
            expect(evaluateMilestone(milestone, baseContext)).toBe(true);
        });

        it('evaluates TOTAL_DEBT <= condition', () => {
            const milestone: CustomMilestone = {
                id: 'debt-free',
                name: 'Debt Free',
                conditions: [{ type: 'TOTAL_DEBT', operator: '<=', value: 0 }],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(true);
        });

        it('evaluates YEAR condition', () => {
            const milestone: CustomMilestone = {
                id: 'year-2030',
                name: 'Year 2030',
                conditions: [{ type: 'YEAR', operator: '=', value: 2030 }],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(true);
        });

        it('evaluates AGE condition', () => {
            const milestone: CustomMilestone = {
                id: 'age-35',
                name: 'Age 35',
                conditions: [{ type: 'AGE', operator: '>=', value: 35 }],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(true);
        });

        it('requires ALL conditions to be met (AND logic)', () => {
            const milestone: CustomMilestone = {
                id: 'combined',
                name: 'Coast FIRE at 40',
                conditions: [
                    { type: 'NET_WORTH', operator: '>=', value: 500000 },
                    { type: 'AGE', operator: '>=', value: 40 }, // Not met (age is 35)
                ],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(false);
        });

        it('passes when all conditions are met', () => {
            const milestone: CustomMilestone = {
                id: 'combined',
                name: 'Coast FIRE at 35',
                conditions: [
                    { type: 'NET_WORTH', operator: '>=', value: 500000 },
                    { type: 'AGE', operator: '>=', value: 35 },
                ],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(true);
        });
    });

    describe('evaluateAllMilestones', () => {
        it('identifies newly reached milestones', () => {
            const milestones: CustomMilestone[] = [
                {
                    id: 'fi',
                    name: 'FI',
                    conditions: [{ type: 'NET_WORTH', operator: '>=', value: 500000 }],
                },
                {
                    id: 'rich',
                    name: 'Rich',
                    conditions: [{ type: 'NET_WORTH', operator: '>=', value: 2000000 }],
                },
            ];

            const context: MilestoneContext = {
                accounts: [
                    new InvestedAccount('brok', 'Brokerage', 600000, 0, 0, 0.1, 'Brokerage'),
                ],
                expenses: [],
                year: 2030,
                age: 40,
            };

            const result = evaluateAllMilestones(milestones, new Set(), context);

            expect(result.newlyReached).toHaveLength(1);
            expect(result.newlyReached[0].milestoneId).toBe('fi');
            expect(result.newlyReached[0].yearReached).toBe(2030);
            expect(result.newlyReached[0].ageReached).toBe(40);
            expect(result.activeMilestones).toContain('fi');
            expect(result.activeMilestones).not.toContain('rich');
        });

        it('skips already reached milestones', () => {
            const milestones: CustomMilestone[] = [
                {
                    id: 'fi',
                    name: 'FI',
                    conditions: [{ type: 'NET_WORTH', operator: '>=', value: 500000 }],
                },
            ];

            const context: MilestoneContext = {
                accounts: [
                    new InvestedAccount('brok', 'Brokerage', 600000, 0, 0, 0.1, 'Brokerage'),
                ],
                expenses: [],
                year: 2030,
                age: 40,
            };

            const result = evaluateAllMilestones(milestones, new Set(['fi']), context);

            expect(result.newlyReached).toHaveLength(0);
            expect(result.activeMilestones).toContain('fi');
        });
    });

    describe('calculateAnnualExpenses', () => {
        it('calculates total annual expenses', () => {
            const expenses = [
                new OtherExpense('rent', 'Rent', 2000, 'Monthly', new Date('2020-01-01'), new Date('2100-01-01')),
                new OtherExpense('food', 'Food', 500, 'Monthly', new Date('2020-01-01'), new Date('2100-01-01')),
            ];

            // 2000 * 12 + 500 * 12 = 30000
            expect(calculateAnnualExpenses(expenses, 2030)).toBe(30000);
        });

        it('excludes expenses outside their date range', () => {
            const expenses = [
                new OtherExpense('rent', 'Rent', 2000, 'Monthly', new Date('2020-01-01'), new Date('2025-12-31')),
                new OtherExpense('food', 'Food', 500, 'Monthly', new Date('2020-01-01'), new Date('2100-01-01')),
            ];

            // Rent ends in 2025, so in 2030 only food counts: 500 * 12 = 6000
            expect(calculateAnnualExpenses(expenses, 2030)).toBe(6000);
        });
    });

    describe('EXPENSES valueType', () => {
        it('evaluates net worth >= multiple of expenses', () => {
            const accounts = [
                new InvestedAccount('brok', 'Brokerage', 1000000, 0, 0, 0.1, 'Brokerage'),
            ];
            const expenses = [
                new OtherExpense('living', 'Living', 40000, 'Annually', new Date('2020-01-01'), new Date('2100-01-01')),
            ];

            // Net worth: $1M >= 25 × $40k ($1M)
            const milestone: CustomMilestone = {
                id: 'fi',
                name: 'FI',
                conditions: [{
                    type: 'NET_WORTH',
                    operator: '>=',
                    value: 25,
                    valueType: 'EXPENSES'
                }],
            };

            const context: MilestoneContext = {
                accounts,
                expenses,
                year: 2030,
                age: 40,
            };

            expect(evaluateMilestone(milestone, context)).toBe(true);
        });

        it('fails when net worth is below expense multiple', () => {
            const accounts = [
                new InvestedAccount('brok', 'Brokerage', 800000, 0, 0, 0.1, 'Brokerage'),
            ];
            const expenses = [
                new OtherExpense('living', 'Living', 40000, 'Annually', new Date('2020-01-01'), new Date('2100-01-01')),
            ];

            // Net worth: $800k < 25 × $40k ($1M)
            const milestone: CustomMilestone = {
                id: 'fi',
                name: 'FI',
                conditions: [{
                    type: 'NET_WORTH',
                    operator: '>=',
                    value: 25,
                    valueType: 'EXPENSES'
                }],
            };

            const context: MilestoneContext = {
                accounts,
                expenses,
                year: 2030,
                age: 40,
            };

            expect(evaluateMilestone(milestone, context)).toBe(false);
        });
    });

    describe('MILESTONE_PLUS valueType', () => {
        it('triggers X years after another milestone', () => {
            const milestoneReachYears = new Map<string, number>();
            milestoneReachYears.set('debt-free', 2025);

            // Year >= "Debt Free" + 5
            const milestone: CustomMilestone = {
                id: 'sabbatical',
                name: 'Sabbatical',
                conditions: [{
                    type: 'YEAR',
                    operator: '>=',
                    value: 5,
                    valueType: 'MILESTONE_PLUS',
                    referenceMilestoneId: 'debt-free'
                }],
            };

            const context: MilestoneContext = {
                accounts: [],
                expenses: [],
                year: 2030, // >= 2025 + 5
                age: 40,
                milestoneReachYears,
            };

            expect(evaluateMilestone(milestone, context)).toBe(true);
        });

        it('does not trigger before X years after milestone', () => {
            const milestoneReachYears = new Map<string, number>();
            milestoneReachYears.set('debt-free', 2025);

            const milestone: CustomMilestone = {
                id: 'sabbatical',
                name: 'Sabbatical',
                conditions: [{
                    type: 'YEAR',
                    operator: '>=',
                    value: 5,
                    valueType: 'MILESTONE_PLUS',
                    referenceMilestoneId: 'debt-free'
                }],
            };

            const context: MilestoneContext = {
                accounts: [],
                expenses: [],
                year: 2028, // 2028 < 2025 + 5 (2030)
                age: 38,
                milestoneReachYears,
            };

            expect(evaluateMilestone(milestone, context)).toBe(false);
        });

        it('does not trigger if referenced milestone not reached', () => {
            const milestoneReachYears = new Map<string, number>();
            // debt-free not in the map

            const milestone: CustomMilestone = {
                id: 'sabbatical',
                name: 'Sabbatical',
                conditions: [{
                    type: 'YEAR',
                    operator: '>=',
                    value: 5,
                    valueType: 'MILESTONE_PLUS',
                    referenceMilestoneId: 'debt-free'
                }],
            };

            const context: MilestoneContext = {
                accounts: [],
                expenses: [],
                year: 2030,
                age: 40,
                milestoneReachYears,
            };

            expect(evaluateMilestone(milestone, context)).toBe(false);
        });
    });

    describe('isActiveByMilestone', () => {
        it('returns true when no milestone conditions', () => {
            expect(isActiveByMilestone(undefined, undefined, new Set())).toBe(true);
        });

        it('returns false when start milestone not reached', () => {
            expect(isActiveByMilestone('coast-fire', undefined, new Set())).toBe(false);
        });

        it('returns true when start milestone is reached', () => {
            expect(isActiveByMilestone('coast-fire', undefined, new Set(['coast-fire']))).toBe(true);
        });

        it('returns false when end milestone is reached', () => {
            expect(isActiveByMilestone(undefined, 'fi', new Set(['fi']))).toBe(false);
        });

        it('returns true when end milestone not yet reached', () => {
            expect(isActiveByMilestone(undefined, 'fi', new Set())).toBe(true);
        });

        it('handles both start and end milestones', () => {
            // Start reached, end not reached = active
            expect(isActiveByMilestone('coast', 'fi', new Set(['coast']))).toBe(true);

            // Start reached, end reached = not active
            expect(isActiveByMilestone('coast', 'fi', new Set(['coast', 'fi']))).toBe(false);

            // Start not reached = not active (regardless of end)
            expect(isActiveByMilestone('coast', 'fi', new Set(['fi']))).toBe(false);
        });
    });
});
