/**
 * #156 taxableTierRank — lot-aware taxable tier for ESPP/RSU accounts in the Auto sort
 * ranking. Tier 1 ties with brokerage (favourable gain character today); tier 1.5 defers
 * to just after brokerage but before tax-deferred.
 *
 *  - ESPP: weighted by current market VALUE; qualifying-disposition share ≥ 50% → 1.
 *  - RSU: weighted by EMBEDDED GAIN; long-term share ≥ 50% → 1. De minimis: total gain
 *    under 5% of eligible value → 1 regardless (RSU basis = fmvAtVest, so a freshly-vested
 *    account is nearly tax-free to sell — THE case a naive holding-period rank gets wrong).
 *  - Zero eligible lots → 1.5.
 *
 * All numbers invented.
 */
import { describe, it, expect } from 'vitest';
import { ESPPAccount, RSUAccount, type ESPPLot, type RSULot } from '../../../components/Objects/Accounts/models';
import { taxableTierRank } from '../../../services/simulation/WithdrawalPlanner';

// Fixed sale date so lot ages are deterministic regardless of when the test runs.
const SALE_DATE = new Date(2032, 5, 15); // 2032-06-15 (local)

const yearsBefore = (years: number): Date => {
    const d = new Date(SALE_DATE);
    d.setFullYear(d.getFullYear() - years);
    return d;
};
const monthsBefore = (months: number): Date => {
    const d = new Date(SALE_DATE);
    d.setMonth(d.getMonth() - months);
    return d;
};

const SHARE_PRICE = 100;

// Qualifying needs saleDate ≥ grant+2y AND ≥ purchase+1y; grant precedes purchase by 6mo here.
const esppLot = (id: string, purchaseYearsAgo: number, shares: number): ESPPLot => {
    const purchaseDate = yearsBefore(purchaseYearsAgo);
    const grantDate = new Date(purchaseDate);
    grantDate.setMonth(grantDate.getMonth() - 6);
    return {
        id,
        grantDate,
        purchaseDate,
        fmvAtGrant: 80,
        fmvAtPurchase: 85,
        purchasePrice: 72.25, // 15% discount off fmvAtPurchase
        shares,
        totalCost: 72.25 * shares,
        discountAmount: 12.75,
    };
};

const esppAccount = (lots: ESPPLot[], minimumHoldingDays = 0): ESPPAccount =>
    new ESPPAccount(
        'espp-1', 'ESPP',
        lots.reduce((s, l) => s + l.shares, 0) * SHARE_PRICE,
        lots, null, undefined, 'TICK', SHARE_PRICE, 'fifo', minimumHoldingDays,
    );

const rsuLot = (id: string, vestDate: Date, fmvAtVest: number, shares: number): RSULot => ({
    id,
    grantDate: new Date(vestDate.getFullYear() - 1, vestDate.getMonth(), vestDate.getDate()),
    vestDate,
    fmvAtVest,
    shares,
    costBasis: fmvAtVest * shares,
});

const rsuAccount = (lots: RSULot[], minimumHoldingDays = 0): RSUAccount =>
    new RSUAccount(
        'rsu-1', 'RSU',
        lots.reduce((s, l) => s + l.shares, 0) * SHARE_PRICE,
        lots, null, undefined, 'TICK', SHARE_PRICE, 'fifo', minimumHoldingDays,
    );

