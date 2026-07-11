/**
 * Reviewed-bug fixes for WithdrawalPlanner.planWithdrawals.
 *
 * Bug #7  — State marginal rate frozen at initial income (stale across iterations).
 * Bug #14 — Unguarded gross-up `1/(1-rate)` can divide by <= 0 → Infinity/NaN.
 *
 * (Bug #3 — LTCG rate off gross vs taxable — was REVERTED: passing gross is a
 *  conservative gross-up proxy; a taxable-income lookup returns the 0% floor rate
 *  and under-withdraws when gains spill into 15%. See WithdrawalPlanner.getLTCGRate.)
 * (Bug #9 — brokerage short/long split — is NEEDS-CROSS-FILE: the snapshot only
 *  carries an averaged gainRatio with no lot holding-period data, and YearSolver
 *  hardcodes STCG=0 when computing the authoritative federal tax, so it can't be
 *  fixed inside WithdrawalPlanner alone. Not covered here.)
 */

import { describe, it, expect } from 'vitest';

import {
    planWithdrawals,
    createAccountSnapshot,
    grossUpDivisor,
} from '../../../services/simulation/WithdrawalPlanner';
import { type AccountBalanceSnapshot } from '../../../services/simulation/types';
import { InvestedAccount, RSUAccount, ESPPAccount, type ESPPLot } from '../../../components/Objects/Accounts/models';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2025;

function taxStateFor(stateResidency: string): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency,
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: YEAR,
    };
}

// =============================================================================
// BUG #7: state marginal rate must update as running income rises
// =============================================================================
// California Single 2025 brackets jump from low rates near the bottom to 0.093
// at taxable income >= 70,607. A large Traditional withdrawal lifts running
// income across those brackets; the state portion of the marginal rate used to
// gross up a subsequent HSA withdrawal must reflect the HIGHER state bracket,
// not the frozen initial one.
describe('Bug #7: state marginal rate recomputes per-iteration (not frozen)', () => {
    function buildSnapshots(): AccountBalanceSnapshot[] {
        // Traditional: balance CAPPED below the net need so the planner MUST
        // spill into the HSA. (The original $1M balance covered the whole need;
        // an HSA entry only appeared as a ~$0.4 float sliver, which #192's CA
        // schedule correction erased — the test was asserting on that sliver.)
        // Drawing the full $100k still lifts running income from $5k into CA's
        // 9.3% bracket before the HSA is tapped, which is the point of Bug #7.
        const trad = new InvestedAccount(
            'trad-1', 'Traditional IRA', 100000,
            0, 10, 0.07, 'Traditional IRA',
        );
        // HSA: tapped AFTER traditional; its gross-up uses the (now-higher) marginal rate.
        const hsa = new InvestedAccount(
            'hsa-1', 'HSA', 200000,
            0, 10, 0.07, 'HSA',
        );
        return [createAccountSnapshot(trad), createAccountSnapshot(hsa)];
    }

    it('grosses up the later HSA withdrawal using the elevated CA state rate', () => {
        const snapshots = buildSnapshots();

        // Start with low income (~$5k) so the FROZEN state rate would be the 1% bracket.
        // The full $100k traditional draw pushes running income into CA's 9.3%
        // bracket (2025 taxable >= 72,724) before the HSA is tapped.
        const result = planWithdrawals(
            120000,           // big net need → large traditional draw, then HSA
            snapshots,
            66,               // age >= 65 → no HSA penalty, isolates marginal-rate effect
            YEAR,
            taxStateFor('California'),
            5000,             // low initial ordinary income
            undefined,
        );

        const hsaW = result.withdrawals.find(w => w.source === 'hsa');
        expect(hsaW).toBeDefined();
        expect(hsaW!.gross).toBeGreaterThan(0);

        // HSA tax = gross * (fedMarginal + stateMarginal). At this income level the
        // CA marginal rate is 0.093 (frozen bug would use ~0.01). The fed marginal
        // is 0.22 (taxable ~ running income - 15,750, in the 22% band). So the
        // implied state component must be ~0.093, not ~0.01.
        const impliedCombined = hsaW!.tax / hsaW!.gross;
        const fedMarginalAtHSA = 0.22;
        const impliedState = impliedCombined - fedMarginalAtHSA;

        // With the fix the state component reflects the high bracket.
        expect(impliedState).toBeGreaterThan(0.05);
        // Frozen-rate bug would have left it near the 1% bottom bracket.
        expect(impliedState).not.toBeLessThan(0.05);
    });
});

