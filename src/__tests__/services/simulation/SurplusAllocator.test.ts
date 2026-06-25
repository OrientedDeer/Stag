/**
 * Unit tests for SurplusAllocator.allocateSurplus().
 *
 * This module handles surplus cash allocation after expenses/taxes:
 * - Deficit debt paydown
 * - Priority bucket allocations (FIXED, MAX, REMAINDER, MULTIPLE_OF_EXPENSES)
 * - Roth IRA contribution limits
 * - Catch-all brokerage/savings allocation
 */
import { describe, it, expect } from 'vitest';
import { allocateSurplus, SurplusAllocationSettings } from '../../../services/simulation/SurplusAllocator';
import {
    SavedAccount,
    InvestedAccount,
    DeficitDebtAccount,
    DebtAccount,
} from '../../../components/Objects/Accounts/models';

function defaultSettings(overrides: Partial<SurplusAllocationSettings> = {}): SurplusAllocationSettings {
    return {
        emergencyFundTarget: 0,
        rothIRAContributionEnabled: true,
        rothIRALimit: 7000,
        rothIRAContributedThisYear: 0,
        ...overrides,
    };
}

describe('SurplusAllocator', () => {
    describe('deficit debt payment', () => {
        it('should pay down deficit debt first', () => {
            const deficitDebt = new DeficitDebtAccount('deficit', 'Deficit', 10000);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                50000,
                [deficitDebt, brokerage],
                [],
                0,
                defaultSettings()
            );

            expect(result.deficitDebtPayment).toBe(10000);
            // Remaining $40000 should be allocated (to catch-all brokerage)
            const brokerageAlloc = result.allocations.find(a => a.accountId === 'brok');
            expect(brokerageAlloc?.amount).toBe(40000);
        });

        it('should cap payment at available surplus', () => {
            const deficitDebt = new DeficitDebtAccount('deficit', 'Deficit', 50000);

            const result = allocateSurplus(
                20000,
                [deficitDebt],
                [],
                0,
                defaultSettings()
            );

            expect(result.deficitDebtPayment).toBe(20000);
        });

        it('should cap payment at debt amount', () => {
            const deficitDebt = new DeficitDebtAccount('deficit', 'Deficit', 5000);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                50000,
                [deficitDebt, brokerage],
                [],
                0,
                defaultSettings()
            );

            expect(result.deficitDebtPayment).toBe(5000);
            // $45000 remaining goes to brokerage
            const brokerageAlloc = result.allocations.find(a => a.accountId === 'brok');
            expect(brokerageAlloc?.amount).toBe(45000);
        });

        it('should include deficit payment in decisions', () => {
            const deficitDebt = new DeficitDebtAccount('deficit', 'Deficit', 5000);

            const result = allocateSurplus(
                50000,
                [deficitDebt],
                [],
                0,
                defaultSettings()
            );

            expect(result.decisions.some(d => d.description.includes('deficit debt'))).toBe(true);
        });
    });

    // Phase-1 (#60 C): surplus pays down user DebtAccounts that opt in via the
    // acceptsSurplusPaydown flag (default OFF). Routed after deficit debt and
    // before investing the remainder. Default-off keeps existing scenarios
    // byte-identical (surplus still flows to brokerage as before).
    //
    // Review fixes:
    //  [1] only UNLINKED debts (no linkedAccountId) are eligible — a debt backed
    //      by a LoanExpense accelerates via the loan's own extra_payment (feature
    //      B), so surplus paydown never double-drives a linked balance.
    //  [2] paydown is sized against the POST-interest balance amount*(1+apr/100),
    //      mirroring AccountGrowth (grow by APR, then subtract the inflow), so a
    //      debt the allocator reports as cleared actually reaches $0 at year-end.
    describe('flagged user-debt paydown', () => {
        it('DebtAccount defaults acceptsSurplusPaydown to false', () => {
            const debt = new DebtAccount('cc', 'Credit Card', 5000, '', 22);
            expect(debt.acceptsSurplusPaydown).toBe(false);
        });

        it('does NOT touch an unflagged debt — surplus still goes to brokerage (default-off)', () => {
            const debt = new DebtAccount('cc', 'Credit Card', 5000, '', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [],
                0,
                defaultSettings()
            );

            // No allocation aimed at the debt; full surplus reaches brokerage.
            expect(result.allocations.find(a => a.accountId === 'cc')).toBeUndefined();
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(10000);
        });

        it('routes surplus to a flagged debt after deficit, before brokerage', () => {
            const deficit = new DeficitDebtAccount('deficit', 'Deficit', 2000);
            // Unlinked card ([1]); $5000 @ 22% → post-interest balance $6100 ([2]).
            const debt = new DebtAccount('cc', 'Credit Card', 5000, '', 22);
            debt.acceptsSurplusPaydown = true;
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [deficit, debt, brokerage],
                [],
                0,
                defaultSettings()
            );

            // $2000 deficit, $6100 to fully clear the flagged card (post-interest),
            // $1900 leftover to brokerage.
            expect(result.deficitDebtPayment).toBe(2000);
            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBeCloseTo(6100, 6);
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBeCloseTo(1900, 6);
        });

        it('[2] sizes paydown at the post-interest balance so the debt clears to $0', () => {
            // $5000 @ 22% grows to $6100 before the inflow is applied. Funding it
            // with exactly $6100 must clear it (the old code emitted $5000 and left
            // ~$1100 owed after AccountGrowth grew the balance).
            const debt = new DebtAccount('cc', 'Credit Card', 5000, '', 22);
            debt.acceptsSurplusPaydown = true;
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                20000,
                [debt, brokerage],
                [],
                0,
                defaultSettings()
            );

            const grown = 5000 * 1.22; // 6100
            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBeCloseTo(grown, 6);
            // AccountGrowth: 6100 grown − 6100 inflow = $0 owed at year-end.
            expect(grown - (result.allocations.find(a => a.accountId === 'cc')?.amount ?? 0)).toBeCloseTo(0, 6);
        });

        it('[1] does NOT surplus-pay-down a LINKED (loan-backed) debt', () => {
            // A debt with a linkedAccountId is driven by its LoanExpense amortization
            // (and accelerated via the loan's extra_payment), so surplus must skip it
            // to avoid double-driving a stale account balance.
            const linkedDebt = new DebtAccount('loan-debt', 'Auto Loan', 5000, 'exp-auto', 6);
            linkedDebt.acceptsSurplusPaydown = true;
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [linkedDebt, brokerage],
                [],
                0,
                defaultSettings()
            );

            // Linked debt is skipped; full surplus reaches brokerage.
            expect(result.allocations.find(a => a.accountId === 'loan-debt')).toBeUndefined();
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(10000);
        });

        it('caps the paydown at the post-interest debt balance (no overpay)', () => {
            // $1500 @ 22% → post-interest $1830; surplus beyond that goes to brokerage.
            const debt = new DebtAccount('cc', 'Credit Card', 1500, '', 22);
            debt.acceptsSurplusPaydown = true;
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [],
                0,
                defaultSettings()
            );

            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBeCloseTo(1830, 6);
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBeCloseTo(8170, 6);
        });

        it('pays the highest-APR flagged debt first (avalanche within flagged set)', () => {
            const card = new DebtAccount('cc', 'Credit Card', 5000, '', 22);
            card.acceptsSurplusPaydown = true;
            const auto = new DebtAccount('auto', 'Auto Loan', 5000, '', 6);
            auto.acceptsSurplusPaydown = true;

            // Only $5000 surplus — entirely consumed by the highest-APR card
            // (whose post-interest balance is $6100, so it isn't even fully cleared);
            // the 6% debt gets nothing.
            const result = allocateSurplus(
                5000,
                [auto, card],
                [],
                0,
                defaultSettings()
            );

            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBe(5000);
            expect(result.allocations.find(a => a.accountId === 'auto')).toBeUndefined();
        });
    });

    describe('priority bucket caps', () => {
        it('should process priorities in order', () => {
            const savings1 = new SavedAccount('sav1', 'Emergency Fund', 1000, 4);
            const savings2 = new SavedAccount('sav2', 'Vacation Fund', 500, 2);

            const result = allocateSurplus(
                10000,
                [savings1, savings2],
                [
                    { accountId: 'sav1', priority: 1, capType: 'FIXED', capValue: 500 },
                    { accountId: 'sav2', priority: 2, capType: 'REMAINDER' },
                ],
                0,
                defaultSettings()
            );

            const sav1Alloc = result.allocations.find(a => a.accountId === 'sav1');
            const sav2Alloc = result.allocations.find(a => a.accountId === 'sav2');
            // FIXED $500/mo * 12 = $6000
            expect(sav1Alloc?.amount).toBe(6000);
            // REMAINDER = $10000 - $6000 = $4000
            expect(sav2Alloc?.amount).toBe(4000);
        });

        it('should handle FIXED cap type', () => {
            const savings = new SavedAccount('sav1', 'Emergency Fund', 1000, 4);

            const result = allocateSurplus(
                20000,
                [savings],
                [{ accountId: 'sav1', priority: 1, capType: 'FIXED', capValue: 1000 }],
                0,
                defaultSettings()
            );

            const sav1Alloc = result.allocations.find(a => a.accountId === 'sav1');
            // FIXED: $1000/mo * 12 = $12000
            expect(sav1Alloc?.amount).toBe(12000);
        });

        it('should handle REMAINDER cap type', () => {
            const savings = new SavedAccount('sav1', 'Emergency Fund', 1000, 4);

            const result = allocateSurplus(
                15000,
                [savings],
                [{ accountId: 'sav1', priority: 1, capType: 'REMAINDER' }],
                0,
                defaultSettings()
            );

            const sav1Alloc = result.allocations.find(a => a.accountId === 'sav1');
            // REMAINDER: takes all remaining cash
            expect(sav1Alloc?.amount).toBe(15000);
            expect(result.unallocated).toBe(0);
        });

        it('should handle MAX cap type', () => {
            const savings = new SavedAccount('sav1', 'Emergency Fund', 1000, 4);

            const result = allocateSurplus(
                20000,
                [savings],
                [{ accountId: 'sav1', priority: 1, capType: 'MAX', capValue: 5000 }],
                0,
                defaultSettings()
            );

            const sav1Alloc = result.allocations.find(a => a.accountId === 'sav1');
            // MAX: up to $5000 total
            expect(sav1Alloc?.amount).toBe(5000);
        });

        it('should handle MULTIPLE_OF_EXPENSES cap type', () => {
            const savings = new SavedAccount('sav1', 'Emergency Fund', 10000, 4);

            const result = allocateSurplus(
                50000,
                [savings],
                [{ accountId: 'sav1', priority: 1, capType: 'MULTIPLE_OF_EXPENSES', capValue: 6 }],
                0,
                defaultSettings({ monthlyExpenses: 5000 })
            );

            // Target: 6 * $5000 = $30000
            // Current: $10000
            // Needed: $20000
            const sav1Alloc = result.allocations.find(a => a.accountId === 'sav1');
            expect(sav1Alloc?.amount).toBe(20000);
        });

        it('should allocate to brokerage via priority bucket', () => {
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                20000,
                [brokerage],
                [{ accountId: 'brok', priority: 1, capType: 'MAX', capValue: 10000 }],
                0,
                defaultSettings()
            );

            const brokAlloc = result.allocations.find(a => a.accountId === 'brok');
            expect(brokAlloc?.amount).toBe(10000);
        });
    });

    describe('Roth IRA contribution limits', () => {
        it('should block Roth IRA contribution without earned income', () => {
            const rothIRA = new InvestedAccount('ira-1', 'Roth IRA', 10000, 0, 0, 0.1, 'Roth IRA');

            const result = allocateSurplus(
                20000,
                [rothIRA],
                [{ accountId: 'ira-1', priority: 1, capType: 'MAX', capValue: 7000 }],
                0, // No earned income
                defaultSettings()
            );

            const iraAlloc = result.allocations.find(a => a.accountId === 'ira-1');
            expect(iraAlloc).toBeUndefined();
            expect(result.decisions.some(d => d.description.includes('no earned income'))).toBe(true);
        });

        it('should cap Roth IRA at earned income when below limit', () => {
            const rothIRA = new InvestedAccount('ira-1', 'Roth IRA', 10000, 0, 0, 0.1, 'Roth IRA');

            const result = allocateSurplus(
                20000,
                [rothIRA],
                [{ accountId: 'ira-1', priority: 1, capType: 'MAX', capValue: 7000 }],
                3000, // Only $3000 earned income
                defaultSettings()
            );

            const iraAlloc = result.allocations.find(a => a.accountId === 'ira-1');
            expect(iraAlloc?.amount).toBe(3000);
        });

        it('should allow full Roth IRA contribution with sufficient earned income', () => {
            const rothIRA = new InvestedAccount('ira-1', 'Roth IRA', 10000, 0, 0, 0.1, 'Roth IRA');

            const result = allocateSurplus(
                20000,
                [rothIRA],
                [{ accountId: 'ira-1', priority: 1, capType: 'MAX', capValue: 7000 }],
                50000, // Plenty of earned income
                defaultSettings()
            );

            const iraAlloc = result.allocations.find(a => a.accountId === 'ira-1');
            expect(iraAlloc?.amount).toBe(7000);
        });

        it('should enforce annual Roth IRA limit', () => {
            const rothIRA = new InvestedAccount('ira-1', 'Roth IRA', 10000, 0, 0, 0.1, 'Roth IRA');

            // Try to contribute $10000 (exceeds $7000 limit)
            const result = allocateSurplus(
                20000,
                [rothIRA],
                [{ accountId: 'ira-1', priority: 1, capType: 'MAX', capValue: 10000 }],
                50000,
                defaultSettings()
            );

            const iraAlloc = result.allocations.find(a => a.accountId === 'ira-1');
            expect(iraAlloc?.amount).toBeLessThanOrEqual(7000);
        });

        it('should allow catch-up contributions with higher limit', () => {
            const rothIRA = new InvestedAccount('ira-1', 'Roth IRA', 10000, 0, 0, 0.1, 'Roth IRA');

            // Age 50+ limit = $8000
            const result = allocateSurplus(
                20000,
                [rothIRA],
                [{ accountId: 'ira-1', priority: 1, capType: 'MAX', capValue: 8000 }],
                100000,
                defaultSettings({ rothIRALimit: 8000 })
            );

            const iraAlloc = result.allocations.find(a => a.accountId === 'ira-1');
            expect(iraAlloc?.amount).toBe(8000);
        });
    });

    describe('catch-all allocation', () => {
        it('should send remaining surplus to brokerage when no priority buckets', () => {
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                15000,
                [brokerage],
                [],
                0,
                defaultSettings()
            );

            const brokAlloc = result.allocations.find(a => a.accountId === 'brok');
            expect(brokAlloc?.amount).toBe(15000);
            expect(result.unallocated).toBe(0);
        });

        it('should send remaining to savings when no brokerage available', () => {
            const savings = new SavedAccount('sav', 'Savings', 5000, 4.5);

            const result = allocateSurplus(
                10000,
                [savings],
                [],
                0,
                defaultSettings({ emergencyFundTarget: 0 })
            );

            const savAlloc = result.allocations.find(a => a.accountId === 'sav');
            expect(savAlloc?.amount).toBe(10000);
        });
    });

    describe('capped-bucket surplus is paced, not force-deposited (review #2)', () => {
        it('respects a FIXED cap and surfaces the excess as unallocated rather than overfilling', () => {
            // A single FIXED-cap brokerage bucket ($24k/yr cap) with $30k surplus.
            // The $6k beyond the cap is discretionary spending, NOT force-deposited
            // into the capped account (that would break the cap). It is reported as
            // `unallocated` so the caller/UI can account for it.
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                30000,
                [brokerage],
                [{ accountId: 'brok', priority: 1, capType: 'FIXED', capValue: 2000 }], // $2000/mo = $24k/yr
                0,
                defaultSettings()
            );

            const total = result.allocations
                .filter(a => a.accountId === 'brok')
                .reduce((sum, a) => sum + a.amount, 0);
            expect(total).toBe(24000);          // capped, not 30000
            expect(result.unallocated).toBe(6000); // excess surfaced, not silently lost
        });
    });

    describe('non-IRA accounts', () => {
        it('should allow Savings contributions without earned income', () => {
            const savings = new SavedAccount('sav-1', 'Emergency Fund', 10000, 1.5);

            const result = allocateSurplus(
                20000,
                [savings],
                [{ accountId: 'sav-1', priority: 1, capType: 'MAX', capValue: 10000 }],
                0, // No earned income
                defaultSettings()
            );

            const savAlloc = result.allocations.find(a => a.accountId === 'sav-1');
            expect(savAlloc?.amount).toBe(10000);
        });

        it('should allow Brokerage contributions without earned income', () => {
            const brokerage = new InvestedAccount('brok-1', 'Brokerage', 10000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                20000,
                [brokerage],
                [{ accountId: 'brok-1', priority: 1, capType: 'MAX', capValue: 5000 }],
                0, // No earned income
                defaultSettings()
            );

            const brokAlloc = result.allocations.find(a => a.accountId === 'brok-1');
            expect(brokAlloc?.amount).toBe(5000);
        });
    });
});
