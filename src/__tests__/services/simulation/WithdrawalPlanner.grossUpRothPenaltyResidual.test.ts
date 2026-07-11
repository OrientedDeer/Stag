/**
 * Regression (#119): grossUpRoth must be self-consistent for a PENALIZED
 * conversion-layer draw.
 *
 * Bug
 * ---
 * grossUpRoth walks the IRS ordering contributions -> conversions -> earnings to
 * deliver a NET target. For a conversion layer hit under age 59.5 within the
 * 5-year rule it subtracts the 10% early-withdrawal penalty from the reported
 * total, BUT it reduced its internal `remaining` (a NET counter, seeded with
 * netNeeded) by the GROSS drawn (`fromThisConv`) rather than the NET delivered
 * (`fromThisConv * (1 - penaltyRate)`). The earnings layer correctly grosses up
 * (gross = remaining / (1 - marginal - penalty)); the conversion layer did not.
 *
 * Consequence: a penalized conversion-only draw delivers net = gross * 0.9 but
 * counts the full gross against the deficit, so it under-delivers by exactly the
 * penalty (~10% of the penalized portion). planWithdrawals then reports that gap
 * as remainingDeficit, which a later YearSolver iteration tops up.
 *
 * Scenario
 * --------
 * Age 55 (< 59.5). One roth_401k, $0 contribution basis, a single conversion
 * layer from 2023 (held 2yr -> penalty-bearing). Net needed $10,000 with NO ACA
 * cliff in play, so the whole deficit routes straight to the conversion layer in
 * one pass.
 *
 * Correct sizing: to net $10,000 from a 10%-penalty layer you must draw gross
 * $10,000 / 0.9 = $11,111.11; penalty $1,111.11; net delivered $10,000.000.
 * No residual.
 *
 * Pre-fix the planner drew gross $10,000, penalty $1,000, net $9,000 -> a $1,000
 * residual reported as remainingDeficit.
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

describe('planWithdrawals: grossUpRoth penalized conversion-layer self-consistency (#119)', () => {
    it('grosses up a penalized conversion-layer draw so net delivered covers the deficit (no residual)', () => {
        const snapshots: AccountBalanceSnapshot[] = [
            makeSnapshot({
                accountId: 'r401k-1',
                accountName: 'Roth 401k',
                accountType: 'roth_401k',
                balance: 100000,
                vestedBalance: 100000,
                gainRatio: 0,
                rothContributions: 0, // no contribution basis -> straight into the conversion layer
                conversionHistory: [
                    { year: 2023, amount: 95000 }, // held 2yr -> 10% penalty under 59.5
                ],
            }),
        ];

        const netNeeded = 10000;
        const result = planWithdrawals(
            netNeeded,
            snapshots,
            55, // age < 59.5 -> early-withdrawal penalty applies to the < 5yr layer
            YEAR,
            makeTaxState(),
            62000, // currentOrdinaryIncome
            makeAssumptions(),
            'Spending deficit',
            // NO acaWithdrawalOptions -> single pass straight to the conversion layer
        );

        const rothW = result.withdrawals.find(w => w.source === 'roth_401k');
        expect(rothW).toBeDefined();

        // The draw must be grossed up so the NET of the 10% penalty equals the
        // deficit. gross = 10000 / (1 - 0.10) = 11,111.11; penalty = 1,111.11;
        // net = 10,000.00. No residual deficit is left for YearSolver to mop up.
        const expectedGross = netNeeded / (1 - PENALTY_RATE);
        const expectedPenalty = expectedGross * PENALTY_RATE;

        expect(rothW!.gross).toBeCloseTo(expectedGross, 2);
        expect(rothW!.penalty).toBeCloseTo(expectedPenalty, 2);
        expect(rothW!.net).toBeCloseTo(netNeeded, 2);

        // The whole deficit is funded in one pass — no residual left open.
        expect(result.remainingDeficit).toBeCloseTo(0, 2);
        expect(result.totalNet).toBeCloseTo(netNeeded, 2);
        expect(result.totalPenalties).toBeCloseTo(expectedPenalty, 2);
    });
});