// =============================================================================
// BUG #14: guarded gross-up divisor
// =============================================================================
describe('Bug #14: gross-up divisor is guarded against >= 1 effective rates', () => {
    it('keeps the divisor positive when the effective rate reaches/exceeds 1', () => {
        // Buggy formula: 1 - effectiveRate.
        // At 0.95 → 0.05 (positive but tiny), at 1.0 → 0 (div by zero → Infinity),
        // at 1.2 → -0.2 (negative gross). The guard floors at 0.01.
        expect(1 - 0.95).toBeCloseTo(0.05, 6);

        // Degenerate cases the bug exposed:
        expect(Number.isFinite(100 / (1 - 1.0))).toBe(false);   // Infinity
        expect(100 / (1 - 1.2)).toBeLessThan(0);                // negative gross

        // Guarded divisor stays finite and positive in every case.
        expect(grossUpDivisor(0.95)).toBeGreaterThan(0);
        expect(grossUpDivisor(1.0)).toBe(0.01);
        expect(grossUpDivisor(1.2)).toBe(0.01);

        const gross = 100 / grossUpDivisor(1.2);
        expect(Number.isFinite(gross)).toBe(true);
        expect(gross).toBeGreaterThan(0);
    });

    it('produces a finite, positive HSA gross even at the highest real marginal rate', () => {
        // Sanity: a top-bracket retiree under 65 (37% fed + CA 0.123 + 20% penalty
        // ≈ 0.69 effective). Should stay finite — and remain finite even if rates
        // were pathological, thanks to the guard.
        const hsa = new InvestedAccount(
            'hsa-2', 'HSA', 500000,
            0, 10, 0.07, 'HSA',
        );
        const result = planWithdrawals(
            50000,
            [createAccountSnapshot(hsa)],
            60,                       // < 65 → 20% HSA penalty
            YEAR,
            taxStateFor('California'),
            2000000,                  // top federal + top CA bracket
            undefined,
        );

        expect(Number.isFinite(result.totalGross)).toBe(true);
        expect(Number.isFinite(result.totalTax)).toBe(true);
        expect(Number.isNaN(result.totalGross)).toBe(false);
        const hsaW = result.withdrawals.find(w => w.source === 'hsa')!;
        expect(Number.isFinite(hsaW.gross)).toBe(true);
        expect(hsaW.gross).toBeGreaterThan(0);
    });
});

// =============================================================================
// §1211(b): a NET realized capital loss offsets at most $3,000 of other income.
// The cap must apply to the year's AGGREGATE (totalSTCG + totalLTCG), not per
// bucket or per sale — a both-underwater RSU pool otherwise piped a loss many
// times the limit into the unfloored SS-taxability and state-tax bases.
// =============================================================================
describe('§1211(b): RSU net capital loss capped at $3,000 on the aggregate', () => {
    it('caps the combined ST+LT loss when BOTH buckets are underwater', () => {
        // Two 1,000-share lots, $40 basis, current price $25 → -$15/sh each. One
        // long-term (vested 2023), one short-term (vested Jan 2025). FIFO sells
        // both, realizing an LT loss AND an ST loss; raw net is ~-$27k.
        const ltLot = { id: 'lt', grantDate: new Date(2022, 0, 1), vestDate: new Date(2023, 0, 1), fmvAtVest: 40, shares: 1000, costBasis: 40000 };
        const stLot = { id: 'st', grantDate: new Date(2025, 0, 1), vestDate: new Date(2025, 0, 1), fmvAtVest: 40, shares: 1000, costBasis: 40000 };
        const rsu = new RSUAccount('rsu-1', 'Company RSU', 50000, [ltLot, stLot], null, undefined, 'CO', 25, 'fifo', 0);

        const result = planWithdrawals(
            45000, [createAccountSnapshot(rsu, new Date(YEAR, 5, 15))], 66, YEAR,
            taxStateFor('Texas'), 0, undefined,
        );

        // Both buckets sold at a loss...
        expect(result.totalSTCG).toBeLessThan(0);
        expect(result.totalLTCG).toBeLessThan(0);
        // ...but the NET reported loss is the §1211 cap, not the raw ~-$27k.
        expect(result.totalSTCG + result.totalLTCG).toBeCloseTo(-3000, 0);
    });
});

