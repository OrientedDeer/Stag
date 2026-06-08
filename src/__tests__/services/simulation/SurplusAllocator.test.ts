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
