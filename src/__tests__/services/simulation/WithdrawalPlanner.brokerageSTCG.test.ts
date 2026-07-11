/**
 * #75: brokerage withdrawals realize short-term capital gains on lots held < 2
 * calendar years (the year-granularity convention matching models.tsx), taxed at
 * ordinary rates (not LTCG), via a FIFO lot walk. Long-held lots stay long-term,
 * an account with no lot data falls back to all-LTCG, and the ACA-cliff cap is
 * sized FIFO-consistently so it doesn't breach the cliff.
 *
 * Note on holding period: withdrawals are planned BEFORE the current-year lot is
 * appended (solveYear runs before growAccounts), so the newest lot a plan ever
 * sees is purchaseYear = currentYear-1 — which is short-term under the >= 2
 * convention. These tests use that realistic age.
 */
import { describe, it, expect } from 'vitest';
import { planWithdrawals, createAccountSnapshot } from '../../../services/simulation/WithdrawalPlanner';
import { InvestedAccount, type BrokerageLot } from '../../../components/Objects/Accounts/models';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2025;

function txState(): TaxState {
    // Texas (no state income tax) isolates the federal ordinary rate.
    return {
        filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null, year: YEAR,
    };
}

// Brokerage worth $200k composed of the given lots; costBasis matches the lots.
function brokerage(lots: BrokerageLot[]): InvestedAccount {
    const costBasis = lots.reduce((s, l) => s + l.costBasis, 0);
    const amount = lots.reduce((s, l) => s + l.currentValue, 0) || 200000;
    return new InvestedAccount(
        'brk-1', 'Brokerage', amount, 0, 10, 0.07, 'Brokerage', true, 0.2, costBasis, undefined, [], lots,
    );
}

const LT_LOT: BrokerageLot = { purchaseYear: YEAR - 2, costBasis: 50000, currentValue: 100000 }; // long-term, $50k gain
const ST_LOT: BrokerageLot = { purchaseYear: YEAR - 1, costBasis: 70000, currentValue: 100000 }; // short-term, $30k gain

const snapDate = new Date(YEAR, 5, 15);

describe('#75: brokerage realizes short-term capital gains (FIFO)', () => {
    it('taxes a sale reaching a < 2-year lot at ordinary rates', () => {
        const snap = createAccountSnapshot(brokerage([LT_LOT, ST_LOT]), snapDate);
        // Income high enough that the ordinary marginal (22%) exceeds the LTCG rate,
        // and a net need large enough to exhaust the long-term lot and dip into the
        // short-term one (FIFO sells the older long-term lot first).
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

    it('keeps lots held >= 2 years entirely long-term (no STCG)', () => {
        const olderLot: BrokerageLot = { purchaseYear: YEAR - 3, costBasis: 70000, currentValue: 100000 };
        const snap = createAccountSnapshot(brokerage([olderLot, LT_LOT]), snapDate);
        const result = planWithdrawals(150000, [snap], 66, YEAR, txState(), 100000, undefined);

        const w = result.withdrawals.find(x => x.source === 'brokerage')!;
        expect(w.capitalGains!.shortTerm).toBe(0);
        expect(w.capitalGains!.longTerm).toBeGreaterThan(0);
        expect(result.totalSTCG).toBe(0);
    });

    it('falls back to all-LTCG when the account has no lot data', () => {
        const noLots = new InvestedAccount('brk-1', 'Brokerage', 200000, 0, 10, 0.07, 'Brokerage', true, 0.2, 120000, undefined, [], []);
        const snap = createAccountSnapshot(noLots, snapDate);
        const result = planWithdrawals(50000, [snap], 66, YEAR, txState(), 100000, undefined);

        const w = result.withdrawals.find(x => x.source === 'brokerage')!;
        expect(w.capitalGains!.shortTerm).toBe(0);
        expect(w.capitalGains!.longTerm).toBeGreaterThan(0);
        expect(result.totalSTCG).toBe(0);
    });

    it('caps the ACA-cliff sale FIFO-consistently so MAGI does not breach the cliff', () => {
        // Old high-gain lot ahead of a newer low-gain lot: FIFO realizes far more
        // gain per gross than the account average, so an aggregate-ratio cap would
        // overshoot the cliff. Both lots are long-term (no STCG); this is the LTCG
        // realization path the regression lives on.
        const oldHighGain: BrokerageLot = { purchaseYear: YEAR - 3, costBasis: 1000, currentValue: 100000 };   // 0.99 gain ratio
        const newerLowGain: BrokerageLot = { purchaseYear: YEAR - 2, costBasis: 99000, currentValue: 100000 }; // 0.01 gain ratio
        const snap = createAccountSnapshot(brokerage([oldHighGain, newerLowGain]), snapDate);

        const cliff = 40000;
        const currentMAGI = 30000;
        const result = planWithdrawals(
            100000, [snap], 66, YEAR, txState(), 0, undefined,
            'Spending deficit', { acaCliffThreshold: cliff, currentMAGI },
        );

        const w = result.withdrawals.find(x => x.source === 'brokerage')!;
        const realizedGain = (w.capitalGains?.shortTerm ?? 0) + (w.capitalGains?.longTerm ?? 0);
        // FIFO-consistent cap keeps MAGI under the cliff; the buggy aggregate-ratio
        // cap realized ~2x the headroom and breached it.
        expect(currentMAGI + realizedGain).toBeLessThanOrEqual(cliff);
    });
});

describe('#91 item #1: net-targeted lot-sale sizing (no partial-sale undershoot)', () => {
    it('delivers the full deficit net on a partial sale through a high-gain FIFO lot', () => {
        // Old high-gain lot ahead of a newer low-gain lot. A partial sale walks
        // only into the first (0.99-gain) lot, whose effective rate is far above
        // the pool average (gainRatio 0.5). The pre-#91 sizing used the pool-blended
        // rate (gross = net / (1 − blendedRate)), so it sized as if the lower
        // average rate applied and the realized net landed well under the deficit
        // (~$46k for a $50k ask). sizeLotSaleForNet bisects on the realized net, so
        // the sale now delivers the requested deficit even on a partial walk.
        const oldHighGain: BrokerageLot = { purchaseYear: YEAR - 3, costBasis: 1000, currentValue: 100000 };   // 0.99 gain, LT
        const newerLowGain: BrokerageLot = { purchaseYear: YEAR - 2, costBasis: 99000, currentValue: 100000 }; // 0.01 gain, LT
        const snap = createAccountSnapshot(brokerage([oldHighGain, newerLowGain]), snapDate);

        const deficit = 50000;
        const result = planWithdrawals(deficit, [snap], 66, YEAR, txState(), 100000, undefined);

        const w = result.withdrawals.find(x => x.source === 'brokerage');
        expect(w).toBeDefined();
        // Partial sale: stops inside the first (high-gain) lot, so realized LTCG per
        // gross is well above the pool average — the case the old estimate misjudged.
        expect(w!.gross).toBeLessThan(100000);
        expect(w!.capitalGains!.longTerm).toBeGreaterThan(0);
        // The realized net hits the deficit (the old blended estimate undershot by
        // ~$4k). Bisection converges net to within a fraction of a dollar.
        expect(Math.abs(w!.net - deficit)).toBeLessThan(1);
        expect(Math.abs(result.totalNet - deficit)).toBeLessThan(1);
    });
});
