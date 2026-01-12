import { describe, it, expect } from 'vitest';
import { 
    SavedAccount, 
    InvestedAccount, 
    PropertyAccount, 
    DebtAccount, 
    reconstituteAccount 
} from '../../../../components/Objects/Accounts/models';
import { defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';

// Mock Assumptions for testing the 'increment' methods
const mockAssumptions = {
    ...defaultAssumptions,
    investments: {
        ...defaultAssumptions.investments,
        returnRates: { ror: 10 } // 10%
    },
    macro: {
        ...defaultAssumptions.macro,
        inflationRate: 3, // 3%
        inflationAdjusted: false,
    },
    expenses: {
        ...defaultAssumptions.expenses,
        housingAppreciation: 5, // 5%
    }
};

describe('Account Models', () => {

    describe('SavedAccount', () => {
        it('should initialize with correct defaults', () => {
            const acc = new SavedAccount('s1', 'Emergency Fund', 1000);
            expect(acc.apr).toBe(0);
        });

        it('should increment its value based on APR and contribution', () => {
            const acc = new SavedAccount('s1', 'Emergency Fund', 1000, 5); // 5% APR
            const nextYear = acc.increment(mockAssumptions, 500);
            // BOY timing: (1000 + 500) * 1.05 = 1575
            expect(nextYear.amount).toBeCloseTo((1000 + 500) * 1.05);
        });
    });

    describe('InvestedAccount', () => {
        it('should initialize with correct defaults', () => {
            const acc = new InvestedAccount('i1', 'Brokerage', 10000, 0, 5, 0.1, 'Brokerage', true, 0.2);
            expect(acc.expenseRatio).toBe(0.1);
            expect(acc.taxType).toBe('Brokerage');
            expect(acc.isContributionEligible).toBe(true);
            expect(acc.vestedPerYear).toBe(0.2);
        });

        it('should grow based on RoR, subtracting expense ratio', () => {
            const assumptions = { ...mockAssumptions, macro: { ...mockAssumptions.macro, inflationAdjusted: false }};
            // 10% RoR, 0.5% Expense Ratio
            const acc = new InvestedAccount('i1', 'Brokerage', 10000, 0, 5, 0.5, 'Brokerage', true, 0.2);
            const nextYear = acc.increment(assumptions, 1000);

            // BOY timing: (10000 + 1000) * 1.095 = 11000 * 1.095 = 12045
            expect(nextYear.amount).toBeCloseTo((10000 + 1000) * 1.095);
        });

        it('should include inflation in growth if inflationAdjusted is true', () => {
            const assumptions = { ...mockAssumptions, macro: { ...mockAssumptions.macro, inflationAdjusted: true }};
             // 10% RoR, 3% Inflation, 0.5% Expense Ratio
            const acc = new InvestedAccount('i1', 'Brokerage', 10000, 0, 5, 0.5, 'Brokerage', true, 0.2);
            const nextYear = acc.increment(assumptions, 0);

            // Expected: 10000 * (1 + (10 + 3 - 0.5)/100) = 10000 * 1.125 = 11250
            expect(nextYear.amount).toBeCloseTo(11250);
        });

        it('should decrease the non-vested amount over time as tenure increases', () => {
            const assumptions = { ...mockAssumptions };

            // SETUP:
            // Total: 20k
            // Employer Portion: 10k
            // Tenure: 0 years (0% vested initially)
            // Vesting Schedule: 25% per year
            const acc = new InvestedAccount(
                'i1',
                '401k',
                20000,
                10000, // employerBalance
                0,     // tenureYears
                0.1,
                'Traditional 401k',
                true,
                0.25   // vestedPerYear
            );

            // --- YEAR 1 ---
            // User contributes 0, Employer contributes 5,000
            const year1 = acc.increment(assumptions, 0, 5000);

            // BOY timing math:
            // Growth Rate = 1.099
            // Pre-growth: User = 10000, Employer = 10000 + 5000 = 15000
            // Grown Employer = 15000 * 1.099 = 16485
            // Grown Total = 25000 * 1.099 = 27475
            // New Tenure = 1, Vested % = 25%
            // Non-Vested = 16485 * 0.75 = 12363.75

            expect(year1.employerBalance).toBeCloseTo(16485, 0);
            expect(year1.nonVestedAmount).toBeCloseTo(12363.75, 0);

            // --- YEAR 2 ---
            // Another 5k employer match
            const year2 = year1.increment(assumptions, 0, 5000);

            // BOY timing math:
            // Pre-growth: Employer = 16485 + 5000 = 21485
            // Grown Employer = 21485 * 1.099 = 23612.015
            // New Tenure = 2, Vested % = 50%
            // Non-Vested = 23612.015 * 0.50 = 11806

            // The non-vested portion should decrease as vesting increases
            expect(year2.nonVestedAmount).toBeLessThan(year1.nonVestedAmount);
            expect(year2.nonVestedAmount).toBeCloseTo(11806, 0);
        });

        it('should drain employer balance if user withdrawal exceeds user balance', () => {
            const assumptions = { ...mockAssumptions };
            // 1. Setup
            const acc = new InvestedAccount(
                'i1', '401k',
                10000, // Total
                5000,  // Employer Portion
                2,     // Tenure (will become 3, so 75% vested: 3 * 0.25 = 0.75)
                0.1, 'Traditional 401k', true, 0.25
            );

            // 2. Act: Withdraw $6,000 (More than user has, but less than vested limit)
            const next = acc.increment(assumptions, -6000, 0);

            // 3. Assert - BOY timing:
            // Growth Rate: 1.099
            // NewTenure = 3, vestedPct = 0.75
            // Pre-growth: User = 5000, Employer = 5000
            // Withdrawal = 6000:
            //   - User equity: 5000 (all used)
            //   - Shortfall: 1000
            //   - Vested employer: 5000 * 0.75 = 3750
            //   - Taken from employer: min(1000, 3750) = 1000
            // PreGrowthEmployer = 5000 - 1000 = 4000
            // PreGrowthUser = 0
            // GrownTotal = 4000 * 1.099 = 4396
            // GrownEmployer = 4000 * 1.099 = 4396

            expect(next.amount).toBeCloseTo(4396);
            expect(next.employerBalance).toBeCloseTo(4396);
        });

        it('should limit withdrawal to vested amount when exceeding vesting', () => {
            const assumptions = { ...mockAssumptions };
            // 1. Setup - 0% vested (just started)
            const acc = new InvestedAccount(
                'i1', '401k',
                10000, // Total
                5000,  // Employer Portion
                0,     // Tenure (will become 1, so 25% vested: 1 * 0.25 = 0.25)
                0.1, 'Traditional 401k', true, 0.25
            );

            // 2. Act: Try to withdraw $8,000 (exceeds user equity + vested funds)
            const next = acc.increment(assumptions, -8000, 0);

            // 3. Assert - BOY timing:
            // Growth Rate: 1.099
            // NewTenure = 1, vestedPct = 0.25
            // Pre-growth: User = 5000, Employer = 5000
            // Withdrawal = 8000:
            //   - User equity: 5000 (all used)
            //   - Shortfall: 3000
            //   - Vested employer: 5000 * 0.25 = 1250
            //   - Allowed from employer: min(3000, 1250) = 1250
            // PreGrowthEmployer = 5000 - 1250 = 3750
            // PreGrowthUser = 0
            // GrownTotal = 3750 * 1.099 = 4121.25
            // GrownEmployer = 3750 * 1.099 = 4121.25

            expect(next.amount).toBeCloseTo(4121.25);
            expect(next.employerBalance).toBeCloseTo(4121.25);

            // User equity should be 0 (wiped out their portion)
            const userEquity = next.amount - next.employerBalance;
            expect(userEquity).toBeCloseTo(0);
        });
    });

    describe('PropertyAccount', () => {
        it('should appreciate based on housingAppreciation assumption', () => {
            const acc = new PropertyAccount('p1', 'Home', 500000, 'Financed', 400000, 400000, 'm1');
            const nextYear = acc.increment(mockAssumptions);
            // Expected: 500000 * (1 + 5/100) = 525000
            expect(nextYear.amount).toBe(525000);
        });

        it('should use overrides for value and loan balance when provided', () => {
            const acc = new PropertyAccount('p1', 'Home', 500000, 'Financed', 400000, 400000, 'm1');
            const nextYear = acc.increment(mockAssumptions, { newValue: 510000, newLoanBalance: 395000 });
            expect(nextYear.amount).toBe(510000);
            expect(nextYear.loanAmount).toBe(395000);
        });
    });

    describe('DebtAccount', () => {
        it('should increase balance based on APR if no override is given', () => {
            const acc = new DebtAccount('d1', 'Student Loan', 20000, 'l1', 5); // 5% APR
            const nextYear = acc.increment(mockAssumptions);
            // Expected: 20000 * 1.05 = 21000
            expect(nextYear.amount).toBe(21000);
        });

        it('should use overrideBalance when provided', () => {
            const acc = new DebtAccount('d1', 'Student Loan', 20000, 'l1', 5);
            // Simulate a payment reducing the balance
            const nextYear = acc.increment(mockAssumptions, 18000);
            expect(nextYear.amount).toBe(18000);
        });
    });

    describe('reconstituteAccount', () => {
        it('should create a SavedAccount instance', () => {
            const data = { className: 'SavedAccount', id: 's1', name: 'Savings', amount: 100, apr: 1 };
            const account = reconstituteAccount(data);
            expect(account).toBeInstanceOf(SavedAccount);
            if (account) {
                expect(account.id).toBe('s1');
                expect((account as SavedAccount).apr).toBe(1);
            }
        });

        it('should create an InvestedAccount instance with defaults', () => {
            const data = { className: 'InvestedAccount', id: 'i1', name: 'Roth', amount: 5000 };
            const account = reconstituteAccount(data);
            expect(account).toBeInstanceOf(InvestedAccount);
            if (account) {
                expect(account.amount).toBe(5000);
                expect((account as InvestedAccount).expenseRatio).toBe(0.1); // default
            }
        });
        
        it('should create a PropertyAccount instance', () => {
            const data = { className: 'PropertyAccount', id: 'p1', name: 'House', amount: 200000 };
            const account = reconstituteAccount(data);
            expect(account).toBeInstanceOf(PropertyAccount);
            if (account) {
                expect(account.id).toBe('p1');
            }
        });

        it('should create a DebtAccount instance', () => {
            const data = { className: 'DebtAccount', id: 'd1', name: 'Car Loan', amount: 15000 };
            const account = reconstituteAccount(data);
            expect(account).toBeInstanceOf(DebtAccount);
            if (account) {
                expect(account.id).toBe('d1');
            }
        });

        it('should return null for unknown className', () => {
            const data = { className: 'ImaginaryAccount', id: 'x1', amount: 100 };
            const account = reconstituteAccount(data);
            expect(account).toBeNull();
        });

        it('should return null for invalid data', () => {
            const account = reconstituteAccount(null);
            expect(account).toBeNull();
        });
    });
});
