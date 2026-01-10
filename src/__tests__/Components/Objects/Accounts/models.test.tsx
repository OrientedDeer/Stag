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
            expect(nextYear.amount).toBeCloseTo(1000 * 1.05 + 500);
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
            
            // Expected: 10000 * (1 + (10 - 0.5)/100) + 1000 = 10000 * 1.095 + 1000 = 10950 + 1000 = 11950
            expect(nextYear.amount).toBeCloseTo(11950);
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
            
            // Math Check:
            // Growth Rate = 1 + (10 - 0.1) / 100 = 1.099
            // New Employer Balance = (10,000 * 1.099) + 5,000 = 15,990
            // New Tenure = 1
            // Vested % = 1 * 0.25 = 25%
            // Non-Vested = 15,990 * (1 - 0.25) = 11,992.5
            
            expect(year1.employerBalance).toBeCloseTo(15990, 0);
            expect(year1.nonVestedAmount).toBeCloseTo(11992.5, 0);

            // --- YEAR 2 ---
            // Another 5k employer match
            const year2 = year1.increment(assumptions, 0, 5000);

            // Math Check:
            // Prev Employer Bal = 15,990
            // New Employer Balance = (15,990 * 1.099) + 5,000 = 22,573.01
            // New Tenure = 2
            // Vested % = 2 * 0.25 = 50%
            // Non-Vested = 22,573.01 * (1 - 0.50) = 11,286.5
            
            // The total employer pot grew, but the non-vested portion shrank 
            // because we jumped from 75% unvested to 50% unvested.
            expect(year2.nonVestedAmount).toBeLessThan(year1.nonVestedAmount);
            expect(year2.nonVestedAmount).toBeCloseTo(11286.5, 0);
        });

        it('should drain employer balance if user withdrawal exceeds user balance', () => {
            const assumptions = { ...mockAssumptions };
            // 1. Setup
            const acc = new InvestedAccount(
                'i1', '401k',
                10000, // Total
                5000,  // Employer Portion
                2,     // Tenure (50% vested: 2 * 0.25 = 0.5)
                0.1, 'Traditional 401k', true, 0.25
            );

            // 2. Act: Withdraw $6,000 (More than user has, but less than vested limit)
            // We pass 0 for employer contribution to keep it simple
            const next = acc.increment(assumptions, -6000, 0);

            // 3. Assert
            // Growth Rate: 1 + (10 - 0.1)/100 = 1.099 (9.9%)
            // After growth: Total = 10990, Employer = 5495, User = 5495
            // Vested employer = 5495 * 0.5 = 2747.5
            // User withdraws 6000:
            //   - User equity used: 5495 (all)
            //   - Shortfall: 505
            //   - Taken from vested employer: 505 (allowed because 505 < 2747.5)
            // Final: Total = 4990, Employer = 4990, User = 0

            const expectedTotal = 10000 * 1.099 - 6000; // 9.9% growth
            expect(next.amount).toBeCloseTo(expectedTotal);

            // Employer Balance should be 4990
            // (User equity was wiped out, and 505 was taken from vested employer funds)
            expect(next.employerBalance).toBeCloseTo(4990);
        });

        it('should limit withdrawal to vested amount when exceeding vesting', () => {
            const assumptions = { ...mockAssumptions };
            // 1. Setup - 0% vested (just started)
            const acc = new InvestedAccount(
                'i1', '401k',
                10000, // Total
                5000,  // Employer Portion
                0,     // Tenure (0% vested: 0 * 0.25 = 0)
                0.1, 'Traditional 401k', true, 0.25
            );

            // 2. Act: Try to withdraw $8,000 (exceeds user equity + vested funds)
            const next = acc.increment(assumptions, -8000, 0);

            // 3. Assert
            // Growth Rate: 1.099
            // After growth: Total = 10990, Employer = 5495, User = 5495
            // Vested employer = 5495 * 0 = 0 (nothing vested yet!)
            // User tries to withdraw 8000:
            //   - User equity: 5495 (all can be withdrawn)
            //   - Shortfall: 8000 - 5495 = 2505
            //   - Vested employer: 0 (can't withdraw any)
            //   - Allowed withdrawal: 5495 + 0 = 5495
            // Final: Total = 10990 - 5495 = 5495, Employer = 5495, User = 0

            const expectedTotal = 10000 * 1.099 - 5495; // Only allowed to withdraw user equity
            expect(next.amount).toBeCloseTo(expectedTotal);

            // Employer Balance should remain unchanged (all vested = 0)
            expect(next.employerBalance).toBeCloseTo(5495);

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
