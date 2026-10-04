import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ESPPAccount, RSUAccount, type ESPPLot, type RSULot } from '../../../../components/Objects/Accounts/models';
import { midYearSaleDate } from '../../../../services/simulation/dates';

// Lots stamped in winter (standard time) and sold at the June 15 mid-year sale
// date (daylight time) are one hour short of a whole number of days in a US zone.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/New_York'; });
afterAll(() => { process.env.TZ = ORIGINAL_TZ; });

function esppLot(purchaseDate: Date): ESPPLot {
    return {
        id: 'espp-lot', grantDate: new Date(purchaseDate.getFullYear(), 6, 1), purchaseDate,
        fmvAtGrant: 100, fmvAtPurchase: 100, purchasePrice: 85, shares: 10,
        totalCost: 850, discountAmount: 15,
    };
}

function rsuLot(vestDate: Date): RSULot {
    return { id: 'rsu-lot', grantDate: new Date(2024, 0, 1), vestDate, fmvAtVest: 100, shares: 10, costBasis: 1000 };
}

describe('minimum holding period across a DST change', () => {
    it('ESPP lot bought Dec 28 is sellable on Jun 15 with a 169-day hold', () => {
        const saleDate = midYearSaleDate(2026);
        const acc = new ESPPAccount('e', 'ESPP', 1000, [esppLot(new Date(2025, 11, 28))],
            null, undefined, undefined, undefined, 'fifo', 169);
        expect(acc.getEligibleShares(saleDate)).toBe(10);

        const tooShort = new ESPPAccount('e', 'ESPP', 1000, [esppLot(new Date(2025, 11, 28))],
            null, undefined, undefined, undefined, 'fifo', 170);
        expect(tooShort.getEligibleShares(saleDate)).toBe(0);
    });

    it('RSU lot vested Dec 15 is sellable on Jun 15 with a 182-day hold', () => {
        const saleDate = midYearSaleDate(2026);
        const acc = new RSUAccount('r', 'RSU', 1000, [rsuLot(new Date(2025, 11, 15))],
            null, undefined, undefined, undefined, 'fifo', 182);
        expect(acc.getEligibleShares(saleDate)).toBe(10);

        const tooShort = new RSUAccount('r', 'RSU', 1000, [rsuLot(new Date(2025, 11, 15))],
            null, undefined, undefined, undefined, 'fifo', 183);
        expect(tooShort.getEligibleShares(saleDate)).toBe(0);
    });
});
