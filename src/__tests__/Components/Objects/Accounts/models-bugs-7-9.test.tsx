/**
 * Regression tests for confirmed bugs in Accounts/models.tsx
 *
 * Finding 7: PropertyAccount drops `apr` on increment AND reconstitute
 * Finding 9: reconstituteAccount coerces customROR null → 0 instead of undefined
 */
import { describe, it, expect } from 'vitest';
import {
    PropertyAccount,
    InvestedAccount,
    ESPPAccount,
    reconstituteAccount,
} from '../../../../components/Objects/Accounts/models';
import { defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';

// Minimal assumptions sufficient for PropertyAccount.increment
const mockAssumptions = {
    ...defaultAssumptions,
    macro: {
        ...defaultAssumptions.macro,
        inflationRate: 3,
        inflationAdjusted: false,
    },
    expenses: {
        ...defaultAssumptions.expenses,
        housingAppreciation: 5,
    },
};

// ─── Finding 7 ────────────────────────────────────────────────────────────────

describe('Finding 7 – PropertyAccount preserves apr', () => {
    it('increment: apr is carried through to the returned instance', () => {
        const acc = new PropertyAccount('p1', 'My Home', 500_000, 'Financed', 400_000, 400_000, 'm1', 5);

        const next = acc.increment(mockAssumptions);

        // BUG: before fix, next.apr would be 0 (default, because 8th arg was omitted)
        expect(next.apr).toBe(5);
    });

    it('increment with override: apr is still preserved', () => {
        const acc = new PropertyAccount('p1', 'My Home', 500_000, 'Financed', 400_000, 400_000, 'm1', 7.25);

        const next = acc.increment(mockAssumptions, { newValue: 510_000, newLoanBalance: 395_000 });

        expect(next.apr).toBe(7.25);
    });

    it('reconstitute: apr is restored from serialized data', () => {
        const serialized = {
            className: 'PropertyAccount',
            id: 'p2',
            name: 'Beach House',
            amount: 800_000,
            ownershipType: 'Financed',
            loanAmount: 600_000,
            startingLoanBalance: 620_000,
            linkedAccountId: 'loan-99',
            apr: 5,
        };

        const result = reconstituteAccount(serialized) as PropertyAccount;

        // BUG: before fix, result.apr would be 0 because the 8th arg was missing
        expect(result).not.toBeNull();
        expect(result.apr).toBe(5);
    });

    it('reconstitute: fractional apr round-trips correctly', () => {
        const serialized = {
            className: 'PropertyAccount',
            id: 'p3',
            name: 'Rental',
            amount: 300_000,
            ownershipType: 'Financed',
            loanAmount: 200_000,
            startingLoanBalance: 200_000,
            linkedAccountId: 'loan-11',
            apr: 3.875,
        };

        const result = reconstituteAccount(serialized) as PropertyAccount;

        expect(result.apr).toBeCloseTo(3.875);
    });

    it('reconstitute: missing apr defaults to 0 (owned property)', () => {
        const serialized = {
            className: 'PropertyAccount',
            id: 'p4',
            name: 'Cabin',
            amount: 200_000,
            ownershipType: 'Owned',
            loanAmount: 0,
            startingLoanBalance: 0,
            linkedAccountId: '',
            // apr intentionally absent
        };

        const result = reconstituteAccount(serialized) as PropertyAccount;

        expect(result.apr).toBe(0);
    });
});

// ─── Finding 9 ────────────────────────────────────────────────────────────────

describe('Finding 9 – reconstituteAccount: customROR null → undefined', () => {
    describe('InvestedAccount', () => {
        it('customROR: null serialized value restores as undefined (not 0)', () => {
            const serialized = {
                className: 'InvestedAccount',
                id: 'i1',
                name: 'Brokerage',
                amount: 50_000,
                customROR: null, // persisted as null in localStorage
            };

            const result = reconstituteAccount(serialized) as InvestedAccount;

            // BUG: before fix, result.customROR would be 0 because Number(null)=0
            expect(result.customROR).toBeUndefined();
        });

        it('customROR: numeric value round-trips correctly', () => {
            const serialized = {
                className: 'InvestedAccount',
                id: 'i2',
                name: 'Roth IRA',
                amount: 100_000,
                customROR: 6,
            };

            const result = reconstituteAccount(serialized) as InvestedAccount;

            expect(result.customROR).toBe(6);
        });

        it('customROR: absent value stays undefined', () => {
            const serialized = {
                className: 'InvestedAccount',
                id: 'i3',
                name: 'Traditional 401k',
                amount: 200_000,
                // customROR not present at all
            };

            const result = reconstituteAccount(serialized) as InvestedAccount;

            expect(result.customROR).toBeUndefined();
        });
    });

    describe('ESPPAccount', () => {
        it('customROR: null serialized value restores as undefined (not 0)', () => {
            const serialized = {
                className: 'ESPPAccount',
                id: 'espp1',
                name: 'Company ESPP',
                amount: 20_000,
                customROR: null, // persisted as null
            };

            const result = reconstituteAccount(serialized) as ESPPAccount;

            // BUG: before fix, result.customROR would be 0
            expect(result.customROR).toBeUndefined();
        });

        it('customROR: numeric value round-trips correctly', () => {
            const serialized = {
                className: 'ESPPAccount',
                id: 'espp2',
                name: 'Company ESPP',
                amount: 20_000,
                customROR: 8,
            };

            const result = reconstituteAccount(serialized) as ESPPAccount;

            expect(result.customROR).toBe(8);
        });

        it('customROR: absent value stays undefined', () => {
            const serialized = {
                className: 'ESPPAccount',
                id: 'espp3',
                name: 'Company ESPP',
                amount: 20_000,
                // customROR not present
            };

            const result = reconstituteAccount(serialized) as ESPPAccount;

            expect(result.customROR).toBeUndefined();
        });
    });
});
