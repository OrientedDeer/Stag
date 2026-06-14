/**
 * #75: brokerage withdrawals realize short-term capital gains on lots held < 1
 * year, taxed at ordinary rates (not LTCG), via a FIFO lot walk. Long-held lots
 * stay long-term, and an account with no lot data falls back to all-LTCG (the
 * prior behavior).
 */
import { describe, it, expect } from 'vitest';
import { planWithdrawals, createAccountSnapshot } from '../../../services/simulation/WithdrawalPlanner';
import { InvestedAccount, BrokerageLot } from '../../../components/Objects/Accounts/models';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2025;

function txState(): TaxState {
    // Texas (no state income tax) isolates the federal ordinary rate.
    return {
        filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null, year: YEAR,
    };
}

// Brokerage worth $200k, costBasis $120k (gainRatio 0.4), composed of the lots passed.
function brokerage(lots: BrokerageLot[]): InvestedAccount {
    return new InvestedAccount(
        'brk-1', 'Brokerage', 200000, 0, 10, 0.07, 'Brokerage', true, 0.2, 120000, undefined, [], lots,
    );
}

const LT_LOT: BrokerageLot = { purchaseYear: YEAR - 2, costBasis: 50000, currentValue: 100000 }; // $50k LTCG
const ST_LOT: BrokerageLot = { purchaseYear: YEAR, costBasis: 70000, currentValue: 100000 };     // $30k STCG

const snapDate = new Date(YEAR, 5, 15);

describe('#75: brokerage realizes short-term capital gains (FIFO)', () => {
    it('taxes a sale that reaches a current-year lot at ordinary rates', () => {
        const snap = createAccountSnapshot(brokerage([LT_LOT, ST_LOT]), snapDate);
        // Income high enough that the ordinary marginal (22%) exceeds the LTCG rate,
        // and a net need large enough to exhaust the long-term lot and dip into the
        // short-term one (FIFO sells the long-term lot first).
        const result = planWithdrawals(150000, [snap], 66, YEAR, txState(), 100000, undefined);

        const w = result.withdrawals.find(x => x.source === 'brokerage');
        expect(w).toBeDefined();
        expect(w!.capitalGains!.longTerm).toBeGreaterThan(0);
        expect(w!.capitalGains!.shortTerm).toBeGreaterThan(0);
        expect(result.totalSTCG).toBeGreaterThan(0);

        // STCG is taxed at the ordinary rate (routed via ordinaryTax) — well above
        // the ~15% LTCG rate it would have been charged before #75.
        expect(w!.ordinaryTax).toBeGreaterThan(0);
        const impliedStcgRate = w!.ordinaryTax! / w!.capitalGains!.shortTerm;
        expect(impliedStcgRate).toBeGreaterThan(0.15);
    });

    it('keeps long-held lots entirely long-term (no STCG)', () => {
        // A lot bought last year is held >= 1 year → long-term.
        const olderLot: BrokerageLot = { purchaseYear: YEAR - 1, costBasis: 70000, currentValue: 100000 };
        const snap = createAccountSnapshot(brokerage([LT_LOT, olderLot]), snapDate);
        const result = planWithdrawals(150000, [snap], 66, YEAR, txState(), 100000, undefined);

        const w = result.withdrawals.find(x => x.source === 'brokerage')!;
        expect(w.capitalGains!.shortTerm).toBe(0);
        expect(w.capitalGains!.longTerm).toBeGreaterThan(0);
        expect(result.totalSTCG).toBe(0);
    });

    it('falls back to all-LTCG when the account has no lot data', () => {
        const snap = createAccountSnapshot(brokerage([]), snapDate); // no lots → proportional fallback
        const result = planWithdrawals(50000, [snap], 66, YEAR, txState(), 100000, undefined);

        const w = result.withdrawals.find(x => x.source === 'brokerage')!;
        expect(w.capitalGains!.shortTerm).toBe(0);
        expect(w.capitalGains!.longTerm).toBeGreaterThan(0);
        expect(result.totalSTCG).toBe(0);
    });
});
