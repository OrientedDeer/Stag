/**
 * Regression: roth_401k early-withdrawal penalty must NOT be understated when an
 * ACA-cliff look-ahead and the main deficit loop both tap the SAME roth_401k in
 * one planWithdrawals call.
 *
 * Background
 * ----------
 * planWithdrawals has two passes that can each draw a Roth account in a single
 * year:
 *   1. The ACA-cliff look-ahead (inside the `brokerage` case) that substitutes
 *      tax-free Roth for brokerage LTCG that would breach the cliff.
 *   2. The main deficit loop (the `roth_401k`/`roth_ira` case).
 *
 * grossUpRoth drains conversion layers FIFO (oldest first) and applies the 10%
 * early-withdrawal penalty only to layers held < 5 years (under age 59.5). It
 * mutates `conv.amount` in place, so the SAME array object must be shared across
 * both passes for the drain — and therefore the 5-year-penalty layering — to be
 * accounted only once.
 *
 * BUG #9's fix shares one mutated array (`pooledRothConversions`) for roth_ira,
 * so a conversion spent in the look-ahead is not re-spent (penalty-free) in the
 * main loop. For roth_401k, BOTH passes built a FRESH deep copy of
 * `conversionHistory`. The balance guard (`acaRothConsumed` /
 * `effectiveVestedBalance`) correctly prevents double-spending the *dollars*, but
 * each fresh copy re-exposes the oldest (penalty-free, > 5yr) layer as full. The
 * main loop then draws that refreshed penalty-free layer again instead of the
 * < 5yr penalty-bearing layer the real account history would have hit, so the
 * reported penalty (which flows into YearSolver totalTax) is understated.
 *
 * BUG #119's fix (this update)
 * ----------------------------
 * grossUpRoth now grosses up a PENALIZED conversion-layer draw by its own 10%
 * penalty (gross = remaining / 0.9), decrementing its NET counter by the NET
 * delivered rather than the GROSS drawn. So a single-pass conversion draw no
 * longer leaves a ~10% residual deficit for a later YearSolver iteration to mop
 * up. The two scenarios below cover (a) the corrected single-pass funding and
 * (b) a genuine two-pass double-draw that still guards the bug-#9 invariant.
 */

import { describe, it, expect } from 'vitest';

import { planWithdrawals } from '../../../services/simulation/WithdrawalPlanner';
import { AccountBalanceSnapshot } from '../../../services/simulation/types';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2025;
const PENALTY_RATE = 0.10;

function makeAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(1970, 55, 95),
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: true,
            returnRates: { ror: 6 },
        },
        withdrawalStrategy: [],
    };
}

function makeTaxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas', // no state income tax — keeps the gross-up math clean
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: YEAR,
    };
}

function makeSnapshot(
    o: Partial<AccountBalanceSnapshot> & { accountId: string; accountType: AccountBalanceSnapshot['accountType'] },
): AccountBalanceSnapshot {
    return {
        accountName: o.accountName ?? o.accountId,
        balance: o.balance ?? o.vestedBalance ?? 0,
        vestedBalance: o.vestedBalance ?? o.balance ?? 0,
        gainRatio: o.gainRatio ?? 0,
        rothContributions: o.rothContributions,
        conversionHistory: o.conversionHistory,
        ...o,
    } as AccountBalanceSnapshot;
}