describe('taxableTierRank — ESPP (value-weighted qualifying share)', () => {
    it('disqualifying-heavy ESPP (recent purchases) ranks 1.5', () => {
        // Both lots bought 3 months ago → neither passes 2y-from-grant / 1y-from-purchase.
        const account = esppAccount([esppLot('e1', 0.25, 400), esppLot('e2', 0.25, 600)]);
        expect(taxableTierRank(account, SALE_DATE)).toBe(1.5);
    });

    it('qualifying-heavy ESPP (seasoned purchases) ranks 1', () => {
        // Both lots 3 years old → 2y from grant and 1y from purchase both satisfied.
        const account = esppAccount([esppLot('e1', 3, 400), esppLot('e2', 3, 600)]);
        expect(taxableTierRank(account, SALE_DATE)).toBe(1);
    });

    it('mixed lots cross at the 50%-of-VALUE majority', () => {
        // Same share price, so value weight == share weight.
        // 600 qualifying vs 400 disqualifying → 60% qualifying → 1.
        const qualifyingHeavy = esppAccount([esppLot('old', 3, 600), esppLot('new', 0.25, 400)]);
        expect(taxableTierRank(qualifyingHeavy, SALE_DATE)).toBe(1);
        // 400 qualifying vs 600 disqualifying → 40% qualifying → 1.5.
        const disqualifyingHeavy = esppAccount([esppLot('old', 3, 400), esppLot('new', 0.25, 600)]);
        expect(taxableTierRank(disqualifyingHeavy, SALE_DATE)).toBe(1.5);
    });

    it('zero eligible lots ranks 1.5 (nothing sellable yet)', () => {
        expect(taxableTierRank(esppAccount([]), SALE_DATE)).toBe(1.5);
        // A QUALIFYING lot (would rank 1) blocked by the minimum holding period → 1.5,
        // proving eligibility gating, not disposition, drives this case.
        const blocked = esppAccount([esppLot('e1', 3, 500)], 3 * 366);
        expect(taxableTierRank(blocked, SALE_DATE)).toBe(1.5);
    });
});

describe('taxableTierRank — RSU (gain-weighted long-term share + de minimis)', () => {
    it('large SHORT-term embedded gains rank 1.5', () => {
        // Vested 6 months ago at $50, price $100 → 50%-of-value gain, all short-term.
        const account = rsuAccount([rsuLot('r1', monthsBefore(6), 50, 300)]);
        expect(taxableTierRank(account, SALE_DATE)).toBe(1.5);
    });

    it('long-term-heavy gains rank 1', () => {
        // Vested 2 years ago at $40 → $60/share gain, long-term.
        const account = rsuAccount([rsuLot('r1', yearsBefore(2), 40, 300)]);
        expect(taxableTierRank(account, SALE_DATE)).toBe(1);
    });

    it('freshly-vested near-zero-gain RSU ranks 1 via de minimis (despite being 100% short-term)', () => {
        // THE discriminating case vs a naive holding-period rank: basis = fmvAtVest, so a
        // just-vested lot ($98 basis, $100 price → 2% of value in gain, < 5%) is nearly
        // tax-free to sell even though every share is short-term.
        const account = rsuAccount([rsuLot('r1', monthsBefore(2), 98, 500)]);
        expect(taxableTierRank(account, SALE_DATE)).toBe(1);
    });

    it('mixed lots cross at the 50%-of-GAIN majority (not share count)', () => {
        // LT lot: vested 3y ago at $40 → $60/share gain. ST lot: vested 6mo ago at $70 → $30/share gain.
        // 200 LT shares ($12,000 LT gain) vs 300 ST shares ($9,000 ST gain) → LT share 57% → 1,
        // even though ST lots hold the share-count majority.
        const ltHeavyByGain = rsuAccount([
            rsuLot('lt', yearsBefore(3), 40, 200),
            rsuLot('st', monthsBefore(6), 70, 300),
        ]);
        expect(taxableTierRank(ltHeavyByGain, SALE_DATE)).toBe(1);
        // Shrink the LT lot to 100 shares: $6,000 LT vs $9,000 ST → LT share 40% → 1.5.
        const stHeavyByGain = rsuAccount([
            rsuLot('lt', yearsBefore(3), 40, 100),
            rsuLot('st', monthsBefore(6), 70, 300),
        ]);
        expect(taxableTierRank(stHeavyByGain, SALE_DATE)).toBe(1.5);
    });

    it('zero eligible lots ranks 1.5', () => {
        expect(taxableTierRank(rsuAccount([]), SALE_DATE)).toBe(1.5);
        // A near-zero-gain lot (would rank 1 via de minimis) blocked by the minimum
        // holding period → 1.5, proving eligibility gating drives this case.
        const blocked = rsuAccount([rsuLot('r1', monthsBefore(2), 98, 100)], 365);
        expect(taxableTierRank(blocked, SALE_DATE)).toBe(1.5);
    });
});
