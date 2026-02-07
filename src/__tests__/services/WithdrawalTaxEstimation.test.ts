/**
 * Tests for withdrawal tax estimation based on actual withdrawal order.
 *
 * The system should estimate tax by walking the withdrawal order and calculating
 * the expected tax for each account type, rather than assuming all withdrawals
 * are from Traditional accounts.
 */
import { describe, it, expect } from 'vitest';
import { estimateWithdrawalTax } from '../../services/simulation/WithdrawalTaxEstimation';
import { SavedAccount, InvestedAccount } from '../../components/Objects/Accounts/models';
import { WithdrawalBucket } from '../../components/Objects/Assumptions/AssumptionsContext';

describe('estimateWithdrawalTax', () => {
    describe('Savings-only withdrawals', () => {
        it('should estimate zero tax for savings account withdrawals', () => {
            const accounts = [
                new SavedAccount('sav1', 'Savings', 100000, 4.0),
            ];
            const withdrawalOrder: WithdrawalBucket[] = [
                { id: 'w1', name: 'Savings', accountId: 'sav1' },
            ];
            const deficit = 50000;

            const result = estimateWithdrawalTax(
                deficit,
                accounts,
                withdrawalOrder,
                39, // age
                'Single',
                2040
            );

            expect(result.estimatedTax).toBe(0);
            expect(result.estimatedGrossWithdrawal).toBe(50000);
            expect(result.breakdown.savings).toBe(50000);
            expect(result.breakdown.traditional).toBe(0);
        });
    });

    describe('Brokerage-only withdrawals', () => {
        it('should estimate capital gains tax for brokerage withdrawals', () => {
            // Brokerage with 50% unrealized gains
            // InvestedAccount constructor: id, name, amount, employerBalance, tenureYears, expenseRatio, taxType, isContributionEligible, vestedPerYear, costBasis
            const brokerage = new InvestedAccount(
                'brok1', 'Brokerage', 100000,
                0,      // employerBalance
                0,      // tenureYears
                0,      // expenseRatio
                'Brokerage',
                true,   // isContributionEligible
                0.2,    // vestedPerYear
                50000   // costBasis = $50k, so gains = $50k (50% gain ratio)
            );
            const accounts = [brokerage];
            const withdrawalOrder: WithdrawalBucket[] = [
                { id: 'w1', name: 'Brokerage', accountId: 'brok1' },
            ];
            const deficit = 50000;

            const result = estimateWithdrawalTax(
                deficit,
                accounts,
                withdrawalOrder,
                39, // age (no early withdrawal penalty for brokerage)
                'Single',
                2040
            );

            // 50% gain ratio, 0% federal LTCG (under $44k) + 5% state = 2.5% effective
            // Tax should be positive due to state capital gains tax
            expect(result.estimatedTax).toBeGreaterThan(0);
            expect(result.estimatedTax).toBeLessThan(10000); // Sanity check
            expect(result.estimatedGrossWithdrawal).toBeGreaterThan(50000);
            expect(result.breakdown.brokerage).toBeGreaterThan(0);
        });

        it('should estimate zero tax when brokerage has no gains', () => {
            // Brokerage with 0% unrealized gains (all basis)
            const brokerage = new InvestedAccount(
                'brok1', 'Brokerage', 100000,
                0, 0, 0, 'Brokerage', true, 0.2,
                100000  // costBasis = balance (no gains)
            );
            const accounts = [brokerage];
            const withdrawalOrder: WithdrawalBucket[] = [
                { id: 'w1', name: 'Brokerage', accountId: 'brok1' },
            ];
            const deficit = 50000;

            const result = estimateWithdrawalTax(
                deficit,
                accounts,
                withdrawalOrder,
                39,
                'Single',
                2040
            );

            expect(result.estimatedTax).toBe(0);
            expect(result.estimatedGrossWithdrawal).toBe(50000);
        });
    });

    describe('Traditional-only withdrawals', () => {
        it('should estimate income tax for Traditional withdrawals', () => {
            const trad = new InvestedAccount(
                'trad1', 'Traditional 401k', 500000,
                0, 0, 0, 'Traditional 401k'
            );
            const accounts = [trad];
            const withdrawalOrder: WithdrawalBucket[] = [
                { id: 'w1', name: 'Trad 401k', accountId: 'trad1' },
            ];
            const deficit = 50000;

            const result = estimateWithdrawalTax(
                deficit,
                accounts,
                withdrawalOrder,
                65, // age (no early withdrawal penalty)
                'Single',
                2040
            );

            // Traditional withdrawals taxed as ordinary income
            // At $50k, effective rate ~10-12%
            expect(result.estimatedTax).toBeGreaterThan(3000);
            expect(result.estimatedTax).toBeLessThan(15000);
            expect(result.breakdown.traditional).toBeGreaterThan(0);
        });

        it('should include 10% early withdrawal penalty when age < 59.5', () => {
            const trad = new InvestedAccount(
                'trad1', 'Traditional 401k', 500000,
                0, 0, 0, 'Traditional 401k'
            );
            const accounts = [trad];
            const withdrawalOrder: WithdrawalBucket[] = [
                { id: 'w1', name: 'Trad 401k', accountId: 'trad1' },
            ];
            const deficit = 50000;

            const resultEarly = estimateWithdrawalTax(
                deficit, accounts, withdrawalOrder, 39, 'Single', 2040
            );
            const resultLate = estimateWithdrawalTax(
                deficit, accounts, withdrawalOrder, 65, 'Single', 2040
            );

            // Early withdrawal should have higher tax due to 10% penalty
            expect(resultEarly.estimatedTax).toBeGreaterThan(resultLate.estimatedTax);
            expect(resultEarly.earlyWithdrawalPenalty).toBeGreaterThan(0);
            expect(resultLate.earlyWithdrawalPenalty).toBe(0);
        });
    });

    describe('Mixed withdrawal order (Savings → Brokerage → Traditional)', () => {
        it('should drain tax-free accounts first, minimizing estimated tax', () => {
            const savings = new SavedAccount('sav1', 'Savings', 30000, 4.0);
            const brokerage = new InvestedAccount(
                'brok1', 'Brokerage', 100000,
                0, 0, 0, 'Brokerage', true, 0.2,
                50000 // costBasis = $50k, so 50% gains
            );
            const trad = new InvestedAccount(
                'trad1', 'Traditional 401k', 500000,
                0, 0, 0, 'Traditional 401k'
            );
            const accounts = [savings, brokerage, trad];

            // Optimal order: savings first, then brokerage, then traditional
            const withdrawalOrder: WithdrawalBucket[] = [
                { id: 'w1', name: 'Savings', accountId: 'sav1' },
                { id: 'w2', name: 'Brokerage', accountId: 'brok1' },
                { id: 'w3', name: 'Trad 401k', accountId: 'trad1' },
            ];
            const deficit = 50000;

            const result = estimateWithdrawalTax(
                deficit,
                accounts,
                withdrawalOrder,
                65,
                'Single',
                2040
            );

            // First $30k from savings (tax-free)
            // Remaining $20k from brokerage (some cap gains tax)
            // Nothing from Traditional
            expect(result.breakdown.savings).toBe(30000);
            expect(result.breakdown.brokerage).toBeGreaterThan(0);
            expect(result.breakdown.traditional).toBe(0);

            // Tax should only be on the brokerage portion
            // Much less than if we assumed all Traditional
            expect(result.estimatedTax).toBeLessThan(5000);
        });
    });

    describe('Roth withdrawals', () => {
        it('should estimate zero tax for Roth contribution withdrawals', () => {
            // Roth IRA with $100k balance, $80k costBasis (regular contributions)
            // regularContributions = costBasis - totalConversionBasis = 80000 - 0 = 80000
            const roth = new InvestedAccount(
                'roth1', 'Roth IRA', 100000,
                0, 0, 0, 'Roth IRA', true, 0.2,
                80000   // costBasis represents regular contributions for Roth
            );

            const accounts = [roth];
            const withdrawalOrder: WithdrawalBucket[] = [
                { id: 'w1', name: 'Roth IRA', accountId: 'roth1' },
            ];
            const deficit = 50000;

            const result = estimateWithdrawalTax(
                deficit,
                accounts,
                withdrawalOrder,
                39, // early, but contributions are tax-free
                'Single',
                2040
            );

            // Withdrawing contributions only ($50k < $80k contributions) - tax-free
            expect(result.estimatedTax).toBe(0);
            expect(result.breakdown.roth).toBe(50000);
        });
    });

    describe('Integration: matches actual simulation', () => {
        it('should estimate tax that closely matches final calculated tax', () => {
            // This test verifies the estimate is close to reality
            // The old system estimated $6k tax when actual was $0
            // The new system should estimate close to $0

            const savings1 = new SavedAccount('sav1', 'Checking', 600, 0.1);
            const savings2 = new SavedAccount('sav2', 'Group', 1100, 0.1);
            const brokerage = new InvestedAccount(
                'brok1', 'Brokerage', 555000,
                0, 0, 0, 'Brokerage', true, 0.2,
                100000  // costBasis (low basis = high gains ratio)
            );
            const accounts = [savings1, savings2, brokerage];

            const withdrawalOrder: WithdrawalBucket[] = [
                { id: 'w1', name: 'Checking', accountId: 'sav1' },
                { id: 'w2', name: 'Group', accountId: 'sav2' },
                { id: 'w3', name: 'Brokerage', accountId: 'brok1' },
            ];

            // Deficit ~$59k (living expenses)
            const deficit = 59111;

            const result = estimateWithdrawalTax(
                deficit,
                accounts,
                withdrawalOrder,
                39,
                'Single',
                2040
            );

            // Savings covers $1,751, brokerage covers rest (~$57k)
            // Brokerage gains ratio = (555000 - 100000) / 555000 = 82%
            // With 0% federal LTCG + 5% state on 82% gains = 4.1% effective rate
            // Tax on $57k = ~$2,400
            // Old estimate was $6,092 (all Traditional assumption)
            // New estimate should be much lower (no income tax, only cap gains)
            expect(result.estimatedTax).toBeLessThan(3000);

            // Gross withdrawal should be close to deficit (not inflated by phantom tax)
            expect(result.estimatedGrossWithdrawal).toBeLessThan(deficit * 1.1);
        });
    });
});