describe('planWithdrawals: roth_401k ACA look-ahead + main-loop penalty accounting', () => {
    it('funds the whole deficit in the look-ahead with the penalty grossed up (#119) and no residual', () => {
        const snapshots: AccountBalanceSnapshot[] = [
            makeSnapshot({
                accountId: 'brok-1',
                accountName: 'Brokerage',
                accountType: 'brokerage',
                balance: 200000,
                vestedBalance: 200000,
                gainRatio: 0.95, // high gains: any draw breaches the parked-near-cliff MAGI
            }),
            makeSnapshot({
                accountId: 'r401k-1',
                accountName: 'Roth 401k',
                accountType: 'roth_401k',
                balance: 100000,
                vestedBalance: 100000,
                gainRatio: 0,
                rothContributions: 0, // no contribution basis -> straight into conversion layers
                conversionHistory: [
                    { year: 2015, amount: 5000 },  // held 10yr -> penalty-free
                    { year: 2023, amount: 95000 }, // held 2yr  -> 10% penalty under 59.5
                ],
            }),
        ];

        // MAGI parked just under the cliff so a tiny brokerage LTCG breaches it,
        // forcing the whole deficit onto the roth_401k ACA look-ahead.
        const acaOpts = { acaCliffThreshold: 62500, currentMAGI: 62000 };

        const netNeeded = 45000;
        const result = planWithdrawals(
            netNeeded,
            snapshots,
            55, // age < 59.5 -> early-withdrawal penalty applies to < 5yr layers
            YEAR,
            makeTaxState(),
            62000, // currentOrdinaryIncome
            makeAssumptions(),
            'Spending deficit',
            acaOpts,
        );

        // #119: the penalized conversion layer is now grossed up by its own 10%
        // penalty, so the look-ahead alone delivers the FULL net deficit in a single
        // pass — no ~10% residual is left over. Funding:
        //   $5,000 penalty-free layer (net $5,000) + grossed-up penalty-bearing
        //   layer: gross $40,000 / 0.9 = $44,444.44, penalty $4,444.44, net $40,000.
        //   total gross $49,444.44, total net $45,000, no residual.
        expect(result.remainingDeficit).toBeCloseTo(0, 2);
        expect(result.totalNet).toBeCloseTo(netNeeded, 2);

        // The whole deficit is funded by the look-ahead; the main deficit loop never
        // needs to draw the roth_401k again (the residual it used to top up is gone).
        const rothWs = result.withdrawals.filter(w => w.source === 'roth_401k');
        const lookAheadW = rothWs.find(w => w.reason === 'ACA cliff Roth substitution');
        const mainLoopW = rothWs.find(w => w.reason === 'Spending deficit');
        expect(lookAheadW).toBeDefined();
        expect(mainLoopW).toBeUndefined();

        // The combined gross drawn exceeds the $5k penalty-free layer, so the excess
        // bears the 10% penalty. The penalty is computed against the account's REAL
        // (single) conversion history: only the first $5,000 of total gross is
        // penalty-free. (Guards bug #9 — the penalty-free layer is counted once.)
        const totalRothGross = rothWs.reduce((sum, w) => sum + w.gross, 0);
        const penaltyFreeLayer = 5000;
        const expectedPenalty = Math.max(0, totalRothGross - penaltyFreeLayer) * PENALTY_RATE;

        expect(totalRothGross).toBeGreaterThan(penaltyFreeLayer);
        expect(result.totalPenalties).toBeCloseTo(expectedPenalty, 2);
    });

    it('does not understate the penalty when the look-ahead and the main loop both drain the same roth_401k (bug #9)', () => {
        // Force a GENUINE two-pass double-draw on the same account: park MAGI AT the
        // cliff so the look-ahead's Roth-earnings MAGI room is $0 — it can only spend
        // the non-MAGI conversion layers and must leave the earnings layer to the
        // main deficit loop. Both passes therefore draw the same roth_401k, and the
        // shared (in-place-mutated) conversion array must keep the drained
        // penalty-bearing layer drained so it isn't re-exposed penalty-free.
        const snapshots: AccountBalanceSnapshot[] = [
            makeSnapshot({
                accountId: 'brok-1',
                accountName: 'Brokerage',
                accountType: 'brokerage',
                balance: 200000,
                vestedBalance: 200000,
                gainRatio: 0.95,
            }),
            makeSnapshot({
                accountId: 'r401k-1',
                accountName: 'Roth 401k',
                accountType: 'roth_401k',
                balance: 100000,
                vestedBalance: 100000, // $5k + $50k conversions + $45k earnings
                gainRatio: 0,
                rothContributions: 0,
                conversionHistory: [
                    { year: 2015, amount: 5000 },  // held 10yr -> penalty-free
                    { year: 2023, amount: 50000 }, // held 2yr  -> 10% penalty under 59.5
                ],
            }),
        ];

        // MAGI parked AT the cliff: no headroom for brokerage LTCG OR for Roth
        // earnings (which count in MAGI under 59.5). The look-ahead caps at the
        // non-MAGI conversion layers; the earnings tail spills to the main loop.
        const acaOpts = { acaCliffThreshold: 62000, currentMAGI: 62000 };

        const netNeeded = 60000;
        const result = planWithdrawals(
            netNeeded,
            snapshots,
            55,
            YEAR,
            makeTaxState(),
            62000,
            makeAssumptions(),
            'Spending deficit',
            acaOpts,
        );

        const rothWs = result.withdrawals.filter(w => w.source === 'roth_401k');
        const lookAheadW = rothWs.find(w => w.reason === 'ACA cliff Roth substitution');
        const mainLoopW = rothWs.find(w => w.reason === 'Spending deficit');

        // Both passes drew the same roth_401k.
        expect(lookAheadW).toBeDefined();
        expect(mainLoopW).toBeDefined();

        // The look-ahead drained both conversion layers ($5k penalty-free + $50k
        // penalty-bearing, grossed up for the penalty). With the shared array those
        // layers are NOT re-exposed to the main loop, which falls through to the
        // earnings layer — so the conversion penalty is charged exactly once on the
        // single real $50,000 penalty-bearing layer.
        const lookAheadConversionPenalty = 50000 * PENALTY_RATE; // $5,000
        // The main loop draws earnings (taxed + penalized); its penalty is on the
        // earnings gross, not on a re-exposed conversion layer.
        const mainLoopPenalty = mainLoopW!.penalty;
        expect(lookAheadW!.penalty).toBeCloseTo(lookAheadConversionPenalty, 2);

        // Total penalty = conversion penalty (counted once) + earnings penalty. The
        // bug would have re-exposed the $5k penalty-free layer in the main loop,
        // understating the total; here the conversion penalty is the full $5,000.
        expect(result.totalPenalties).toBeCloseTo(lookAheadConversionPenalty + mainLoopPenalty, 2);

        // Sanity: the earnings draw actually carries a penalty (it's under 59.5),
        // confirming the second pass hit the penalized earnings layer, not a
        // refreshed penalty-free conversion.
        expect(mainLoopPenalty).toBeGreaterThan(0);
    });
});