// =============================================================================
// #176: ACA look-ahead must drain the SAME Roth balance the main loop already
// drained. Three distinct bugs, all in the brokerage ACA-cliff substitution path.
// =============================================================================

// Roth IRA with a fully-vested $50k contribution basis (costBasis == amount, no
// conversions, no earnings). Under 59½ these dollars are tax- and penalty-free.
function rothIRA(id: string, amount: number, costBasis = amount,
    conversionHistory: { year: number; amount: number }[] = []): InvestedAccount {
    return new InvestedAccount(
        id, 'Roth IRA', amount, 0, 10, 0.07, 'Roth IRA', true, 0.2,
        costBasis, undefined, conversionHistory,
    );
}

// All-gains brokerage (costBasis 0 → gainRatio 1.0): any sale is 100% LTCG, so a
// modest sale reliably breaches a low ACA cliff.
function allGainsBrokerage(id: string, amount: number): InvestedAccount {
    return new InvestedAccount(id, 'Brokerage', amount, 0, 10, 0.07, 'Brokerage', true, 0.2, 0);
}

describe('#176 finding 1: main-loop Roth draw is recorded so the ACA look-ahead cannot double-spend it', () => {
    it('never withdraws more Roth gross than the account holds (Roth-before-brokerage order)', () => {
        // Tax Opt OFF, literal order: Roth FIRST, brokerage SECOND. Age 60 so Roth
        // is entirely tax/penalty-free. The $50k Roth is all contributions, no
        // earnings. Net need $100k forces the main loop to drain the whole Roth,
        // then reach the brokerage — whose ACA cliff cap triggers a Roth
        // substitution look-ahead. Pre-fix, the look-ahead re-saw the full $50k
        // (main loop never recorded consumption) and fabricated ~$30k of
        // non-existent "earnings", hiding a real unfunded deficit.
        const roth = createAccountSnapshot(rothIRA('roth-1', 50000));
        const brok = createAccountSnapshot(allGainsBrokerage('brok-1', 200000));

        const result = planWithdrawals(
            100000,
            [roth, brok],          // literal order: Roth first
            60,                    // >= 59.5 → Roth earnings would be tax-free (isolates balance double-spend)
            YEAR,
            taxStateFor('Texas'),
            0,
            undefined,
            'Spending deficit',
            { acaCliffThreshold: 20000, currentMAGI: 0 },
        );

        // Total gross drawn from the Roth (main draw + any ACA substitution) can
        // never exceed the account's balance.
        const rothGross = result.withdrawals
            .filter(w => w.accountId === 'roth-1')
            .reduce((sum, w) => sum + w.gross, 0);
        expect(rothGross).toBeLessThanOrEqual(50000 + 1);

        // The brokerage is cliff-capped and the Roth is exhausted, so a real
        // deficit must survive — the phantom substitution used to zero it out.
        expect(result.remainingDeficit).toBeGreaterThan(1000);
    });
});

describe('#176 finding 2: pooled Roth contribution basis is not double-subtracted after an ACA substitution', () => {
    it('taps remaining contributions (penalty-free) before a young conversion layer', () => {
        // Brokerage FIRST (triggers the ACA substitution), Roth IRA SECOND. Age 57.
        // Roth: $100k contribution basis + a $20k conversion done 2 years ago
        // (< 5yr → the 10% penalty layer). No earnings (amount == costBasis).
        // The brokerage cliff cap drives a large substitution funded ENTIRELY from
        // contributions; the main loop then needs a bit more. Pre-fix, contribAvailable
        // was computed as (remainingPoolBasis − alreadyConsumed) — double-counting the
        // ACA draw to 0 — so the main loop skipped the ~$20k of contributions still
        // available and drew the young conversion instead, incurring a phantom 10% penalty.
        const brok = createAccountSnapshot(allGainsBrokerage('brok-1', 120000));
        const roth = createAccountSnapshot(
            rothIRA('roth-1', 120000, 120000, [{ year: YEAR - 2, amount: 20000 }]),
        );

        const result = planWithdrawals(
            125000,
            [brok, roth],          // brokerage first → ACA substitution, then Roth main draw
            57,                    // < 59.5 → a conversion < 5yr old is penalized
            YEAR,
            taxStateFor('Texas'),
            0,
            undefined,
            'Spending deficit',
            { acaCliffThreshold: 30000, currentMAGI: 0 },
        );

        // With the fix the main-loop Roth draw is covered by the ~$20k of
        // contributions the substitution left behind, so essentially no early
        // withdrawal penalty is incurred. Pre-fix the young conversion was tapped
        // (~$1.7k penalty).
        expect(result.totalPenalties).toBeLessThan(200);

        // Total Roth gross never exceeds the account balance either.
        const rothGross = result.withdrawals
            .filter(w => w.accountId === 'roth-1')
            .reduce((sum, w) => sum + w.gross, 0);
        expect(rothGross).toBeLessThanOrEqual(120000 + 1);
    });
});

