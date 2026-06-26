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
    isOfferableDebt,
    isSurplusPaydownDebt,
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

    // #60 (linked-debt rework): a DebtAccount is paid down when it appears in the
    // user's PRIORITY LIST. Every debt is a LoanExpense↔DebtAccount pair, so
    // LINKED debts are exactly what's eligible. The per-year cap is the linked
    // loan's post-amortization balance, supplied by the SOLVER via
    // settings.debtPaydownCaps (allocateSurplus can't see the expense). The
    // engine applies the paydown to the LoanExpense. allocateSurplus just sizes
    // min(remaining, cap) and lets excess flow to lower buckets. With NO debt in
    // priorities (or no cap), behavior is byte-identical to before.
    describe('debt paydown as a priority bucket', () => {
        it('pays down a debt placed in the priority list, before lower buckets', () => {
            const debt = new DebtAccount('cc', 'Credit Card', 5000, 'exp-cc', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [
                    { accountId: 'cc', priority: 1 },
                    { accountId: 'brok', priority: 2, capType: 'REMAINDER' },
                ],
                0,
                defaultSettings({ debtPaydownCaps: { cc: 5000 } }) // loan balance
            );

            // $5000 pays the loan to $0; $5000 remainder to brokerage.
            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBe(5000);
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(5000);
        });

        it('respects user order: a debt ranked BELOW a remainder bucket gets nothing', () => {
            const debt = new DebtAccount('cc', 'Credit Card', 5000, 'exp-cc', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [
                    { accountId: 'brok', priority: 1, capType: 'REMAINDER' },
                    { accountId: 'cc', priority: 2 },
                ],
                0,
                defaultSettings({ debtPaydownCaps: { cc: 5000 } })
            );

            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(10000);
            expect(result.allocations.find(a => a.accountId === 'cc')).toBeUndefined();
        });

        it('caps the paydown at the loan balance (excess flows to the next bucket)', () => {
            const debt = new DebtAccount('cc', 'Credit Card', 1500, 'exp-cc', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [{ accountId: 'cc', priority: 1 }, { accountId: 'brok', priority: 2, capType: 'REMAINDER' }],
                0,
                defaultSettings({ debtPaydownCaps: { cc: 1500 } })
            );

            // Capped at the $1500 balance; $8500 excess to brokerage.
            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBe(1500);
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(8500);
        });

        it('pays a LINKED debt (the normal case — every debt is a loan pair)', () => {
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
                defaultSettings({ debtPaydownCaps: { 'loan-debt': 5000 } })
            );

            // Linked debt IS paid now (the whole point of the rework).
            expect(result.allocations.find(a => a.accountId === 'loan-debt')?.amount).toBe(5000);
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(5000);
        });

        it('[0]/[1] gates on the loan CAP, not the mirror: a $0-mirror/owing-loan debt is still paid', () => {
            // The DebtAccount MIRROR is $0 (stale/imported) but the linked LOAN
            // still owes $5000 (the solver-supplied cap). The allocator must emit
            // the paydown based on the CAP, not the mirror balance. Pre-fix the
            // gate read the mirror (isSurplusPaydownDebt → account.amount > eps) and
            // dropped the allocation entirely.
            const staleMirror = new DebtAccount('loan-debt', 'Auto Loan', 0, 'exp-auto', 6); // mirror $0
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [staleMirror, brokerage],
                [
                    { accountId: 'loan-debt', priority: 1 },
                    { accountId: 'brok', priority: 2, capType: 'REMAINDER' },
                ],
                0,
                defaultSettings({ debtPaydownCaps: { 'loan-debt': 5000 } }) // loan owes $5000
            );

            // The paydown IS emitted (sized by the cap), despite the $0 mirror.
            expect(result.allocations.find(a => a.accountId === 'loan-debt')?.amount).toBe(5000);
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(5000);
        });

        it('[5] a sub-cent residual cap emits NO microscopic paydown', () => {
            // After an earlier bucket fully paid the debt, debtCap − debtPaidSoFar
            // can be ~1e-9 > 0. The 2nd bucket must NOT emit a "$0 paid" allocation.
            const debt = new DebtAccount('cc', 'Card', 2000, 'exp-cc', 18);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [
                    { accountId: 'cc', priority: 1 },
                    { accountId: 'cc', priority: 2 }, // duplicate — would see ~0 cap
                    { accountId: 'brok', priority: 3, capType: 'REMAINDER' },
                ],
                0,
                defaultSettings({ debtPaydownCaps: { cc: 2000 } })
            );

            // Exactly ONE debt allocation (the 2nd sees a sub-epsilon cap → skipped).
            expect(result.allocations.filter(a => a.accountId === 'cc')).toHaveLength(1);
            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBe(2000);
        });

        it('[0] a DUPLICATE debt bucket does NOT over-consume surplus (no leak to lower buckets)', () => {
            // A debt in TWO buckets must total at most its cap ($2000), and the
            // leftover surplus must reach the lower brokerage bucket IN FULL — no
            // surplus vanishes. (Pre-fix the allocator emitted $2000 twice and
            // deducted $4000 from `remaining`, so $2000 leaked: brokerage got only
            // $6000 of the $8000 it should have.)
            const debt = new DebtAccount('cc', 'Card', 2000, 'exp-cc', 18);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [
                    { accountId: 'cc', priority: 1 },
                    { accountId: 'cc', priority: 2 },
                    { accountId: 'brok', priority: 3, capType: 'REMAINDER' },
                ],
                0,
                defaultSettings({ debtPaydownCaps: { cc: 2000 } })
            );

            // The debt is paid AT MOST its cap across all its buckets.
            const ccTotal = result.allocations
                .filter(a => a.accountId === 'cc')
                .reduce((s, a) => s + a.amount, 0);
            expect(ccTotal).toBe(2000);

            // CRUX: the leftover $8000 reaches the brokerage IN FULL — nothing leaked.
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(8000);

            // And the whole $10k surplus is accounted for (debt + brokerage).
            const totalAllocated = result.allocations.reduce((s, a) => s + a.amount, 0);
            expect(totalAllocated).toBe(10000);
        });

        it('honors avalanche ordering ONLY when the user sets it (high-APR debt ranked first)', () => {
            const card = new DebtAccount('cc', 'Credit Card', 5000, 'exp-cc', 22);
            const auto = new DebtAccount('auto', 'Auto Loan', 5000, 'exp-auto', 6);

            // User ranks the 22% card first; $5000 surplus clears it; auto gets $0.
            const result = allocateSurplus(
                5000,
                [auto, card],
                [
                    { accountId: 'cc', priority: 1 },
                    { accountId: 'auto', priority: 2 },
                ],
                0,
                defaultSettings({ debtPaydownCaps: { cc: 5000, auto: 5000 } })
            );

            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBe(5000);
            expect(result.allocations.find(a => a.accountId === 'auto')).toBeUndefined();
        });

        it('default-off: NO debt in priorities → debt untouched, surplus to brokerage', () => {
            const debt = new DebtAccount('cc', 'Credit Card', 5000, 'exp-cc', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [{ accountId: 'brok', priority: 1, capType: 'REMAINDER' }],
                0,
                defaultSettings({ debtPaydownCaps: { cc: 5000 } }) // cap present but not in priorities
            );

            expect(result.allocations.find(a => a.accountId === 'cc')).toBeUndefined();
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(10000);
        });

        it('no cap supplied → debt bucket pays nothing (surplus flows past it)', () => {
            const debt = new DebtAccount('cc', 'Credit Card', 5000, 'exp-cc', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [debt, brokerage],
                [{ accountId: 'cc', priority: 1 }, { accountId: 'brok', priority: 2, capType: 'REMAINDER' }],
                0,
                defaultSettings() // no debtPaydownCaps
            );

            expect(result.allocations.find(a => a.accountId === 'cc')).toBeUndefined();
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(10000);
        });

        it('paydown strings show the actual payment in whole dollars (no fractional cents)', () => {
            // Partial paydown: $2000 surplus against a $5000 loan cap.
            const debt = new DebtAccount('cc', 'Credit Card', 5000, 'exp-cc', 22);

            const result = allocateSurplus(
                2000,
                [debt],
                [{ accountId: 'cc', priority: 1 }],
                0,
                defaultSettings({ debtPaydownCaps: { cc: 5000 } })
            );

            const alloc = result.allocations.find(a => a.accountId === 'cc');
            const decision = result.decisions.find(d => d.account === 'Credit Card');
            expect(alloc?.amount).toBe(2000);
            expect(alloc?.reason).toContain('2,000');
            expect(decision?.description).toContain('2,000');

            const hasFractionalDollars = (s: string | undefined) =>
                s !== undefined && /\$[\d,]+\.\d/.test(s);
            expect(hasFractionalDollars(alloc?.reason)).toBe(false);
            expect(hasFractionalDollars(decision?.description)).toBe(false);
        });

        it('the system DeficitDebt is still paid first (step 1), not via a debt bucket', () => {
            const deficit = new DeficitDebtAccount('deficit', 'Deficit', 2000);
            const debt = new DebtAccount('cc', 'Credit Card', 5000, 'exp-cc', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [deficit, debt, brokerage],
                [
                    { accountId: 'cc', priority: 1 },
                    { accountId: 'brok', priority: 2, capType: 'REMAINDER' },
                ],
                0,
                defaultSettings({ debtPaydownCaps: { cc: 5000 } })
            );

            // $2000 deficit (step 1), then $5000 to the card bucket, $3000 to brokerage.
            expect(result.deficitDebtPayment).toBe(2000);
            expect(result.allocations.find(a => a.accountId === 'cc')?.amount).toBe(5000);
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(3000);
        });
    });

    describe('debt-paydown predicates (#60 linked-debt rework)', () => {
        it('isSurplusPaydownDebt: LINKED debts eligible; UNLINKED/deficit/sub-cent/non-debt are not', () => {
            // Eligible: a linked debt with a real balance.
            expect(isSurplusPaydownDebt(new DebtAccount('cc', 'Card', 5000, 'exp-cc', 22))).toBe(true);
            expect(isSurplusPaydownDebt(new DebtAccount('l', 'Loan', 5000, 'exp-x', 6))).toBe(true);
            // [1] UNLINKED debt (no backing loan) → false (would be offered but never paid).
            expect(isSurplusPaydownDebt(new DebtAccount('u', 'Unlinked', 5000, '', 22))).toBe(false);
            // deficit → false
            expect(isSurplusPaydownDebt(new DeficitDebtAccount('d', 'Deficit', 5000))).toBe(false);
            // zero balance → false
            expect(isSurplusPaydownDebt(new DebtAccount('z', 'Paid', 0, 'exp-z', 22))).toBe(false);
            // [5] sub-cent residual → false (treated as paid off).
            expect(isSurplusPaydownDebt(new DebtAccount('r', 'Residual', 0.0001, 'exp-r', 22))).toBe(false);
            // non-debt → false
            expect(isSurplusPaydownDebt(new InvestedAccount('b', 'Brok', 1000, 0, 0, 0.1, 'Brokerage'))).toBe(false);
            expect(isSurplusPaydownDebt(undefined)).toBe(false);
        });

        it('[1] isOfferableDebt requires a backing loan: linked offered, UNLINKED/deficit not', () => {
            const zeroLinkedCard = new DebtAccount('z', 'Paid Card', 0, 'exp-z', 22);
            expect(isOfferableDebt(zeroLinkedCard)).toBe(true);    // linked, offerable even at $0
            expect(isSurplusPaydownDebt(zeroLinkedCard)).toBe(false); // but not paid

            expect(isOfferableDebt(new DebtAccount('l', 'Loan', 5000, 'exp-x', 6))).toBe(true); // linked offerable
            // [1] an UNLINKED debt (no backing LoanExpense) is NOT offered.
            expect(isOfferableDebt(new DebtAccount('u', 'Unlinked', 5000, '', 22))).toBe(false);
            expect(isOfferableDebt(new DeficitDebtAccount('d', 'Deficit', 5000))).toBe(false);
            expect(isOfferableDebt(new SavedAccount('s', 'Savings', 100))).toBe(false);
            expect(isOfferableDebt(undefined)).toBe(false);
        });

        it('the engine does not pay a $0-balance debt bucket (surplus flows past it)', () => {
            const zeroCard = new DebtAccount('z', 'Paid Card', 0, 'exp-z', 22);
            const brokerage = new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

            const result = allocateSurplus(
                10000,
                [zeroCard, brokerage],
                [{ accountId: 'z', priority: 1 }, { accountId: 'brok', priority: 2, capType: 'REMAINDER' }],
                0,
                defaultSettings({ debtPaydownCaps: { z: 0 } })
            );

            expect(result.allocations.find(a => a.accountId === 'z')).toBeUndefined();
            expect(result.allocations.find(a => a.accountId === 'brok')?.amount).toBe(10000);
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
