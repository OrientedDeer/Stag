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
 * Scenario (this test)
 * --------------------
 * Age 55 (< 59.5). Brokerage with a 95% gain ratio and currentMAGI parked just
 * under the cliff, so any brokerage LTCG breaches it — the entire brokerage draw
 * is capped to $0 and the whole deficit is pushed onto the roth_401k look-ahead.
 *
 * roth_401k: $100k balance, $0 contribution basis, conversion layers
 *   - $5,000 from 2015  (held 10yr -> penalty-free)
 *   - $95,000 from 2023 (held 2yr  -> 10% penalty under 59.5)
 *
 * Net needed $45,000:
 *   Look-ahead draws $45,000 gross = $5,000 penalty-free + $40,000 penalty-bearing
 *     -> penalty $4,000, net $41,000 (a $4,000 residual remains, because the
 *        penalty eats into the net delivered).
 *   Main loop then draws the $4,000 residual. With a SHARED layer it would draw
 *     the penalty-bearing layer ($4,000 -> $400 penalty). With the bug it draws
 *     a REFRESHED $5,000 penalty-free layer -> $0 penalty.
 *
 * Total roth gross drawn = $49,000. The real (single) conversion history is
 * $5,000 penalty-free + $44,000 penalty-bearing, so the CORRECT total penalty is
 * $4,400. The bug reports $4,000 (the penalty-free layer counted twice).
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
    it('does not understate the early-withdrawal penalty when both passes drain the same roth_401k', () => {
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

        // Almost the whole deficit is funded from the roth_401k (brokerage capped
        // to $0). A tiny residual ($400 here) is expected and unrelated to the bug
        // under test: grossUpRoth does NOT gross-up a conversion-layer draw for its
        // 10% penalty, so the last penalty-bearing dollars deliver net below gross.
        // (That residual is what a later YearSolver iteration would top up; the
        // important point for THIS test is the penalty total below.)
        expect(result.remainingDeficit).toBeLessThan(netNeeded * 0.05);

        // Both passes tapped the same roth_401k in this one call.
        const rothWs = result.withdrawals.filter(w => w.source === 'roth_401k');
        const lookAheadW = rothWs.find(w => w.reason === 'ACA cliff Roth substitution');
        const mainLoopW = rothWs.find(w => w.reason === 'Spending deficit');
        expect(lookAheadW).toBeDefined();
        expect(mainLoopW).toBeDefined();

        // The combined gross drawn across both passes exceeds the $5k penalty-free
        // layer, so the excess must bear the 10% penalty. The correct penalty is
        // computed against the account's REAL (single) conversion history: only the
        // first $5,000 of total gross is penalty-free.
        const totalRothGross = rothWs.reduce((sum, w) => sum + w.gross, 0);
        const penaltyFreeLayer = 5000;
        const expectedPenalty = Math.max(0, totalRothGross - penaltyFreeLayer) * PENALTY_RATE;

        // Sanity: the scenario actually exercises the double-draw (combined gross
        // spills past the penalty-free layer), otherwise the test proves nothing.
        expect(totalRothGross).toBeGreaterThan(penaltyFreeLayer);

        // The bug counts the $5k penalty-free layer in BOTH passes, so it reports
        // less penalty than the real history would bear. With the fix the total
        // penalty equals the penalty against the single, shared conversion history.
        expect(result.totalPenalties).toBeCloseTo(expectedPenalty, 2);
    });
});
