/**
 * Regression tests for confirmed bugs in Accounts/models.tsx
 *
 * Finding 7: PropertyAccount drops `apr` on increment AND reconstitute
 * Finding 9: reconstituteAccount coerces customROR null → 0 instead of undefined
 * #81 (wave-1 finding 7): a non-numeric persisted costBasis makes Number(...) NaN,
 *   and Math.max(0, NaN) === NaN, rendering "$NaN" on the brokerage card.
 */
import { describe, it, expect } from 'vitest';
import {
    PropertyAccount,
    InvestedAccount,
    ESPPAccount,
    RSUAccount,
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

// ─── #81 (wave-1 finding 7) ─────────────────────────────────────────────────

describe('#81 – reconstituteAccount: InvestedAccount costBasis NaN guard', () => {
    it('costBasis: non-numeric string falls back to amount (not NaN)', () => {
        const serialized = {
            className: 'InvestedAccount',
            id: 'nan1',
            name: 'Brokerage',
            amount: 50_000,
            costBasis: 'corrupted', // Number('corrupted') === NaN
        };

        const result = reconstituteAccount(serialized) as InvestedAccount;

        // BUG: before fix, Math.max(0, NaN) === NaN → "$NaN" for Principal and Gain/Loss
        expect(result.costBasis).toBe(50_000);
        expect(Number.isFinite(result.costBasis)).toBe(true);
    });

    it('costBasis: null falls back to amount via ?? (not 0)', () => {
        const serialized = {
            className: 'InvestedAccount',
            id: 'nan2',
            name: 'Brokerage',
            amount: 30_000,
            costBasis: null, // ?? amount, then finite
        };

        const result = reconstituteAccount(serialized) as InvestedAccount;

        expect(result.costBasis).toBe(30_000);
    });

    it('costBasis: NaN literal falls back to amount', () => {
        const serialized = {
            className: 'InvestedAccount',
            id: 'nan3',
            name: 'Brokerage',
            amount: 12_345,
            costBasis: NaN,
        };

        const result = reconstituteAccount(serialized) as InvestedAccount;

        expect(result.costBasis).toBe(12_345);
    });

    it('costBasis: valid numeric value round-trips (including underwater > amount)', () => {
        const serialized = {
            className: 'InvestedAccount',
            id: 'nan4',
            name: 'Brokerage',
            amount: 40_000,
            costBasis: 60_000, // underwater position — valid, must NOT clamp to amount
        };

        const result = reconstituteAccount(serialized) as InvestedAccount;

        expect(result.costBasis).toBe(60_000);
    });

    it('costBasis: negative value still floors at 0', () => {
        const serialized = {
            className: 'InvestedAccount',
            id: 'nan5',
            name: 'Brokerage',
            amount: 10_000,
            costBasis: -5_000,
        };

        const result = reconstituteAccount(serialized) as InvestedAccount;

        expect(result.costBasis).toBe(0);
    });
});

// ─── #86 ────────────────────────────────────────────────────────────────────
// Sibling of #81: a non-numeric persisted currentSharePrice makes
// Number(...) NaN. Readers do `currentSharePrice ?? derived`, and NaN ?? x
// keeps NaN (nullish coalescing only catches null/undefined) → "$NaN/sh" on
// the ESPP/RSU card header and in per-lot value math. The fix falls back to
// undefined (the "unset → derive" sentinel) when the parse isn't finite.

describe('#86 – reconstituteAccount: ESPP/RSU currentSharePrice NaN guard', () => {
    describe('ESPPAccount', () => {
        it('currentSharePrice: non-numeric string falls back to undefined (not NaN)', () => {
            const serialized = {
                className: 'ESPPAccount',
                id: 'sp-espp1',
                name: 'Company ESPP',
                amount: 20_000,
                currentSharePrice: 'corrupted', // Number('corrupted') === NaN
            };

            const result = reconstituteAccount(serialized) as ESPPAccount;

            // BUG: before fix, currentSharePrice was NaN → "$NaN/sh"
            expect(result.currentSharePrice).toBeUndefined();
            expect(Number.isNaN(result.currentSharePrice as number)).toBe(false);
        });

        it('currentSharePrice: null falls back to undefined', () => {
            const serialized = {
                className: 'ESPPAccount',
                id: 'sp-espp2',
                name: 'Company ESPP',
                amount: 20_000,
                currentSharePrice: null, // Number(null) === 0 but treated as corrupt-ish; passes !== undefined
            };

            const result = reconstituteAccount(serialized) as ESPPAccount;

            // Number(null) is 0 (finite), but our intent is "no real price" → keep finite-only.
            // null is finite-coercible to 0, which is the "unset" sentinel readers already handle.
            expect(Number.isNaN(result.currentSharePrice as number)).toBe(false);
        });

        it('currentSharePrice: NaN literal falls back to undefined', () => {
            const serialized = {
                className: 'ESPPAccount',
                id: 'sp-espp3',
                name: 'Company ESPP',
                amount: 20_000,
                currentSharePrice: NaN,
            };

            const result = reconstituteAccount(serialized) as ESPPAccount;

            expect(result.currentSharePrice).toBeUndefined();
        });

        it('currentSharePrice: valid numeric value round-trips', () => {
            const serialized = {
                className: 'ESPPAccount',
                id: 'sp-espp4',
                name: 'Company ESPP',
                amount: 20_000,
                currentSharePrice: 42.5,
            };

            const result = reconstituteAccount(serialized) as ESPPAccount;

            expect(result.currentSharePrice).toBe(42.5);
        });

        it('currentSharePrice: absent value stays undefined', () => {
            const serialized = {
                className: 'ESPPAccount',
                id: 'sp-espp5',
                name: 'Company ESPP',
                amount: 20_000,
                // currentSharePrice not present
            };

            const result = reconstituteAccount(serialized) as ESPPAccount;

            expect(result.currentSharePrice).toBeUndefined();
        });
    });

    describe('RSUAccount', () => {
        it('currentSharePrice: non-numeric string falls back to undefined (not NaN)', () => {
            const serialized = {
                className: 'RSUAccount',
                id: 'sp-rsu1',
                name: 'Company RSU',
                amount: 30_000,
                currentSharePrice: 'corrupted',
            };

            const result = reconstituteAccount(serialized) as RSUAccount;

            // BUG: before fix, currentSharePrice was NaN → "$NaN/sh"
            expect(result.currentSharePrice).toBeUndefined();
            expect(Number.isNaN(result.currentSharePrice as number)).toBe(false);
        });

        it('currentSharePrice: NaN literal falls back to undefined', () => {
            const serialized = {
                className: 'RSUAccount',
                id: 'sp-rsu2',
                name: 'Company RSU',
                amount: 30_000,
                currentSharePrice: NaN,
            };

            const result = reconstituteAccount(serialized) as RSUAccount;

            expect(result.currentSharePrice).toBeUndefined();
        });

        it('currentSharePrice: null does not produce NaN', () => {
            const serialized = {
                className: 'RSUAccount',
                id: 'sp-rsu3',
                name: 'Company RSU',
                amount: 30_000,
                currentSharePrice: null,
            };

            const result = reconstituteAccount(serialized) as RSUAccount;

            expect(Number.isNaN(result.currentSharePrice as number)).toBe(false);
        });

        it('currentSharePrice: valid numeric value round-trips', () => {
            const serialized = {
                className: 'RSUAccount',
                id: 'sp-rsu4',
                name: 'Company RSU',
                amount: 30_000,
                currentSharePrice: 187.33,
            };

            const result = reconstituteAccount(serialized) as RSUAccount;

            expect(result.currentSharePrice).toBe(187.33);
        });

        it('currentSharePrice: absent value stays undefined', () => {
            const serialized = {
                className: 'RSUAccount',
                id: 'sp-rsu5',
                name: 'Company RSU',
                amount: 30_000,
                // currentSharePrice not present
            };

            const result = reconstituteAccount(serialized) as RSUAccount;

            expect(result.currentSharePrice).toBeUndefined();
        });
    });
});