describe('#176 finding 3: ACA cliff guard counts ESPP bargain-element ordinary income realized earlier in the pass', () => {
    it('caps a later brokerage sale so realized MAGI (incl. ESPP ordinary income) stays under the cliff', () => {
        // ESPP FIRST (a disqualifying lot: bargain element = ordinary income),
        // brokerage SECOND. Pre-fix the brokerage cliff check ignored the ESPP
        // bargain element already realized this pass, sized its sale off an
        // over-stated headroom, and blew MAGI far past the cliff.
        const lot: ESPPLot = {
            id: 'lot-dq',
            shares: 1000,
            purchasePrice: 10,
            purchaseDate: new Date(YEAR - 1, 5, 30), // < 1yr, < 2yr from grant → disqualifying
            grantDate: new Date(YEAR - 1, 0, 1),
            fmvAtPurchase: 40,                       // bargain element $30/sh × 1000 = $30k ordinary
            fmvAtGrant: 40,
            totalCost: 10 * 1000,
            discountAmount: 30,
        };
        const espp = new ESPPAccount('espp-1', 'Company ESPP', 41000, [lot], null, undefined, 'ACME', 41);
        const brok = allGainsBrokerage('brok-1', 60000);

        const saleDate = new Date(YEAR, 5, 15);
        const CLIFF = 45000;
        const CURRENT_MAGI = 10000;

        const result = planWithdrawals(
            80000,
            [createAccountSnapshot(espp, saleDate), createAccountSnapshot(brok, saleDate)],
            57,
            YEAR,
            taxStateFor('Texas'),
            0,
            undefined,
            'Spending deficit',
            { acaCliffThreshold: CLIFF, currentMAGI: CURRENT_MAGI },
        );

        // Realized MAGI = base MAGI + ESPP ordinary income + all realized gains.
        const esppOrdinary = result.withdrawals
            .filter(w => w.source === 'espp')
            .reduce((sum, w) => sum + (w.ordinaryIncome ?? 0), 0);
        const realizedMAGI = CURRENT_MAGI + esppOrdinary + result.totalLTCG + result.totalSTCG;

        // The ESPP sale really did realize a large bargain element...
        expect(esppOrdinary).toBeGreaterThan(25000);
        // ...and the brokerage sale was steered so total MAGI respects the cliff.
        expect(realizedMAGI).toBeLessThanOrEqual(CLIFF);
    });
});

// A disqualifying ESPP lot: bargain element (fmvAtPurchase − purchasePrice) × shares
// is ORDINARY income on sale; the small ($1/sh) post-purchase appreciation is LTCG.
function disqualifyingEsppLot(): ESPPLot {
    return {
        id: 'lot-dq',
        shares: 1000,
        purchasePrice: 10,
        purchaseDate: new Date(YEAR - 1, 5, 30),
        grantDate: new Date(YEAR - 1, 0, 1),
        fmvAtPurchase: 40,   // bargain element $30/sh × 1000 = $30k ordinary
        fmvAtGrant: 40,
        totalCost: 10 * 1000,
        discountAmount: 30,
    };
}

