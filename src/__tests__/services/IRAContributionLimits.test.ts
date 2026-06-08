/**
 * Tests for IRA contribution limits enforced by SurplusAllocator.
 *
 * In V2, IRA contribution limits (earned income validation, annual caps,
 * catch-up contributions) are enforced by SurplusAllocator.allocateSurplus()
 * for Roth IRA priority buckets. Traditional IRA contributions are handled
 * via payroll (processInflows), not surplus allocation.
 */
import { describe, it, expect } from 'vitest';
import { allocateSurplus, SurplusAllocationSettings } from '../../services/simulation/SurplusAllocator';
import { InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';

function defaultSettings(overrides: Partial<SurplusAllocationSettings> = {}): SurplusAllocationSettings {
    return {
        emergencyFundTarget: 0,
        rothIRAContributionEnabled: true,
        rothIRALimit: 7000,
        rothIRAContributedThisYear: 0,
        ...overrides,
    };
}

describe('IRA Contribution Earned Income Validation', () => {
    describe('blocks contributions without earned income', () => {
        it('blocks Roth IRA contribution when no earned income exists', () => {
            const rothIRA = new InvestedAccount(
                'ira-1', 'Roth IRA', 10000, 0, 0, 0.1,
                'Roth IRA', true, 0
            );

            const result = allocateSurplus(
                20000,
                [rothIRA],
                [{ accountId: 'ira-1', priority: 1, capType: 'MAX', capValue: 7000 }],
                0, // No earned income
                defaultSettings()
            );

            // IRA contribution should be blocked (0 earned income)
            const iraAlloc = result.allocations.find(a => a.accountId === 'ira-1');
            expect(iraAlloc).toBeUndefined();
            expect(result.decisions.some(d => d.description.includes('no earned income'))).toBe(true);
        });

        it('does not allocate to Traditional IRA via surplus (handled by payroll)', () => {
            const tradIRA = new InvestedAccount(
                'ira-1', 'Traditional IRA', 10000, 0, 0, 0.1,
                'Traditional IRA', true, 0
            );

            const result = allocateSurplus(
                20000,
                [tradIRA],
                [{ accountId: 'ira-1', priority: 1, capType: 'MAX', capValue: 7000 }],
                50000, // Has earned income
                defaultSettings()
            );

            // Traditional IRA is not handled by surplus allocation
            const iraAlloc = result.allocations.find(a => a.accountId === 'ira-1');
            expect(iraAlloc).toBeUndefined();
        });
    });

    describe('caps contributions at earned income', () => {
        it('caps Roth IRA contribution at earned income when earned income < IRA limit', () => {
            const rothIRA = new InvestedAccount(
                'ira-1', 'Roth IRA', 10000, 0, 0, 0.1,
                'Roth IRA', true, 0
            );

            const result = allocateSurplus(
                20000,
                [rothIRA],
                [{ accountId: 'ira-1', priority: 1, capType: 'MAX', capValue: 7000 }],
                3000, // Only $3000 earned income
                defaultSettings()
            );

            // Should be capped at earned income ($3000), not IRA limit ($7000)
            const iraAlloc = result.allocations.find(a => a.accountId === 'ira-1');
            expect(iraAlloc?.amount).toBe(3000);
        });

        it('allows full contribution when earned income >= IRA limit', () => {
            const rothIRA = new InvestedAccount(
                'ira-1', 'Roth IRA', 10000, 0, 0, 0.1,
                'Roth IRA', true, 0
            );

            const result = allocateSurplus(
                20000,
                [rothIRA],
                [{ accountId: 'ira-1', priority: 1, capType: 'MAX', capValue: 7000 }],
                50000, // Plenty of earned income
                defaultSettings()
            );

            // Full IRA limit should be contributed
            const iraAlloc = result.allocations.find(a => a.accountId === 'ira-1');
            expect(iraAlloc?.amount).toBe(7000);
        });
    });

    describe('enforces annual contribution limit', () => {
        it('caps Roth IRA at annual limit even with higher bucket cap', () => {
            const rothIRA = new InvestedAccount(
                'ira-1', 'Roth IRA', 10000, 0, 0, 0.1,
                'Roth IRA', true, 0
            );

            // Try to contribute $10000 (exceeds $7000 annual limit)
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
    });

    describe('does not affect non-IRA accounts', () => {
        it('allows Savings contributions without earned income', () => {
            const savings = new SavedAccount('sav-1', 'Emergency Fund', 10000, 1.5);

            const result = allocateSurplus(
                20000,
                [savings],
                [{ accountId: 'sav-1', priority: 1, capType: 'MAX', capValue: 10000 }],
                0, // No earned income
                defaultSettings()
            );

            // Savings should receive contribution regardless of earned income
            const savAlloc = result.allocations.find(a => a.accountId === 'sav-1');
            expect(savAlloc?.amount).toBe(10000);
        });

        it('allows Brokerage contributions without earned income', () => {
            const brokerage = new InvestedAccount(
                'brok-1', 'Brokerage', 10000, 0, 0, 0.1,
                'Brokerage', true, 0
            );

            const result = allocateSurplus(
                20000,
                [brokerage],
                [{ accountId: 'brok-1', priority: 1, capType: 'MAX', capValue: 5000 }],
                0, // No earned income
                defaultSettings()
            );

            // Brokerage should receive contribution
            const brokAlloc = result.allocations.find(a => a.accountId === 'brok-1');
            expect(brokAlloc?.amount).toBe(5000);
        });
    });

    describe('handles catch-up contributions', () => {
        it('allows catch-up IRA contributions for age 50+', () => {
            const rothIRA = new InvestedAccount(
                'ira-1', 'Roth IRA', 10000, 0, 0, 0.1,
                'Roth IRA', true, 0
            );

            // Age 50+ gets $8000 limit (base $7000 + $1000 catch-up)
            const result = allocateSurplus(
                20000,
                [rothIRA],
                [{ accountId: 'ira-1', priority: 1, capType: 'MAX', capValue: 8000 }],
                100000,
                defaultSettings({ rothIRALimit: 8000 }) // Age 50+ limit
            );

            // Should allow $8000
            const iraAlloc = result.allocations.find(a => a.accountId === 'ira-1');
            expect(iraAlloc?.amount).toBe(8000);
        });
    });
});
