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
import {
    allocateSurplus,
    SurplusAllocationSettings,
    isSurplusPaydownDebt,
    postInterestDebtBalance,
} from '../../../services/simulation/SurplusAllocator';
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

    // #60 C (redesign): an UNLINKED DebtAccount is paid down when it appears as
    // an item in the user's PRIORITY LIST — the order is 100% user-decided (no
    // hardcoded avalanche). A debt bucket pays its POST-interest balance
    // (amount*(1+apr/100), mirroring AccountGrowth) so it clears to $0, capped at
    // remaining surplus. Linked debts (accelerate via feature B) and the system
    // DeficitDebt are never paid down here. With NO debt in priorities, behavior
    // is byte-identical to before.
    describe('debt paydown as a priority bucket', () => {
        it('pays down a debt placed in the priority list, before lower buckets', () => {
            // $5000 @ 22% → post-interest $6100. Debt ranked above brokerage.
            const debt = new DebtAccount('cc', 'Credit Card', 5000, '', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [
                    { accountId: 'cc', priority: 1 },
                    { accountId: 'brok', priority: 2, capType: 'REMAINDER' },
                ],
                0,
                defaultSettings()
            );

            // $6100 clears the card; $3900 remainder to brokerage.
            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBeCloseTo(6100, 6);
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBeCloseTo(3900, 6);
        });

        it('respects user order: a debt ranked BELOW a remainder bucket gets nothing', () => {
            const debt = new DebtAccount('cc', 'Credit Card', 5000, '', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            // Brokerage REMAINDER ranked first — takes everything; debt below gets $0.
            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [
                    { accountId: 'brok', priority: 1, capType: 'REMAINDER' },
                    { accountId: 'cc', priority: 2 },
                ],
                0,
                defaultSettings()
            );

            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(10000);
            expect(result.allocations.find(a => a.accountId === 'cc')).toBeUndefined();
        });

        it('sizes the paydown at the post-interest balance so the debt clears to $0', () => {
            const debt = new DebtAccount('cc', 'Credit Card', 5000, '', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                20000,
                [debt, brokerage],
                [{ accountId: 'cc', priority: 1 }, { accountId: 'brok', priority: 2, capType: 'REMAINDER' }],
                0,
                defaultSettings()
            );

            const grown = 5000 * 1.22; // 6100 — exactly what AccountGrowth needs to reach $0
            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBeCloseTo(grown, 6);
        });

        it('caps the paydown at the post-interest balance (no overpay)', () => {
            // $1500 @ 22% → post-interest $1830; remainder to brokerage.
            const debt = new DebtAccount('cc', 'Credit Card', 1500, '', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [{ accountId: 'cc', priority: 1 }, { accountId: 'brok', priority: 2, capType: 'REMAINDER' }],
                0,
                defaultSettings()
            );

            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBeCloseTo(1830, 6);
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBeCloseTo(8170, 6);
        });

        it('honors avalanche ordering ONLY when the user sets it (high-APR debt ranked first)', () => {
            const card = new DebtAccount('cc', 'Credit Card', 5000, '', 22);
            const auto = new DebtAccount('auto', 'Auto Loan', 5000, '', 6);

            // User ranks the 22% card first, the 6% auto second. $5000 surplus is
            // consumed by the card (post-interest $6100, not even fully cleared);
            // the auto gets nothing — because the USER ordered it that way.
            const result = allocateSurplus(
                5000,
                [auto, card],
                [
                    { accountId: 'cc', priority: 1 },
                    { accountId: 'auto', priority: 2 },
                ],
                0,
                defaultSettings()
            );

            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBe(5000);
            expect(result.allocations.find(a => a.accountId === 'auto')).toBeUndefined();
        });

        it('never pays down a LINKED (loan-backed) debt, even if placed in priorities', () => {
            const linkedDebt = new DebtAccount('loan-debt', 'Auto Loan', 5000, 'exp-auto', 6);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [linkedDebt, brokerage],
                [
                    { accountId: 'loan-debt', priority: 1 },
                    { accountId: 'brok', priority: 2, capType: 'REMAINDER' },
                ],
                0,
                defaultSettings()
            );

            // Linked debt bucket is skipped; surplus falls through to brokerage.
            expect(result.allocations.find(a => a.accountId === 'loan-debt')).toBeUndefined();
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(10000);
        });

        it('default-off: NO debt in priorities → debt untouched, surplus to brokerage', () => {
            const debt = new DebtAccount('cc', 'Credit Card', 5000, '', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            // Debt account exists but is NOT in the priority list.
            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [{ accountId: 'brok', priority: 1, capType: 'REMAINDER' }],
                0,
                defaultSettings()
            );

            expect(result.allocations.find(a => a.accountId === 'cc')).toBeUndefined();
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(10000);
        });

        it('paydown strings show the actual payment in whole dollars (no fractional cents, no overstatement)', () => {
            // Partial paydown: $5000 @ 22% (grows to $6100) but only $2000 surplus.
            const debt = new DebtAccount('cc', 'Credit Card', 5000, '', 22);

            const result = allocateSurplus(
                2000,
                [debt],
                [{ accountId: 'cc', priority: 1 }],
                0,
                defaultSettings()
            );

            const alloc = result.allocations.find(a => a.accountId === 'cc');
            const decision = result.decisions.find(d => d.account === 'Credit Card');
            expect(alloc?.amount).toBe(2000);

            // Shows the ACTUAL $2,000 paid, never the overstated $6,100 grown balance.
            expect(alloc?.reason).toContain('2,000');
            expect(alloc?.reason).not.toContain('6,100');
            expect(decision?.description).toContain('2,000');

            // No fractional cents in any dollar figure.
            const hasFractionalDollars = (s: string | undefined) =>
                s !== undefined && /\$[\d,]+\.\d/.test(s);
            expect(hasFractionalDollars(alloc?.reason)).toBe(false);
            expect(hasFractionalDollars(decision?.description)).toBe(false);
        });

        it('the system DeficitDebt is still paid first (step 1), not via a debt bucket', () => {
            const deficit = new DeficitDebtAccount('deficit', 'Deficit', 2000);
            const debt = new DebtAccount('cc', 'Credit Card', 5000, '', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [deficit, debt, brokerage],
                [
                    { accountId: 'cc', priority: 1 },
                    { accountId: 'brok', priority: 2, capType: 'REMAINDER' },
                ],
                0,
                defaultSettings()
            );

            // $2000 deficit (step 1), then $6100 to the card bucket, $1900 to brokerage.
            expect(result.deficitDebtPayment).toBe(2000);
            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBeCloseTo(6100, 6);
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBeCloseTo(1900, 6);
        });
    });

    // Review-3 [9]: the engine and the PriorityTab preview share ONE eligibility
    // predicate + post-interest sizing, so they can't drift. These pin the shared
    // exports the UI imports.
    describe('shared debt-paydown predicate (engine ↔ preview)', () => {
        it('isSurplusPaydownDebt classifies unlinked/linked/deficit/zero correctly', () => {
            expect(isSurplusPaydownDebt(new DebtAccount('cc', 'Card', 5000, '', 22))).toBe(true);
            // linked → false
            expect(isSurplusPaydownDebt(new DebtAccount('l', 'Loan', 5000, 'exp-x', 6))).toBe(false);
            // deficit → false
            expect(isSurplusPaydownDebt(new DeficitDebtAccount('d', 'Deficit', 5000))).toBe(false);
            // zero balance → false
            expect(isSurplusPaydownDebt(new DebtAccount('z', 'Paid', 0, '', 22))).toBe(false);
            // non-debt → false
            expect(isSurplusPaydownDebt(new InvestedAccount('b', 'Brok', 1000, 0, 0, 0.1, 'Brokerage'))).toBe(false);
            expect(isSurplusPaydownDebt(undefined)).toBe(false);
        });

        it('the engine spends exactly postInterestDebtBalance (what the preview sizes)', () => {
            const debt = new DebtAccount('cc', 'Credit Card', 5000, '', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                20000,
                [debt, brokerage],
                [{ accountId: 'cc', priority: 1 }, { accountId: 'brok', priority: 2, capType: 'REMAINDER' }],
                0,
                defaultSettings()
            );

            // The amount the engine allocates to clear the debt == the figure the
            // preview displays (postInterestDebtBalance). Same source of truth.
            expect(result.allocations.find(a => a.accountId === 'cc')?.amount)
                .toBeCloseTo(postInterestDebtBalance(debt), 6);
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