describe('#175/#176: ESPP bargain element is counted ONCE in the ACA cliff projection, order-aware', () => {
    // The solver pre-seeds the year's full realized ESPP ordinary income into
    // acaWithdrawalOptions.currentMAGI (so an ESPP sale AFTER the brokerage still
    // steers the brokerage cap) AND passes esppOrdinaryInMAGI so the planner can back
    // out the overlap with its own cumulativeOrdinaryFromSales (which accretes the SAME
    // bargain element when ESPP sells BEFORE the brokerage). Net: the bargain element
    // counts exactly once for BOTH withdrawal orders.
    const ESPP_ORDINARY = 30_000;  // (40 − 10) × 1000
    const TRUE_BASE = 10_000;      // the non-ESPP part of MAGI the solver knows
    const CLIFF = 80_000;
    const saleDate = new Date(YEAR, 5, 15);

    it('ESPP-before-brokerage: de-dupes the seed so the brokerage is NOT over-capped (double-count regression)', () => {
        // ESPP FIRST, brokerage SECOND. currentMAGI carries the seeded ESPP ordinary
        // (TRUE_BASE + ESPP_ORDINARY) and esppOrdinaryInMAGI reports it. When the
        // brokerage guard runs, the planner has ALSO added the same $30k to
        // cumulativeOrdinaryFromSales. Pre-fix (no de-dupe) the guard saw the bargain
        // element TWICE, halving the LTCG headroom and slashing the brokerage sale, so
        // realized MAGI landed far UNDER the cliff (~$41k) — an over-conservative steer
        // that can fabricate an unfunded deficit. With the de-dupe the brokerage may
        // realize LTCG up to the true single-counted headroom, pushing realized MAGI
        // right up against (but not over) the cliff.
        const espp = new ESPPAccount('espp-1', 'Company ESPP', 41000, [disqualifyingEsppLot()], null, undefined, 'ACME', 41);
        const brok = allGainsBrokerage('brok-1', 200000);

        const result = planWithdrawals(
            150000,
            [createAccountSnapshot(espp, saleDate), createAccountSnapshot(brok, saleDate)],
            57,
            YEAR,
            taxStateFor('Texas'),
            0,
            undefined,
            'Spending deficit',
            {
                acaCliffThreshold: CLIFF,
                currentMAGI: TRUE_BASE + ESPP_ORDINARY, // solver seeds ESPP into currentMAGI
                esppOrdinaryInMAGI: ESPP_ORDINARY,       // ...and reports how much, for de-dupe
            },
        );

        const esppOrdinary = result.withdrawals
            .filter(w => w.source === 'espp')
            .reduce((sum, w) => sum + (w.ordinaryIncome ?? 0), 0);
        expect(esppOrdinary).toBeCloseTo(ESPP_ORDINARY, -2);

        // Realized MAGI counts the ESPP bargain element ONCE (via the true base + ESPP)
        // plus all realized gains.
        const realizedMAGI = TRUE_BASE + esppOrdinary + result.totalLTCG + result.totalSTCG;

        // Never breaches the cliff...
        expect(realizedMAGI).toBeLessThanOrEqual(CLIFF);
        // ...but the brokerage was allowed enough LTCG that MAGI reaches well past what
        // the double-counted (halved) headroom would have permitted (~$41k). This is the
        // assertion that is RED before the de-dupe and GREEN after.
        expect(realizedMAGI).toBeGreaterThan(60_000);
    });

    it('ESPP-after-brokerage: the seed still caps the brokerage (must NOT regress to undercount)', () => {
        // Brokerage FIRST, ESPP SECOND. When the brokerage guard runs the planner has
        // NOT yet sold ESPP, so cumulativeOrdinaryFromSales is 0 and the overlap is 0 —
        // the guard must fall back on currentMAGI's seeded ESPP to cap the brokerage for
        // the ESPP income still to come. If a "fix" dropped the seed entirely, the
        // brokerage would over-realize and the later ESPP sale would blow past the cliff.
        const espp = new ESPPAccount('espp-2', 'Company ESPP', 41000, [disqualifyingEsppLot()], null, undefined, 'ACME', 41);
        const brok = allGainsBrokerage('brok-2', 200000);

        const result = planWithdrawals(
            150000,
            [createAccountSnapshot(brok, saleDate), createAccountSnapshot(espp, saleDate)],
            57,
            YEAR,
            taxStateFor('Texas'),
            0,
            undefined,
            'Spending deficit',
            {
                acaCliffThreshold: CLIFF,
                currentMAGI: TRUE_BASE + ESPP_ORDINARY,
                esppOrdinaryInMAGI: ESPP_ORDINARY,
            },
        );

        const esppOrdinary = result.withdrawals
            .filter(w => w.source === 'espp')
            .reduce((sum, w) => sum + (w.ordinaryIncome ?? 0), 0);
        expect(esppOrdinary).toBeCloseTo(ESPP_ORDINARY, -2);

        const realizedMAGI = TRUE_BASE + esppOrdinary + result.totalLTCG + result.totalSTCG;
        // The brokerage was capped for the ESPP income still to come, so even after the
        // later ESPP sale realized MAGI respects the cliff (no undercount regression).
        expect(realizedMAGI).toBeLessThanOrEqual(CLIFF);
    });
});
