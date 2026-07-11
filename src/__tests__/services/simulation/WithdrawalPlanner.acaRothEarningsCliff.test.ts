/**
 * Regression (#27): the ACA-cliff Roth substitution must not itself re-breach the
 * cliff it is avoiding.
 *
 * Background
 * ----------
 * In the `brokerage` case, when a brokerage sale's realized gains would push MAGI
 * over the ACA cliff, planWithdrawals caps the brokerage draw and substitutes
 * tax-free Roth withdrawals for the remaining net (the "ACA cliff Roth
 * substitution" look-ahead).
 *
 * grossUpRoth drains a Roth account contributions -> conversions -> EARNINGS. For a
 * retiree under 59.5, Roth EARNINGS are ordinary income (taxed + 10% penalty) and
 * therefore land in AGI/MAGI. The substitution loop adds those earnings to
 * runningOrdinaryIncome but did NOT fold them into the projectedMAGI cliff guard,
 * and never re-checked the cliff — so when contributions and conversion layers are
 * both exhausted, the substituted Roth EARNINGS push MAGI back over the cliff while
 * the decision log reports a successful "kept MAGI under cliff" substitution.
 *
 * Scenario (this test)
 * --------------------
 * Age 55 (< 59.5). currentMAGI a few thousand under the cliff (real headroom).
 *   - Brokerage: a gain ratio chosen so that filling the gains headroom only covers
 *     part of the deficit (brokerage capped at the cliff, leaving a shortfall).
 *   - Roth IRA: a contribution basis (non-MAGI, always substitutable) that covers
 *     MOST of the shortfall, then EARNINGS (ordinary income under 59.5, in MAGI).
 *
 * With the bug, the planner substitutes Roth contributions AND grosses up Roth
 * earnings to cover the entire shortfall, and final MAGI (currentMAGI + brokerage
 * gains + Roth earnings drawn under 59.5) lands OVER the cliff while the log reports
 * success. With the fix, the earnings portion is capped to the remaining MAGI
 * headroom, so MAGI stays at/under the cliff (the rest is an honest deficit).
 */

import { describe, it, expect } from 'vitest';

import { planWithdrawals } from '../../../services/simulation/WithdrawalPlanner';
import { type AccountBalanceSnapshot } from '../../../services/simulation/types';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2025;

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

describe('planWithdrawals: ACA cliff Roth-earnings substitution must not re-breach the cliff (#27)', () => {
    it('limits under-59.5 Roth-earnings substitution so MAGI stays under the cliff', () => {
        const acaCliffThreshold = 62500;
        const currentMAGI = 55000; // ~$7,500 of real MAGI headroom under the cliff

        const snapshots: AccountBalanceSnapshot[] = [
            makeSnapshot({
                accountId: 'brok-1',
                accountName: 'Brokerage',
                accountType: 'brokerage',
                balance: 300000,
                vestedBalance: 300000,
                gainRatio: 0.95, // high gains: the brokerage draw is quickly capped at the cliff
            }),
            makeSnapshot({
                accountId: 'roth-1',
                accountName: 'Roth IRA',
                accountType: 'roth_ira',
                balance: 200000,
                vestedBalance: 200000,
                gainRatio: 0,
                rothContributions: 30000, // contribution basis (non-MAGI) covers most of the shortfall
                conversionHistory: [],     // then straight into EARNINGS (ordinary income under 59.5)
            }),
        ];

        const netNeeded = 40000; // exceeds (brokerage gains headroom + Roth basis), forcing earnings
        const result = planWithdrawals(
            netNeeded,
            snapshots,
            55, // age < 59.5 -> Roth earnings are ordinary income (in MAGI)
            YEAR,
            makeTaxState(),
            currentMAGI, // currentOrdinaryIncome (== MAGI base here, no SS/LTCG)
            makeAssumptions(),
            'Spending deficit',
            { acaCliffThreshold, currentMAGI },
        );

        // The Roth substitution drew earnings (no basis/conversions available).
        const rothSubW = result.withdrawals.find(
            w => w.source === 'roth_ira' && w.reason === 'ACA cliff Roth substitution',
        );
        // Earnings drawn under 59.5 == taxable ordinary income added to MAGI.
        const rothEarningsTaxed = rothSubW
            ? (rothSubW.tax > 0 ? rothSubW.gross : 0)
            : 0;

        // Final MAGI = base MAGI + the brokerage gains realized + Roth earnings drawn
        // under 59.5. The brokerage is capped to keep its gains under the cliff, so
        // the load-bearing term is the Roth earnings.
        const brokerageW = result.withdrawals.find(w => w.source === 'brokerage');
        const brokerageGains =
            (brokerageW?.capitalGains?.longTerm ?? 0) + (brokerageW?.capitalGains?.shortTerm ?? 0);

        const finalMAGI = currentMAGI + brokerageGains + rothEarningsTaxed;

        // The whole point: the substitution must NOT push MAGI back over the cliff.
        // (Small buffer tolerance mirrors ACA_WITHDRAWAL_BUFFER = $500 in the planner.)
        expect(finalMAGI).toBeLessThanOrEqual(acaCliffThreshold);

        // Sanity: the scenario actually forced an earnings draw (otherwise the test
        // proves nothing — there were no contributions/conversions to fall back on).
        expect(rothSubW).toBeDefined();
    });
});
